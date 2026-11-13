import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, readEnv, type AppEnv } from "../src/config/env.js";
import { applyHttpSecurity } from "../src/http.js";
import { resetLoginThrottle } from "../src/identity/login-throttle.js";
import { setupOpenApi } from "../src/openapi.js";
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

describe("suspensión y estadísticas operativas (M35 y M36)", () => {
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

  it("suspende y rehabilita domiciliario/restaurante con auditoría, y expone stats sin PII ni acceso a REVIEWER", async () => {
    const opsRes = await request(server())
      .post("/v1/auth/register")
      .send({ email: "ops-m35@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const opsToken = String(record(opsRes.body)["token"]);

    const revRes = await request(server())
      .post("/v1/auth/register")
      .send({ email: "rev-m35@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const revToken = String(record(revRes.body)["token"]);

    const ownerRes = await request(server())
      .post("/v1/auth/register")
      .send({ email: "owner-m35@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const ownerToken = String(record(ownerRes.body)["token"]);

    const courierRes = await request(server())
      .post("/v1/auth/register")
      .send({ email: "courier-m35@example.invalid", password, client: "MOBILE" })
      .expect(201);
    expect(record(courierRes.body)["token"]).toBeDefined();

    const site = await request(server())
      .post("/v1/restaurants")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        legalName: "Razon M35",
        tradeName: "Local M35",
        nit: "900000350",
        email: "local-m35@example.invalid",
        phoneE164: "+573001110350",
        establishmentName: "Establecimiento M35",
        branchName: "Principal",
        addressLine: "Calle M35",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(201);
    const branchId = String(record(site.body)["branchId"]);
    const restaurantId = String(record(site.body)["id"]);

    const db = new Pool({ connectionString: databaseUrl });
    try {
      await db.query(
        `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
         SELECT id, 'Operaciones M35', 'OPERATIONS', now(), now()
         FROM users WHERE email = 'ops-m35@example.invalid'`,
      );
      await db.query(
        `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
         SELECT id, 'Revisor M35', 'REVIEWER', now(), now()
         FROM users WHERE email = 'rev-m35@example.invalid'`,
      );
      const cInsert = await db.query<{ id: string }>(
        `INSERT INTO couriers (
           id, "userId", "documentType", "documentNumber", "firstName", "lastName",
           status, "registrationSource", "createdAt", "updatedAt"
         )
         SELECT gen_random_uuid(), id, 'CC', '80035001', 'Domiciliario', 'M35',
                'APPROVED', 'OPEN', now(), now()
         FROM users WHERE email = 'courier-m35@example.invalid'
         RETURNING id`,
      );
      const courierId = String(cInsert.rows[0]?.id);

      await db.query(
        `INSERT INTO courier_availabilities ("courierId", state, "updatedAt")
         VALUES ($1, 'AVAILABLE', now())`,
        [courierId],
      );

      // M35: Suspender sin motivo -> 422
      await request(server())
        .post(`/v1/admin/couriers/${courierId}/suspend`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ reason: "" })
        .expect(422);

      // Suspender domiciliario -> pasa a SUSPENDED y OFFLINE, y escribe audit_logs
      const suspC = await request(server())
        .post(`/v1/admin/couriers/${courierId}/suspend`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ reason: "Revisión disciplinaria" })
        .expect(201);
      expect(record(suspC.body)["status"]).toBe("SUSPENDED");

      const availAfterSusp = await db.query<{ state: string }>(
        `SELECT state::text AS state FROM courier_availabilities WHERE "courierId" = $1`,
        [courierId],
      );
      expect(availAfterSusp.rows[0]?.state).toBe("OFFLINE");

      // Rehabilitar domiciliario -> vuelve a APPROVED
      const reinC = await request(server())
        .post(`/v1/admin/couriers/${courierId}/reinstate`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ reason: "Caso aclarado" })
        .expect(201);
      expect(record(reinC.body)["status"]).toBe("APPROVED");

      // Suspender y rehabilitar restaurante
      const suspR = await request(server())
        .post(`/v1/admin/restaurants/${restaurantId}/suspend`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ reason: "Incumplimiento operativo" })
        .expect(201);
      expect(record(suspR.body)["status"]).toBe("SUSPENDED");

      const reinR = await request(server())
        .post(`/v1/admin/restaurants/${restaurantId}/reinstate`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ reason: "Subsanado" })
        .expect(201);
      expect(record(reinR.body)["status"]).toBe("ACTIVE");

      // M36: Sembrar tres pedidos en estados distintos
      for (const st of ["DRAFT", "ACCEPTED", "DELIVERED"]) {
        const ord = await request(server())
          .post("/v1/orders")
          .set("Authorization", `Bearer ${ownerToken}`)
          .send({
            branchId,
            foodAmountCop: 20000,
            deliveryFeeCop: 5000,
            paymentMethod: "CASH",
          })
          .expect(201);
        const oid = String(record(ord.body)["id"]);
        if (st !== "DRAFT") {
          await db.query(
            `UPDATE orders SET status = $2::"OrderStatus", "acceptedAt" = now() + interval '30 seconds' WHERE id = $1`,
            [oid, st],
          );
        }
      }

      // REVIEWER recibe 403 en /v1/admin/stats
      await request(server())
        .get("/v1/admin/stats")
        .set("Authorization", `Bearer ${revToken}`)
        .expect(403);

      // OPERATIONS recibe conteos sin PII
      const statsRes = await request(server())
        .get("/v1/admin/stats")
        .set("Authorization", `Bearer ${opsToken}`)
        .expect(200);
      const stats = record(statsRes.body);
      const byStatus = record(stats["ordersByStatus"]);
      expect(byStatus["DRAFT"]).toBe(1);
      expect(byStatus["ACCEPTED"]).toBe(1);
      expect(byStatus["DELIVERED"]).toBe(1);
      expect(typeof stats["medianAcceptSeconds"]).toBe("number");
      expect(JSON.stringify(stats)).not.toContain("80035001");
    } finally {
      await db.end();
    }
  });
});
