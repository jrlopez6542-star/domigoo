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
const draft = {
  name: "Tocancipa",
  offerRadiusMeters: 3000,
  directOfferTtlSeconds: 120,
  openOfferTtlSeconds: 90,
  seekingTtlSeconds: 600,
  maxOffersPerWave: 8,
  locationFreshnessSeconds: 120,
};

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

async function admin(email: string, role: string): Promise<string> {
  const created = await request(server())
    .post("/v1/auth/register")
    .send({
      email,
      password,
      client: "MOBILE",
      consents: { termsAccepted: true, privacyAccepted: true },
    })
    .expect(201);
  const pool = new Pool({ connectionString: databaseUrl });
  const user = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  await pool.query(
    `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
     VALUES ($1, 'Ops', $2::"PlatformRole", now(), now())`,
    [user.rows[0]?.id, role],
  );
  await pool.end();
  return String(record(created.body)["token"]);
}

describe("política operativa", () => {
  beforeAll(() => {
    migrateDatabase(databaseUrl);
  });

  beforeEach(async () => {
    resetLoginThrottle();
    await resetDatabase(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`DELETE FROM operations_policies`);
    await pool.end();
    currentApp = await createApp(testEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO" }));
  });

  afterEach(async () => {
    await currentApp?.close();
    currentApp = undefined;
  });

  it("publica con operaciones, audita y el índice impide dos publicadas", async () => {
    const token = await admin("politica@example.invalid", "OPERATIONS");
    const reviewer = await admin("revisor-politica@example.invalid", "REVIEWER");
    await request(server())
      .post("/v1/admin/policies")
      .set("Authorization", `Bearer ${reviewer}`)
      .send(draft)
      .expect(404);

    const created = await request(server())
      .post("/v1/admin/policies")
      .set("Authorization", `Bearer ${token}`)
      .send(draft)
      .expect(201);
    const id = String(record(created.body)["id"]);
    await request(server())
      .post("/v1/admin/policies/publish")
      .set("Authorization", `Bearer ${token}`)
      .send({ id })
      .expect(201);

    const pool = new Pool({ connectionString: databaseUrl });
    const audits = await pool.query(
      `SELECT action FROM audit_logs WHERE action = 'operations_policy.published'`,
    );
    await expect(
      pool.query(
        `INSERT INTO operations_policies (
           id, name, status, "offerRadiusMeters", "directOfferTtlSeconds", "openOfferTtlSeconds",
           "seekingTtlSeconds", "maxOffersPerWave", "locationFreshnessSeconds", "createdAt"
         ) VALUES (gen_random_uuid(), 'Otra', 'PUBLISHED', 1, 1, 1, 1, 1, 30, now())`,
      ),
    ).rejects.toThrow(/operations_policies_one_published|unique/i);
    await pool.end();
    expect(audits.rowCount).toBe(1);
  });
});
