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

async function register(email: string): Promise<string> {
  const created = await request(server())
    .post("/v1/auth/register")
    .send({ email, password, client: "MOBILE" })
    .expect(201);
  return String(record(created.body)["token"]);
}

async function reviewer(): Promise<string> {
  const token = await register("revisor-alta@example.invalid");
  const pool = new Pool({ connectionString: databaseUrl });
  const user = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email = 'revisor-alta@example.invalid'`,
  );
  await pool.query(
    `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
     VALUES ($1, 'Revisor', 'REVIEWER', now(), now())`,
    [user.rows[0]?.id],
  );
  await pool.end();
  return token;
}

describe("registro abierto de domiciliario", () => {
  beforeAll(() => {
    migrateDatabase(databaseUrl);
  });

  beforeEach(async () => {
    resetLoginThrottle();
    await resetDatabase(databaseUrl);
    currentApp = await createApp(readEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO" }));
  });

  afterEach(async () => {
    await currentApp?.close();
    currentApp = undefined;
  });

  it("exige consentimiento, queda en REGISTERING y rechaza el documento repetido", async () => {
    const admin = await reviewer();
    const first = await register("domi-uno@example.invalid");
    const second = await register("domi-dos@example.invalid");
    const published = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        kind: "DOCUMENT_PROCESSING",
        version: "2026-01",
        content: "Texto sintetico de tratamiento de documentos de prueba",
      })
      .expect(201);
    const profile = {
      documentType: "CC",
      documentNumber: "9000000011",
      firstName: "Persona",
      lastName: "Sintetica",
    };

    await request(server())
      .post("/v1/couriers")
      .set("Authorization", `Bearer ${first}`)
      .send(profile)
      .expect(422);

    await request(server())
      .post("/v1/consents")
      .set("Authorization", `Bearer ${first}`)
      .send({
        legalDocumentId: record(published.body)["id"],
        purpose: "DOCUMENT_STORAGE",
        channel: "MOBILE",
      })
      .expect(201);
    await request(server())
      .post("/v1/consents")
      .set("Authorization", `Bearer ${second}`)
      .send({
        legalDocumentId: record(published.body)["id"],
        purpose: "DOCUMENT_STORAGE",
        channel: "MOBILE",
      })
      .expect(201);

    const created = await request(server())
      .post("/v1/couriers")
      .set("Authorization", `Bearer ${first}`)
      .send(profile)
      .expect(201);
    expect(record(created.body)["status"]).toBe("REGISTERING");

    const pool = new Pool({ connectionString: databaseUrl });
    const stored = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM couriers WHERE id = $1`,
      [record(created.body)["id"]],
    );
    await pool.end();
    expect(stored.rows[0]?.status).toBe("REGISTERING");

    await request(server())
      .post("/v1/couriers")
      .set("Authorization", `Bearer ${second}`)
      .send(profile)
      .expect(409);
  });
});
