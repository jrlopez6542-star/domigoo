import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, type AppEnv } from "../src/config/env.js";
import { testEnv } from "./test-env.js";
import { applyHttpSecurity } from "../src/http.js";
import { resetLoginThrottle } from "../src/identity/login-throttle.js";
import { setupOpenApi } from "../src/openapi.js";
import { migrateDatabase } from "./migrate.js";
import { resetDatabase } from "./reset-db.js";

const databaseUrl =
  process.env["DATABASE_URL"] ?? "postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo";
const password = "clave-de-prueba-12";
const declarationColumns = [
  "amountCop",
  "declaredAt",
  "declaredById",
  "id",
  "method",
  "note",
  "reference",
  "reviewedAt",
  "status",
  "subscriptionId",
];

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

async function register(email: string): Promise<string> {
  const created = await request(server())
    .post("/v1/auth/register")
    .send({
      email,
      password,
      client: "MOBILE",
      consents: { termsAccepted: true, privacyAccepted: true },
    })
    .expect(201);
  return String(record(created.body)["token"]);
}

async function admin(email: string): Promise<string> {
  const token = await register(email);
  const pool = new Pool({ connectionString: databaseUrl });
  const user = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  await pool.query(
    `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
     VALUES ($1, 'Ops', 'OPERATIONS', now(), now())`,
    [user.rows[0]?.id],
  );
  await pool.end();
  return token;
}

async function restaurant(token: string, nit: string): Promise<string> {
  const created = await request(server())
    .post("/v1/restaurants")
    .set("Authorization", `Bearer ${token}`)
    .send({
      legalName: "Razon suscripcion",
      tradeName: "Local suscripcion",
      nit,
      email: `${nit}@example.invalid`,
      phoneE164: `+57300${nit.slice(-7)}`,
      establishmentName: "Establecimiento",
      branchName: "Principal",
      addressLine: "Calle sintetica",
      longitude: -73.9132,
      latitude: 4.9655,
    })
    .expect(201);
  return String(record(created.body)["id"]);
}

async function plan(token: string, code: string): Promise<string> {
  const created = await request(server())
    .post("/v1/admin/plans")
    .set("Authorization", `Bearer ${token}`)
    .send({
      code,
      name: "Mensual",
      priceCop: 45000,
      periodDays: 30,
      trialDays: 7,
      maxBranches: 1,
      maxConcurrentOrders: 3,
    })
    .expect(201);
  return String(record(created.body)["id"]);
}

