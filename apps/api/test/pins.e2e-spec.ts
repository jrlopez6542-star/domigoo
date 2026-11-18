import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, readEnv, type AppEnv } from "../src/config/env.js";
import { applyHttpSecurity } from "../src/http.js";
import { resetLoginThrottle } from "../src/identity/login-throttle.js";
import { setupOpenApi } from "../src/openapi.js";
import { decryptPin } from "../src/orders/pin-crypto.js";
import { migrateDatabase } from "./migrate.js";
import { resetDatabase } from "./reset-db.js";

const databaseUrl =
  process.env["DATABASE_URL"] ?? "postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo";
const password = "clave-de-prueba-12";

type HttpServer = Parameters<typeof request>[0];
let currentApp: INestApplication | undefined;

function server(): HttpServer {
  if (currentApp === undefined) {
    throw new Error("La aplicación no arrancó");
  }
  return currentApp.getHttpServer() as HttpServer;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("La respuesta no es un objeto");
  }
  return value as Record<string, unknown>;
}

async function createApp(env: AppEnv): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_ENV)
    .useValue(env)
    .compile();
  const app = moduleRef.createNestApplication();
  applyHttpSecurity(app);
  setupOpenApi(app, env.appName);
  await app.init();
  return app;
}

async function setupAcceptedOrder(env: AppEnv): Promise<{
  ownerToken: string;
  courierToken: string;
  orderId: string;
  courierId: string;
}> {
  const ownerRes = await request(server())
    .post("/v1/auth/register")
    .send({
      email: "owner-m25@example.invalid",
      password,
      client: "MOBILE",
      consents: { termsAccepted: true, privacyAccepted: true },
    })
    .expect(201);
  const ownerToken = String(record(ownerRes.body)["token"]);

  const courierRes = await request(server())
    .post("/v1/auth/register")
    .send({
      email: "courier-m25@example.invalid",
      password,
      client: "MOBILE",
      consents: { termsAccepted: true, privacyAccepted: true },
    })
    .expect(201);
  const courierToken = String(record(courierRes.body)["token"]);

  const dbSetup = new Pool({ connectionString: env.databaseUrl });
  try {
    await dbSetup.query(
      `INSERT INTO couriers (
         id, "userId", "documentType", "documentNumber", "firstName", "lastName",
         status, "registrationSource", "createdAt", "updatedAt"
       )
       SELECT gen_random_uuid(), id, 'CC', '80025001', 'Domiciliario', 'PIN',
              'APPROVED', 'OPEN', now(), now()
       FROM users WHERE email = 'courier-m25@example.invalid'`,
    );
  } finally {
    await dbSetup.end();
  }

  const site = await request(server())
    .post("/v1/restaurants")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({
      legalName: "Razon M25",
      tradeName: "Local M25",
      nit: "900000250",
      email: "local-m25@example.invalid",
      phoneE164: "+573001110250",
      establishmentName: "Establecimiento M25",
      branchName: "Principal",
      addressLine: "Calle M25",
      longitude: -73.9132,
      latitude: 4.9655,
    })
    .expect(201);

  const draft = await request(server())
    .post("/v1/orders")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({
      branchId: record(site.body)["branchId"],
      foodAmountCop: 28000,
      deliveryFeeCop: 6000,
      paymentMethod: "CASH",
    })
    .expect(201);
  const orderId = String(record(draft.body)["id"]);

  const db = new Pool({ connectionString: env.databaseUrl });
  try {
    const cRow = await db.query<{ id: string }>(
      `SELECT c.id FROM couriers c JOIN users u ON u.id = c."userId" WHERE u.email = 'courier-m25@example.invalid'`,
    );
    const courierId = String(cRow.rows[0]?.id);
    await db.query(
      `INSERT INTO courier_availabilities ("courierId", state, "updatedAt")
       VALUES ($1, 'AVAILABLE', now())
       ON CONFLICT ("courierId") DO UPDATE SET state = 'AVAILABLE', "updatedAt" = now()`,
      [courierId],
    );
    await db.query(
      `UPDATE orders
       SET status = 'SEEKING_COURIER',
           "customerName" = 'Cliente M25',
           "customerPhoneE164" = '+573008887766',
           "dropoffAddress" = 'Calle 10 # 5-15',
           "updatedAt" = now()
       WHERE id = $1`,
      [orderId],
    );
    const offerRow = await db.query<{ id: string }>(
      `INSERT INTO dispatch_offers (id, "orderId", "courierId", wave, status, "expiresAt", "createdAt")
       VALUES (gen_random_uuid(), $1, $2, 1, 'PENDING', now() + interval '10 minutes', now())
       RETURNING id`,
      [orderId, courierId],
    );
    const offerId = String(offerRow.rows[0]?.id);

    await request(server())
      .post(`/v1/offers/${offerId}/accept`)
      .set("Authorization", `Bearer ${courierToken}`)
      .set("Idempotency-Key", "m25-accept-1")
      .send({ ack: true })
      .expect(201);

    return { ownerToken, courierToken, orderId, courierId };
  } finally {
    await db.end();
  }
}

