import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, readEnv, type AppEnv } from "../src/config/env.js";
import { applyHttpSecurity } from "../src/http.js";
import { resetLoginThrottle } from "../src/identity/login-throttle.js";
import { setupOpenApi } from "../src/openapi.js";
import { activateRestaurantForTest } from "./activate-restaurant.js";
import { migrateDatabase } from "./migrate.js";
import { resetDatabase } from "./reset-db.js";
const databaseUrl =
  process.env["DATABASE_URL"] ?? "postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo";
const password = "clave-de-prueba-12";
const cronSecret = "secreto-cron-011-prueba";
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
async function seedStaleSeekingOrder(params: {
  pool: Pool;
  email: string;
  nit: string;
  phoneE164: string;
}): Promise<{ ownerToken: string; orderId: string; offerId: string }> {
  const ownerRes = await request(server())
    .post("/v1/auth/register")
    .send({
      email: params.email,
      phoneE164: params.phoneE164,
      password,
      client: "MOBILE",
      consents: { termsAccepted: true, privacyAccepted: true },
    })
    .expect(201);
  const ownerToken = String(record(ownerRes.body)["token"]);
  const site = await request(server())
    .post("/v1/restaurants")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({
      legalName: `Razon ${params.nit}`,
      tradeName: `Local ${params.nit}`,
      nit: params.nit,
      email: params.email,
      phoneE164: params.phoneE164,
      establishmentName: `Establecimiento ${params.nit}`,
      branchName: "Principal",
      addressLine: "Calle 10 # 10-10",
      longitude: -73.9132,
      latitude: 4.9655,
    })
    .expect(201);
  const branchId = String(record(site.body)["branchId"]);
  const restaurantId = String(record(site.body)["id"]);
  await params.pool.query(`UPDATE restaurants SET status = 'ACTIVE' WHERE id = $1`, [restaurantId]);
  await activateRestaurantForTest(params.pool, restaurantId, branchId);
  const draft = await request(server())
    .post("/v1/orders")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({
      branchId,
      foodAmountCop: 24000,
      deliveryFeeCop: 5500,
      paymentMethod: "CASH",
    })
    .expect(201);
  const orderId = String(record(draft.body)["id"]);
  const courierUserRes = await request(server())
    .post("/v1/auth/register")
    .send({
      email: `courier-${params.nit}@example.invalid`,
      password,
      client: "MOBILE",
      consents: { termsAccepted: true, privacyAccepted: true },
    })
    .expect(201);
  expect(record(courierUserRes.body)["token"]).toBeDefined();
  const cInsert = await params.pool.query<{ id: string }>(
    `INSERT INTO couriers (
       id, "userId", "documentType", "documentNumber", "firstName", "lastName",
       status, "registrationSource", "createdAt", "updatedAt"
     )
     SELECT gen_random_uuid(), id, 'CC', $1, 'Domi', 'Expiracion',
            'APPROVED', 'OPEN', now(), now()
     FROM users WHERE email = $2
     RETURNING id`,
    [params.nit, `courier-${params.nit}@example.invalid`],
  );
  const courierId = String(cInsert.rows[0]?.id);
  await params.pool.query(
    `UPDATE orders
     SET status = 'SEEKING_COURIER',
         "seekingExpiresAt" = now() - interval '5 minutes',
         "updatedAt" = now()
     WHERE id = $1`,
    [orderId],
  );
  const offerInsert = await params.pool.query<{ id: string }>(
    `INSERT INTO dispatch_offers (
       id, "orderId", "courierId", wave, status, "expiresAt", "createdAt"
     ) VALUES (
       gen_random_uuid(), $1, $2, 1, 'PENDING', now() - interval '5 minutes', now() - interval '10 minutes'
     )
     RETURNING id`,
    [orderId, courierId],
  );
  const offerId = String(offerInsert.rows[0]?.id);
  return { ownerToken, orderId, offerId };
}
describe("ORDEN 011 - expiración de pedidos atascados via cron y GET mine", () => {
  const env = readEnv({
    DATABASE_URL: databaseUrl,
    APP_NAME: "DOMIGOO",
    CRON_SECRET: cronSecret,
  });
  let previousCronSecret: string | undefined;
  beforeAll(() => {
    previousCronSecret = process.env["CRON_SECRET"];
    process.env["CRON_SECRET"] = cronSecret;
    migrateDatabase(databaseUrl);
  });
  afterAll(() => {
    if (previousCronSecret === undefined) {
      delete process.env["CRON_SECRET"];
    } else {
      process.env["CRON_SECRET"] = previousCronSecret;
    }
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
  it("expira pedido con seekingExpiresAt vencido vía cron /v1/internal/cron/maintenance", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const seeded = await seedStaleSeekingOrder({
        pool,
        email: "cron-011@example.invalid",
        nit: "900011001",
        phoneE164: "+573001110121",
      });
      const cronRes = await request(server())
        .post("/v1/internal/cron/maintenance")
        .set("x-cron-secret", cronSecret)
        .expect(200);
      const summary = record(record(cronRes.body)["summary"]);
      expect(summary["expiredOrders"]).toBe(1);
      const orderRow = await pool.query<{ status: string }>(
        `SELECT status::text AS status FROM orders WHERE id = $1`,
        [seeded.orderId],
      );
      expect(orderRow.rows[0]?.status).toBe("EXPIRED");
      const eventRow = await pool.query<{ reason: string; toStatus: string }>(
        `SELECT reason, "toStatus"::text AS "toStatus"
         FROM order_events WHERE "orderId" = $1 AND reason = 'seeking_expired'`,
        [seeded.orderId],
      );
      expect(eventRow.rows[0]?.toStatus).toBe("EXPIRED");
      const offerRow = await pool.query<{ status: string }>(
        `SELECT status::text AS status FROM dispatch_offers WHERE id = $1`,
        [seeded.offerId],
      );
      expect(offerRow.rows[0]?.status).toBe("EXPIRED");
    } finally {
      await pool.end();
    }
  });
  it("expira pedido con seekingExpiresAt vencido de forma perezosa vía GET /v1/orders/mine", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const seeded = await seedStaleSeekingOrder({
        pool,
        email: "lazy-011@example.invalid",
        nit: "900011002",
        phoneE164: "+573001110122",
      });
      const mineRes = await request(server())
        .get("/v1/orders/mine")
        .set("Authorization", `Bearer ${seeded.ownerToken}`)
        .expect(200);
      const ordersList = record(mineRes.body)["orders"];
      expect(Array.isArray(ordersList)).toBe(true);
      const found = (ordersList as Array<{ id?: string; status?: string }>).find(
        (o) => o.id === seeded.orderId,
      );
      expect(found?.status).toBe("EXPIRED");
      const eventRow = await pool.query<{ reason: string; toStatus: string }>(
        `SELECT reason, "toStatus"::text AS "toStatus"
         FROM order_events WHERE "orderId" = $1 AND reason = 'seeking_expired'`,
        [seeded.orderId],
      );
      expect(eventRow.rows[0]?.toStatus).toBe("EXPIRED");
      const offerRow = await pool.query<{ status: string }>(
        `SELECT status::text AS status FROM dispatch_offers WHERE id = $1`,
        [seeded.offerId],
      );
      expect(offerRow.rows[0]?.status).toBe("EXPIRED");
    } finally {
      await pool.end();
    }
  });
});