describe("suscripción sin pasarela", () => {
  beforeAll(() => {
    migrateDatabase(databaseUrl);
  });

  beforeEach(async () => {
    resetLoginThrottle();
    await resetDatabase(databaseUrl);
    currentApp = await createApp(
      testEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO", BILLING_ENABLED: "true" }),
    );
  });

  afterEach(async () => {
    await currentApp?.close();
    currentApp = undefined;
  });

  it("asigna automáticamente prueba gratuita de 15 días (priceCop=0) al registrar restaurante y no bloquea al vencer cuando BILLING_ENABLED=false", async () => {
    await currentApp?.close();
    currentApp = await createApp(testEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO" }));

    const owner = await register("dueno-trial15@example.invalid");
    const ops = await admin("ops-trial15@example.invalid");

    // Rechaza restaurante fuera de la zona de cobertura de Tocancipá (ej. Bogotá)
    const outside = await request(server())
      .post("/v1/restaurants")
      .set("Authorization", `Bearer ${owner}`)
      .send({
        legalName: "Fuera de Zona SAS",
        tradeName: "Local Bogota",
        nit: "900000399",
        email: "bogota@example.invalid",
        phoneE164: "+573000000399",
        establishmentName: "Establecimiento Bogota",
        branchName: "Bogota Centro",
        addressLine: "Carrera 7 # 11-10",
        longitude: -74.076,
        latitude: 4.5981,
      })
      .expect(422);
    expect(String(record(outside.body)["message"])).toMatch(/Tocancipá/i);

    const restaurantId = await restaurant(owner, "900000300");

    const pool = new Pool({ connectionString: databaseUrl });
    const autoSub = await pool.query<{
      status: string;
      priceCop: number;
      code: string;
      trialDays: number;
    }>(
      `SELECT s.status::text AS status, s."priceCop", p.code, p."trialDays"
       FROM restaurant_subscriptions s
       JOIN subscription_plans p ON p.id = s."planId"
       WHERE s."restaurantId" = $1 AND s."isCurrent"`,
      [restaurantId],
    );
    expect(autoSub.rows[0]).toEqual({
      status: "TRIAL",
      priceCop: 0,
      code: "TRIAL_15D",
      trialDays: 15,
    });

    // Simular vencimiento de los 15 días de prueba con BILLING_ENABLED=false (por defecto)
    await pool.query(
      `UPDATE restaurant_subscriptions SET "periodEndsAt" = now() - interval '2 days' WHERE "restaurantId" = $1`,
      [restaurantId],
    );
    await pool.end();

    const advanced = await request(server())
      .post("/v1/admin/subscriptions/advance")
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);
    expect(record(advanced.body)["changed"]).toBe(0);

    await request(server())
      .get(`/v1/restaurants/${restaurantId}/dispatch-gate`)
      .set("Authorization", `Bearer ${owner}`)
      .expect(200);
  });

  it("copia el precio y suspende una prueba vencida sin duplicar el evento", async () => {
    const owner = await register("dueno-prueba@example.invalid");
    const ops = await admin("ops-prueba@example.invalid");
    const restaurantId = await restaurant(owner, "900000301");
    const planId = await plan(ops, "mensual-prueba");
    const opened = await request(server())
      .post("/v1/admin/subscriptions")
      .set("Authorization", `Bearer ${ops}`)
      .send({ restaurantId, planId, status: "TRIAL" })
      .expect(201);
    expect(record(opened.body)["priceCop"]).toBe(45000);

    const pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`UPDATE subscription_plans SET "priceCop" = 99000 WHERE id = $1`, [planId]);
    await pool.query(
      `UPDATE restaurant_subscriptions SET "periodEndsAt" = now() - interval '1 minute' WHERE "restaurantId" = $1`,
      [restaurantId],
    );
    const copied = await pool.query<{ priceCop: number }>(
      `SELECT "priceCop" FROM restaurant_subscriptions WHERE "restaurantId" = $1`,
      [restaurantId],
    );
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'subscription_payment_declarations'
       ORDER BY column_name`,
    );
    await pool.end();
    expect(copied.rows[0]?.priceCop).toBe(45000);
    expect(columns.rows.map((row) => row.column_name)).toEqual(declarationColumns);

    await request(server())
      .get(`/v1/restaurants/${restaurantId}/dispatch-gate`)
      .set("Authorization", `Bearer ${owner}`)
      .expect(422);
    await request(server())
      .post("/v1/admin/subscriptions/advance")
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);
    await request(server())
      .post("/v1/admin/subscriptions/advance")
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);

    const after = new Pool({ connectionString: databaseUrl });
    const status = await after.query<{ status: string }>(
      `SELECT status::text AS status FROM restaurant_subscriptions WHERE "restaurantId" = $1`,
      [restaurantId],
    );
    const events = await after.query(
      `SELECT reason FROM subscription_events WHERE reason = 'period_elapsed'`,
    );
    await after.end();
    expect(status.rows[0]?.status).toBe("SUSPENDED");
    expect(events.rowCount).toBe(1);
  });

  it("pasa a mora, reconoce el pago sin cliente HTTP y vuelve a permitir despachar", async () => {
    const owner = await register("dueno-activo@example.invalid");
    const stranger = await register("ajeno-activo@example.invalid");
    const ops = await admin("ops-activo@example.invalid");
    const restaurantId = await restaurant(owner, "900000302");
    const planId = await plan(ops, "mensual-activo");
    await request(server())
      .post("/v1/admin/subscriptions")
      .set("Authorization", `Bearer ${ops}`)
      .send({ restaurantId, planId, status: "ACTIVE" })
      .expect(201);
    await request(server())
      .get(`/v1/restaurants/${restaurantId}/dispatch-gate`)
      .set("Authorization", `Bearer ${owner}`)
      .expect(200);
    await request(server())
      .get(`/v1/restaurants/${restaurantId}/dispatch-gate`)
      .set("Authorization", `Bearer ${stranger}`)
      .expect(404);

    const pool = new Pool({ connectionString: databaseUrl });
    await pool.query(
      `UPDATE restaurant_subscriptions SET "periodEndsAt" = now() - interval '1 minute' WHERE "restaurantId" = $1`,
      [restaurantId],
    );
    await pool.end();

    await request(server())
      .post("/v1/admin/subscriptions/advance")
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);
    const due = new Pool({ connectionString: databaseUrl });
    const mora = await due.query<{ status: string }>(
      `SELECT status::text AS status FROM restaurant_subscriptions WHERE "restaurantId" = $1`,
      [restaurantId],
    );
    await due.end();
    expect(mora.rows[0]?.status).toBe("PAST_DUE");
    await request(server())
      .get(`/v1/restaurants/${restaurantId}/dispatch-gate`)
      .set("Authorization", `Bearer ${owner}`)
      .expect(422);

    const declared = await request(server())
      .post(`/v1/restaurants/${restaurantId}/subscription/declarations`)
      .set("Authorization", `Bearer ${owner}`)
      .send({ amountCop: 45000, method: "TRANSFER", reference: "COMP-1" })
      .expect(201);
    await request(server())
      .post(`/v1/admin/declarations/${String(record(declared.body)["id"])}/acknowledge`)
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);
    await request(server())
      .get(`/v1/restaurants/${restaurantId}/dispatch-gate`)
      .set("Authorization", `Bearer ${owner}`)
      .expect(200);

    const after = new Pool({ connectionString: databaseUrl });
    const row = await after.query<{ status: string; priceCop: number; declaration: string }>(
      `SELECT s.status::text AS status, s."priceCop", d.status::text AS declaration
       FROM restaurant_subscriptions s
       JOIN subscription_payment_declarations d ON d."subscriptionId" = s.id
       WHERE s."restaurantId" = $1 AND s."periodEndsAt" > now()`,
      [restaurantId],
    );
    await after.end();
    expect(row.rows[0]?.status).toBe("ACTIVE");
    expect(row.rows[0]?.priceCop).toBe(45000);
    expect(row.rows[0]?.declaration).toBe("ACKNOWLEDGED");

    const sourceDir = join(dirname(fileURLToPath(import.meta.url)), "../src/subscriptions");
    const source = readdirSync(sourceDir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(join(sourceDir, name), "utf8"))
      .join("\n");
    for (const client of ["node:http", "node:https", "undici", "axios"]) {
      expect(source.includes(client)).toBe(false);
    }
    expect(source.includes("fetch(")).toBe(false);
  });
});