describe("PIN de recogida y entrega (M25)", () => {
  const env = readEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO" });

  beforeAll(() => {
    migrateDatabase(databaseUrl);
  });

  beforeEach(async () => {
    resetLoginThrottle();
    await resetDatabase(databaseUrl);
    currentApp = await createApp(env);
  });

  afterEach(async () => {
    await currentApp?.close();
    currentApp = undefined;
  });

  it("valida PIN de recogida/entrega, oculta PIN al domiciliario, y crea PIN_LOCKOUT al agotar intentos", async () => {
    const { ownerToken, courierToken, orderId, courierId } = await setupAcceptedOrder(env);

    // 1. Restaurante ve pickupPin en ACCEPTED; domiciliario nunca ve PINes
    const restAccepted = await request(server())
      .get(`/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    const pickupPin = String(record(restAccepted.body)["pickupPin"]);
    expect(pickupPin).toMatch(/^\d{6}$/);

    const courierAccepted = await request(server())
      .get(`/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${courierToken}`)
      .expect(200);
    expect(record(courierAccepted.body)["pickupPin"]).toBeUndefined();
    expect(record(courierAccepted.body)["deliveryPin"]).toBeUndefined();

    // 2. La base solo guarda hash y ciphertext (nunca el PIN en claro)
    const db = new Pool({ connectionString: databaseUrl });
    try {
      const pinCols = await db.query<{
        pickupPinHash: string;
        pickupPinCiphertext: string;
        deliveryPinHash: string;
        deliveryPinCiphertext: string;
      }>(
        `SELECT "pickupPinHash", "pickupPinCiphertext", "deliveryPinHash", "deliveryPinCiphertext"
         FROM orders WHERE id = $1`,
        [orderId],
      );
      const row = pinCols.rows[0];
      expect(row?.pickupPinHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row?.pickupPinCiphertext).not.toContain(pickupPin);
      const deliveryPin = decryptPin(
        String(row?.deliveryPinCiphertext),
        orderId,
        "DELIVERY",
        env.appEncryptionKey,
      );
      expect(deliveryPin).toMatch(/^\d{6}$/);
      expect(row?.deliveryPinCiphertext).not.toContain(deliveryPin);

      // 3. Avanzar a ARRIVING_PICKUP y AT_PICKUP
      await request(server())
        .post(`/v1/orders/${orderId}/arrive-pickup`)
        .set("Authorization", `Bearer ${courierToken}`)
        .expect(201);
      await request(server())
        .post(`/v1/orders/${orderId}/at-pickup`)
        .set("Authorization", `Bearer ${courierToken}`)
        .expect(201);

      // PIN incorrecto no avanza y suma intento
      const wrongPickupPin = pickupPin === "000000" ? "111111" : "000000";
      const wrongRes = await request(server())
        .post(`/v1/orders/${orderId}/pickup-pin`)
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ pin: wrongPickupPin })
        .expect(422);
      expect(record(wrongRes.body)["attempts"]).toBe(1);

      // PIN correcto avanza a PICKED_UP
      const okPickup = await request(server())
        .post(`/v1/orders/${orderId}/pickup-pin`)
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ pin: pickupPin })
        .expect(201);
      expect(record(okPickup.body)["status"]).toBe("PICKED_UP");

      // Restaurante ya NO ve pickupPin en PICKED_UP y el ciphertext se limpia en BD
      const restPickedUp = await request(server())
        .get(`/v1/orders/${orderId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(200);
      expect(record(restPickedUp.body)["pickupPin"]).toBeUndefined();

      const afterPickupCols = await db.query<{ pickupPinCiphertext: string | null }>(
        `SELECT "pickupPinCiphertext" FROM orders WHERE id = $1`,
        [orderId],
      );
      expect(afterPickupCols.rows[0]?.pickupPinCiphertext).toBeNull();

      // 4. Llegar a destino (AT_DROPOFF) y agotar 5 intentos fallidos de PIN de entrega
      await request(server())
        .post(`/v1/orders/${orderId}/at-dropoff`)
        .set("Authorization", `Bearer ${courierToken}`)
        .expect(201);

      const wrongDeliveryPin = deliveryPin === "000000" ? "111111" : "000000";
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const failRes = await request(server())
          .post(`/v1/orders/${orderId}/delivery-pin`)
          .set("Authorization", `Bearer ${courierToken}`)
          .send({ pin: wrongDeliveryPin })
          .expect(422);
        expect(record(failRes.body)["attempts"]).toBe(attempt);
        expect(record(failRes.body)["lockedOut"]).toBe(attempt === 5);
      }

      // El estado sigue en AT_DROPOFF y existe incidente PIN_LOCKOUT
      const afterLockOrder = await db.query<{ status: string }>(
        `SELECT status::text AS status FROM orders WHERE id = $1`,
        [orderId],
      );
      expect(afterLockOrder.rows[0]?.status).toBe("AT_DROPOFF");

      const incidents = await db.query<{ type: string; status: string }>(
        `SELECT type::text AS type, status::text AS status FROM incidents WHERE "orderId" = $1`,
        [orderId],
      );
      expect(incidents.rows).toHaveLength(1);
      expect(incidents.rows[0]?.type).toBe("PIN_LOCKOUT");

      // Intento #6 incluso con PIN correcto sigue bloqueado
      await request(server())
        .post(`/v1/orders/${orderId}/delivery-pin`)
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ pin: deliveryPin })
        .expect(422);

      // Limpiar bloqueo manualmente en otro flujo: verificar entrega exitosa y liberación de courier
      await db.query(`UPDATE orders SET "deliveryPinAttempts" = 0 WHERE id = $1`, [orderId]);
      const okDelivery = await request(server())
        .post(`/v1/orders/${orderId}/delivery-pin`)
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ pin: deliveryPin })
        .expect(201);
      expect(record(okDelivery.body)["status"]).toBe("DELIVERED");

      const avail = await db.query<{ state: string }>(
        `SELECT state::text AS state FROM courier_availabilities WHERE "courierId" = $1`,
        [courierId],
      );
      expect(avail.rows[0]?.state).toBe("AVAILABLE");
    } finally {
      await db.end();
    }
  });
});
