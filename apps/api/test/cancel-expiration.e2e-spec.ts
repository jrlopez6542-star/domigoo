import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, readEnv, type AppEnv } from "../src/config/env.js";
import { applyHttpSecurity } from "../src/http.js";
import { resetLoginThrottle } from "../src/identity/login-throttle.js";
import { setupOpenApi } from "../src/openapi.js";
import { ExpirationRepository } from "../src/orders/expiration.repository.js";
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

describe("cancelación y vencimiento (M26)", () => {
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

  it("cancelar en AT_PICKUP libera al domiciliario, cancelar en PICKED_UP como restaurante da 422 y expirar dos veces no duplica evento", async () => {
    const ownerRes = await request(server())
      .post("/v1/auth/register")
      .send({
        email: "owner-m26@example.invalid",
        password,
        client: "MOBILE",
        consents: { termsAccepted: true, privacyAccepted: true },
      })
      .expect(201);
    const ownerToken = String(record(ownerRes.body)["token"]);

    const courierRes = await request(server())
      .post("/v1/auth/register")
      .send({
        email: "courier-m26@example.invalid",
        password,
        client: "MOBILE",
        consents: { termsAccepted: true, privacyAccepted: true },
      })
      .expect(201);
    expect(record(courierRes.body)["token"]).toBeDefined();

    const dbInit = new Pool({ connectionString: databaseUrl });
    try {
      await dbInit.query(
        `INSERT INTO couriers (
           id, "userId", "documentType", "documentNumber", "firstName", "lastName",
           status, "registrationSource", "createdAt", "updatedAt"
         )
         SELECT gen_random_uuid(), id, 'CC', '80026001', 'Domiciliario', 'M26',
                'APPROVED', 'OPEN', now(), now()
         FROM users WHERE email = 'courier-m26@example.invalid'`,
      );
    } finally {
      await dbInit.end();
    }

    const site = await request(server())
      .post("/v1/restaurants")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        legalName: "Razon M26",
        tradeName: "Local M26",
        nit: "900000260",
        email: "local-m26@example.invalid",
        phoneE164: "+573001110260",
        establishmentName: "Establecimiento M26",
        branchName: "Principal",
        addressLine: "Calle M26",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(201);

    const order1Res = await request(server())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId: record(site.body)["branchId"],
        foodAmountCop: 22000,
        deliveryFeeCop: 5000,
        paymentMethod: "CASH",
      })
      .expect(201);
    const order1Id = String(record(order1Res.body)["id"]);

    const order2Res = await request(server())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId: record(site.body)["branchId"],
        foodAmountCop: 19000,
        deliveryFeeCop: 5000,
        paymentMethod: "CASH",
      })
      .expect(201);
    const order2Id = String(record(order2Res.body)["id"]);

    const order3Res = await request(server())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId: record(site.body)["branchId"],
        foodAmountCop: 15000,
        deliveryFeeCop: 5000,
        paymentMethod: "CASH",
      })
      .expect(201);
    const order3Id = String(record(order3Res.body)["id"]);

    const db = new Pool({ connectionString: databaseUrl });
    try {
      const cRow = await db.query<{ id: string }>(
        `SELECT c.id FROM couriers c JOIN users u ON u.id = c."userId" WHERE u.email = 'courier-m26@example.invalid'`,
      );
      const courierId = String(cRow.rows[0]?.id);

      // 1. Pedido 1 en AT_PICKUP con courier ON_SERVICE
      await db.query(
        `INSERT INTO courier_availabilities ("courierId", state, "updatedAt")
         VALUES ($1, 'ON_SERVICE', now())
         ON CONFLICT ("courierId") DO UPDATE SET state = 'ON_SERVICE', "updatedAt" = now()`,
        [courierId],
      );
      await db.query(
        `UPDATE orders
         SET status = 'AT_PICKUP', "assignedCourierId" = $2, "acceptedAt" = now(), "updatedAt" = now()
         WHERE id = $1`,
        [order1Id, courierId],
      );

      const cancel1 = await request(server())
        .post(`/v1/orders/${order1Id}/cancel`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ reason: "Producto agotado" })
        .expect(201);
      expect(record(cancel1.body)["status"]).toBe("CANCELLED_RESTAURANT");

      const avail = await db.query<{ state: string }>(
        `SELECT state::text AS state FROM courier_availabilities WHERE "courierId" = $1`,
        [courierId],
      );
      expect(avail.rows[0]?.state).toBe("AVAILABLE");

      // 2. Pedido 2 en PICKED_UP: restaurante no puede cancelar (422)
      await db.query(
        `UPDATE orders
         SET status = 'PICKED_UP', "assignedCourierId" = $2, "pickedUpAt" = now(), "updatedAt" = now()
         WHERE id = $1`,
        [order2Id, courierId],
      );
      await request(server())
        .post(`/v1/orders/${order2Id}/cancel`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ reason: "Intento tardío" })
        .expect(422);

      // 3. Pedido 3 en SEEKING_COURIER vencido + oferta PENDING vencida:
      // correr expireStale dos veces no duplica evento EXPIRED
      await db.query(
        `UPDATE orders
         SET status = 'SEEKING_COURIER', "seekingExpiresAt" = now() - interval '2 minutes', "updatedAt" = now()
         WHERE id = $1`,
        [order3Id],
      );
      await db.query(
        `INSERT INTO dispatch_offers (id, "orderId", "courierId", wave, status, "expiresAt", "createdAt")
         VALUES (gen_random_uuid(), $1, $2, 1, 'PENDING', now() - interval '1 minute', now())`,
        [order3Id, courierId],
      );

      const expirations = currentApp?.get(ExpirationRepository);
      if (expirations === undefined) {
        throw new Error("ExpirationRepository no resuelto");
      }

      const firstRun = await expirations.expireStale(new Date());
      expect(firstRun.expiredOrders).toBe(1);
      expect(firstRun.expiredOffers).toBe(1);

      const secondRun = await expirations.expireStale(new Date());
      expect(secondRun.expiredOrders).toBe(0);
      expect(secondRun.expiredOffers).toBe(0);

      const events = await db.query<{ toStatus: string }>(
        `SELECT "toStatus"::text AS "toStatus" FROM order_events WHERE "orderId" = $1`,
        [order3Id],
      );
      expect(events.rows.filter((e) => e.toStatus === "EXPIRED")).toHaveLength(1);
    } finally {
      await db.end();
    }
  });
});
