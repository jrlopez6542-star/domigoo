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

function sessionCookie(headers: Record<string, unknown>): string {
  const raw = headers["set-cookie"];
  const first = Array.isArray(raw) ? String(raw[0] ?? "") : "";
  expect(first).toContain("domigoo_session=");
  return first;
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

async function countConsents(pool: Pool): Promise<number> {
  const res = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM consent_records`,
  );
  return res.rows[0]?.total ?? 0;
}

describe("legalDocumentId inválido o inexistente en POST /v1/consents (ORDEN 019)", () => {
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

  it("devuelve 422 si legalDocumentId está mal formado, 404 si no existe y 201 si existe, nunca 500", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const adminRes = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "admin-019@example.invalid",
          password,
          client: "ADMIN",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const adminCookie = sessionCookie(adminRes.headers);
      await pool.query(
        `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
         SELECT id, 'Admin 019', 'SUPERADMIN', now(), now()
         FROM users WHERE email = 'admin-019@example.invalid'`,
      );

      const userRes = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "usuario-019@example.invalid",
          password,
          client: "WEB",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const userCookie = sessionCookie(userRes.headers);

      const legalDoc = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({
          kind: "GEOLOCATION_CONSENT",
          version: "2026-019-geo",
          content: "Autorización de geolocalización 019",
        })
        .expect(201);
      const validDocumentId = String(record(legalDoc.body)["id"]);

      const consentsBefore = await countConsents(pool);

      // 1) legalDocumentId mal formado (no UUID) -> 422, nunca 500, sin filas nuevas
      for (const badId of ["no-es-uuid", "", "12345", "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"]) {
        const res = await request(server())
          .post("/v1/consents")
          .set("Cookie", userCookie)
          .send({
            legalDocumentId: badId,
            purpose: "GEOLOCATION",
            channel: "WEB",
          })
          .expect(422);
        expect(record(res.body)["message"]).toBe(
          "El identificador del documento legal es inválido",
        );
      }
      expect(await countConsents(pool)).toBe(consentsBefore);

      // 2) legalDocumentId bien formado (UUID) pero inexistente -> 404, nunca 500, sin filas nuevas
      const missingRes = await request(server())
        .post("/v1/consents")
        .set("Cookie", userCookie)
        .send({
          legalDocumentId: "00000000-0000-4000-8000-000000000000",
          purpose: "GEOLOCATION",
          channel: "WEB",
        })
        .expect(404);
      expect(record(missingRes.body)["statusCode"]).toBe(404);
      expect(await countConsents(pool)).toBe(consentsBefore);

      // 3) legalDocumentId válido existente -> 201 y persiste en consent_records
      const createdRes = await request(server())
        .post("/v1/consents")
        .set("Cookie", userCookie)
        .send({
          legalDocumentId: validDocumentId,
          purpose: "GEOLOCATION",
          channel: "WEB",
        })
        .expect(201);
      expect(record(createdRes.body)["legalDocumentId"]).toBe(validDocumentId);
      expect(typeof record(createdRes.body)["id"]).toBe("string");
      expect(await countConsents(pool)).toBe(consentsBefore + 1);
    } finally {
      await pool.end();
    }
  });
});
