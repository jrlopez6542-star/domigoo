import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, type AppEnv } from "../src/config/env.js";
import { testEnv } from "./test-env.js";
import { applyHttpSecurity } from "../src/http.js";
import { resetLoginThrottle } from "../src/identity/login-throttle.js";
import { setupOpenApi } from "../src/openapi.js";
import { migrateDatabase } from "./migrate.js";
import { resetDatabase } from "./reset-db.js";
import { Pool } from "pg";

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
  const response = await request(server())
    .post("/v1/auth/register")
    .send({
      email,
      password,
      client: "MOBILE",
      consents: { termsAccepted: true, privacyAccepted: true },
    });
  const token = (response.body as { token?: string }).token;
  if (response.status !== 201 || token === undefined) {
    throw new Error("No se pudo registrar");
  }
  return token;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("La respuesta no es un objeto");
  }
  return value as Record<string, unknown>;
}

describe("consentimiento", () => {
  beforeAll(() => {
    migrateDatabase(databaseUrl);
  });

  beforeEach(async () => {
    resetLoginThrottle();
    await resetDatabase(databaseUrl);
    currentApp = await createApp(testEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO" }));
  });

  afterEach(async () => {
    await currentApp?.close();
    currentApp = undefined;
  });

  it("conserva dos versiones, rechaza tipo incorrecto o versión desactualizada y deja de contar un consentimiento revocado (D19)", async () => {
    const adminToken = await register("aviso@example.invalid");
    const userToken = await register("persona-aviso@example.invalid");
    const pool = new Pool({ connectionString: databaseUrl });
    const admin = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'aviso@example.invalid'`,
    );
    const adminId = admin.rows[0]?.id;
    if (adminId === undefined) {
      throw new Error("No apareció el admin");
    }
    await pool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Aviso', 'SUPERADMIN', now(), now())`,
      [adminId],
    );
    await pool.end();

    const firstPrivacy = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ kind: "PRIVACY_NOTICE", version: "2026-01", content: "texto uno" })
      .expect(201);
    const secondPrivacy = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ kind: "PRIVACY_NOTICE", version: "2026-02", content: "texto dos" })
      .expect(201);
    expect(record(firstPrivacy.body)["id"]).not.toBe(record(secondPrivacy.body)["id"]);

    const firstGeo = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ kind: "GEOLOCATION_CONSENT", version: "2026-01-geo", content: "geo uno" })
      .expect(201);
    const secondGeo = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ kind: "GEOLOCATION_CONSENT", version: "2026-02-geo", content: "geo dos" })
      .expect(201);
    expect(record(firstGeo.body)["id"]).not.toBe(record(secondGeo.body)["id"]);

    // D19: documento de otro tipo para GEOLOCATION -> 422
    const wrongKind = await request(server())
      .post("/v1/consents")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        legalDocumentId: record(secondPrivacy.body)["id"],
        purpose: "GEOLOCATION",
        channel: "MOBILE",
      })
      .expect(422);
    expect(record(wrongKind.body)).toEqual({
      message: "El documento no corresponde al propósito del consentimiento",
    });

    // D19: versión no vigente del tipo correcto -> 422 con currentLegalDocumentId
    const outdated = await request(server())
      .post("/v1/consents")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        legalDocumentId: record(firstGeo.body)["id"],
        purpose: "GEOLOCATION",
        channel: "MOBILE",
      })
      .expect(422);
    expect(record(outdated.body)).toEqual({
      message: "La versión del documento está desactualizada",
      currentLegalDocumentId: record(secondGeo.body)["id"],
    });

    // Documento vigente del tipo correcto -> 201
    const consent = await request(server())
      .post("/v1/consents")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        legalDocumentId: record(secondGeo.body)["id"],
        purpose: "GEOLOCATION",
        channel: "MOBILE",
      })
      .expect(201);
    expect(record(consent.body)["legalDocumentId"]).toBe(record(secondGeo.body)["id"]);

    await request(server())
      .get("/v1/consents/current")
      .query({ purpose: "GEOLOCATION" })
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200)
      .expect({ active: true });

    await request(server())
      .post(`/v1/consents/${String(record(consent.body)["id"])}/revoke`)
      .set("Authorization", `Bearer ${userToken}`)
      .expect(201);

    await request(server())
      .get("/v1/consents/current")
      .query({ purpose: "GEOLOCATION" })
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200)
      .expect({ active: false });

    await request(server())
      .get("/v1/consents/current")
      .query({ purpose: "DOCUMENT_STORAGE" })
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200)
      .expect({ active: false });
  });
});
