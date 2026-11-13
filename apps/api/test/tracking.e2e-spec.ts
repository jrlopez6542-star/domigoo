import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, readEnv, type AppEnv } from "../src/config/env.js";
import { applyHttpSecurity } from "../src/http.js";
import { resetLoginThrottle } from "../src/identity/login-throttle.js";
import { setupOpenApi } from "../src/openapi.js";
import { encryptPin, hashPin } from "../src/orders/pin-crypto.js";
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

describe("enlace público de tracking (M27)", () => {
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

  it("emite enlace, oculta PII y pickupPin, expone deliveryPin solo en PICKED_UP/AT_DROPOFF y rechaza alterado/vencido/revocado", async () => {
    const ownerRes = await request(server())
      .post("/v1/auth/register")
      .send({ email: "owner-m27@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const ownerToken = String(record(ownerRes.body)["token"]);

    const courierRes = await request(server())
      .post("/v1/auth/register")
      .send({ email: "courier-m27@example.invalid", password, client: "MOBILE" })
      .expect(201);
    expect(record(courierRes.body)["token"]).toBeDefined();

    const dbInit = new Pool({ connectionString: databaseUrl });
    try {
      await dbInit.query(
        `INSERT INTO couriers (
           id, "userId", "documentType", "documentNumber", "firstName", "lastName",
           status, "registrationSource", "createdAt", "updatedAt"
         )
         SELECT gen_random_uuid(), id, 'CC', '80027001', 'Carlos', 'Tracking',
                'APPROVED', 'OPEN', now(), now()
         FROM users WHERE email = 'courier-m27@example.invalid'`,
      );
    } finally {
      await dbInit.end();
    }

    const site = await request(server())
      .post("/v1/restaurants")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        legalName: "Razon M27",
        tradeName: "Local M27",
        nit: "900000270",
        email: "local-m27@example.invalid",
        phoneE164: "+573001110270",
        establishmentName: "Establecimiento M27",
        branchName: "Principal",
        addressLine: "Calle M27",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(201);

    const draft = await request(server())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId: record(site.body)["branchId"],
        foodAmountCop: 35000,
        deliveryFeeCop: 6000,
        paymentMethod: "CASH",
      })
      .expect(201);
    const orderId = String(record(draft.body)["id"]);

    const db = new Pool({ connectionString: databaseUrl });
    try {
      const cRow = await db.query<{ id: string }>(
        `SELECT c.id FROM couriers c JOIN users u ON u.id = c."userId" WHERE u.email = 'courier-m27@example.invalid'`,
      );
      const courierId = String(cRow.rows[0]?.id);
      const deliveryPin = "654321";
      const pickupPin = "123456";

      await db.query(
        `UPDATE orders
         SET status = 'ACCEPTED',
             "assignedCourierId" = $2,
             "pickupPinHash" = $3,
             "pickupPinCiphertext" = $4,
             "deliveryPinHash" = $5,
             "deliveryPinCiphertext" = $6,
             "updatedAt" = now()
         WHERE id = $1`,
        [
          orderId,
          courierId,
          hashPin(pickupPin, orderId, "PICKUP", env.pinPepper),
          encryptPin(pickupPin, orderId, "PICKUP", env.appEncryptionKey),
          hashPin(deliveryPin, orderId, "DELIVERY", env.pinPepper),
          encryptPin(deliveryPin, orderId, "DELIVERY", env.appEncryptionKey),
        ],
      );

      // 1. Emitir enlace y verificar que es idempotente
      const issued1 = await request(server())
        .post(`/v1/orders/${orderId}/tracking-link`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(201);
      const token = String(record(issued1.body)["token"]);
      expect(token.length).toBeGreaterThan(20);

      const issued2 = await request(server())
        .post(`/v1/orders/${orderId}/tracking-link`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(201);
      expect(record(issued2.body)["token"]).toBe(token);

      // En ACCEPTED: sin sesión, cabeceras de privacidad, sin deliveryPin ni datos sensibles
      const publicAccepted = await request(server()).get(`/v1/tracking/${token}`).expect(200);
      expect(publicAccepted.headers["x-robots-tag"]).toBe("noindex, nofollow");
      expect(publicAccepted.headers["referrer-policy"]).toBe("no-referrer");
      const bodyAcc = record(publicAccepted.body);
      expect(bodyAcc["status"]).toBe("ACCEPTED");
      expect(bodyAcc["deliveryPin"]).toBeUndefined();
      expect(bodyAcc["pickupPin"]).toBeUndefined();
      expect(bodyAcc["foodAmountCop"]).toBeUndefined();
      expect(bodyAcc["courierPhone"]).toBeUndefined();
      expect(JSON.stringify(bodyAcc)).not.toContain("80027001");
      expect(JSON.stringify(bodyAcc)).not.toContain("+573001127001");

      // En PICKED_UP sí devuelve deliveryPin
      await db.query(`UPDATE orders SET status = 'PICKED_UP' WHERE id = $1`, [orderId]);
      const publicPicked = await request(server()).get(`/v1/tracking/${token}`).expect(200);
      expect(record(publicPicked.body)["deliveryPin"]).toBe(deliveryPin);

      // En AT_DROPOFF sí devuelve deliveryPin
      await db.query(`UPDATE orders SET status = 'AT_DROPOFF' WHERE id = $1`, [orderId]);
      const publicDropoff = await request(server()).get(`/v1/tracking/${token}`).expect(200);
      expect(record(publicDropoff.body)["deliveryPin"]).toBe(deliveryPin);

      // En DELIVERED ya no devuelve deliveryPin
      await db.query(`UPDATE orders SET status = 'DELIVERED' WHERE id = $1`, [orderId]);
      const publicDelivered = await request(server()).get(`/v1/tracking/${token}`).expect(200);
      expect(record(publicDelivered.body)["deliveryPin"]).toBeUndefined();

      // Token alterado -> 404
      await request(server()).get(`/v1/tracking/${token}x`).expect(404);

      // Token vencido -> 404
      await db.query(
        `UPDATE tracking_links SET "expiresAt" = now() - interval '1 minute' WHERE "orderId" = $1`,
        [orderId],
      );
      await request(server()).get(`/v1/tracking/${token}`).expect(404);

      // Re-emitir y revocar -> 404
      const reissued = await request(server())
        .post(`/v1/orders/${orderId}/tracking-link`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(201);
      const token2 = String(record(reissued.body)["token"]);
      await request(server()).get(`/v1/tracking/${token2}`).expect(200);

      await request(server())
        .post(`/v1/orders/${orderId}/tracking-link/revoke`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .expect(201);
      await request(server()).get(`/v1/tracking/${token2}`).expect(404);
    } finally {
      await db.end();
    }
  });
});
