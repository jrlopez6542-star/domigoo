import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, type AppEnv } from "../src/config/env.js";
import { applyHttpSecurity } from "../src/http.js";
import { resetLoginThrottle } from "../src/identity/login-throttle.js";
import { setupOpenApi } from "../src/openapi.js";
import { migrateDatabase } from "./migrate.js";
import { resetDatabase } from "./reset-db.js";
import { testEnv } from "./test-env.js";

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

async function promoteSuperadmin(pool: Pool, email: string): Promise<void> {
  await pool.query(
    `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
     SELECT id, 'Admin 025', 'SUPERADMIN', now(), now()
     FROM users WHERE email = $1`,
    [email],
  );
}

async function tableCount(pool: Pool, table: string): Promise<number> {
  const res = await pool.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM ${table}`);
  return res.rows[0]?.total ?? 0;
}

describe("ORDEN 025 - D19 parte 3: consents.documents por tipo en registro", () => {
  const env = testEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO" });

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

  it("acepta documents vigentes (incluido COURIER con versiones mixtas v2 + 0.1-borrador) y guarda consent_records exactos", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      // Sembrar 0.1-borrador y promover admin
      const adminReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "admin-025-ok@example.invalid",
          password,
          client: "ADMIN",
          role: "COURIER",
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            sensitiveDataAccepted: true,
          },
        })
        .expect(201);
      const adminCookie = sessionCookie(adminReg.headers);
      await promoteSuperadmin(pool, "admin-025-ok@example.invalid");

      // Publicar TERMS y PRIVACY_NOTICE en v2; DOCUMENT_PROCESSING queda en 0.1-borrador
      const termsV2 = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "TERMS", version: "2026-02", content: "Términos v2" })
        .expect(201);
      const privV2 = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "PRIVACY_NOTICE", version: "2026-02", content: "Privacidad v2" })
        .expect(201);

      const currentRes = await request(server()).get("/v1/legal-documents/current").expect(200);
      const currentDocs = record(currentRes.body)["documents"] as Array<{
        id: string;
        kind: string;
        version: string;
      }>;
      const byKind = new Map(currentDocs.map((d) => [d.kind, d]));
      const termsId = String(byKind.get("TERMS")?.id);
      const privId = String(byKind.get("PRIVACY_NOTICE")?.id);
      const docProcId = String(byKind.get("DOCUMENT_PROCESSING")?.id);

      expect(termsId).toBe(record(termsV2.body)["id"]);
      expect(privId).toBe(record(privV2.body)["id"]);
      expect(byKind.get("DOCUMENT_PROCESSING")?.version).toBe("0.1-borrador");

      // 1) CUSTOMER con documents vigentes -> 201 y consent_records apuntan a esos IDs
      const customerReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "cliente-025@example.invalid",
          password,
          client: "WEB",
          role: "CUSTOMER",
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            documents: { TERMS: termsId, PRIVACY_NOTICE: privId },
          },
        })
        .expect(201);
      const customerId = String(record(customerReg.body)["id"]);
      expect(record(customerReg.body)["consents"]).toEqual([
        { purpose: "TERMS_ACCEPTANCE", legalDocumentId: termsId, version: "2026-02" },
        { purpose: "ACCOUNT", legalDocumentId: privId, version: "2026-02" },
      ]);

      const customerRows = await pool.query<{ purpose: string; legalDocumentId: string }>(
        `SELECT purpose::text AS purpose, "legalDocumentId"
         FROM consent_records WHERE "userId" = $1 ORDER BY purpose::text`,
        [customerId],
      );
      expect(customerRows.rows).toEqual([
        { purpose: "ACCOUNT", legalDocumentId: privId },
        { purpose: "TERMS_ACCEPTANCE", legalDocumentId: termsId },
      ]);

      // 2) COURIER con version única "2026-02" falla porque DOCUMENT_PROCESSING está en 0.1-borrador
      await request(server())
        .post("/v1/auth/register")
        .send({
          email: "domi-version-unica-025@example.invalid",
          password,
          client: "MOBILE",
          role: "COURIER",
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            sensitiveDataAccepted: true,
            version: "2026-02",
          },
        })
        .expect(422);

      // 3) COURIER con documents por tipo (v2 + v2 + 0.1-borrador) -> 201
      const courierReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "domi-mixto-025@example.invalid",
          password,
          client: "MOBILE",
          role: "COURIER",
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            sensitiveDataAccepted: true,
            marketingAccepted: true,
            documents: {
              TERMS: termsId,
              PRIVACY_NOTICE: privId,
              DOCUMENT_PROCESSING: docProcId,
            },
          },
        })
        .expect(201);
      const courierId = String(record(courierReg.body)["id"]);
      expect(record(courierReg.body)["consents"]).toEqual([
        { purpose: "TERMS_ACCEPTANCE", legalDocumentId: termsId, version: "2026-02" },
        { purpose: "ACCOUNT", legalDocumentId: privId, version: "2026-02" },
        { purpose: "DOCUMENT_STORAGE", legalDocumentId: docProcId, version: "0.1-borrador" },
        { purpose: "MARKETING", legalDocumentId: privId, version: "2026-02" },
      ]);

      const courierRows = await pool.query<{ purpose: string; legalDocumentId: string }>(
        `SELECT purpose::text AS purpose, "legalDocumentId"
         FROM consent_records WHERE "userId" = $1 ORDER BY purpose::text`,
        [courierId],
      );
      expect(courierRows.rows).toEqual([
        { purpose: "ACCOUNT", legalDocumentId: privId },
        { purpose: "DOCUMENT_STORAGE", legalDocumentId: docProcId },
        { purpose: "MARKETING", legalDocumentId: privId },
        { purpose: "TERMS_ACCEPTANCE", legalDocumentId: termsId },
      ]);
    } finally {
      await pool.end();
    }
  });

  it("rechaza IDs no vigentes (422 + currentDocuments), otro tipo, inexistentes, mal formados, faltantes y version+documents incoherentes con +0 escrituras; sin documents sigue igual", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const adminReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "admin-025-err@example.invalid",
          password,
          client: "ADMIN",
          role: "COURIER",
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            sensitiveDataAccepted: true,
          },
        })
        .expect(201);
      const adminCookie = sessionCookie(adminReg.headers);
      await promoteSuperadmin(pool, "admin-025-err@example.invalid");

      const currentV1 = await request(server()).get("/v1/legal-documents/current").expect(200);
      const v1Docs = record(currentV1.body)["documents"] as Array<{ id: string; kind: string }>;
      const termsV1Id = String(v1Docs.find((d) => d.kind === "TERMS")?.id);

      const termsV2 = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "TERMS", version: "2026-02", content: "Términos v2" })
        .expect(201);
      const privV2 = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "PRIVACY_NOTICE", version: "2026-02", content: "Privacidad v2" })
        .expect(201);

      const termsV2Id = String(record(termsV2.body)["id"]);
      const privV2Id = String(record(privV2.body)["id"]);

      const usersBefore = await tableCount(pool, "users");
      const sessionsBefore = await tableCount(pool, "sessions");
      const consentsBefore = await tableCount(pool, "consent_records");

      // 1) ID existente pero no vigente -> 422 + currentDocuments
      const outdated = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "outdated-doc-025@example.invalid",
          password,
          client: "WEB",
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            documents: { TERMS: termsV1Id, PRIVACY_NOTICE: privV2Id },
          },
        })
        .expect(422);
      expect(record(outdated.body)).toEqual({
        message: "La versión de los documentos legales está desactualizada",
        currentDocuments: [
          { kind: "TERMS", id: termsV2Id, version: "2026-02" },
          { kind: "PRIVACY_NOTICE", id: privV2Id, version: "2026-02" },
        ],
      });

      // 2) ID de otro tipo -> 422 en español sin IDs ni enums
      const wrongKind = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "wrong-kind-025@example.invalid",
          password,
          client: "WEB",
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            documents: { TERMS: privV2Id, PRIVACY_NOTICE: privV2Id },
          },
        })
        .expect(422);
      expect(String(record(wrongKind.body)["message"])).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);

      // 3) ID inexistente -> 422
      const missingId = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "missing-id-025@example.invalid",
          password,
          client: "WEB",
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            documents: {
              TERMS: "00000000-0000-4000-8000-000000000000",
              PRIVACY_NOTICE: privV2Id,
            },
          },
        })
        .expect(422);
      expect(String(record(missingId.body)["message"])).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);

      // 4) UUID mal formado -> 422
      await request(server())
        .post("/v1/auth/register")
        .send({
          email: "bad-uuid-025@example.invalid",
          password,
          client: "WEB",
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            documents: { TERMS: "no-uuid", PRIVACY_NOTICE: privV2Id },
          },
        })
        .expect(422);

      // 5) Tipo requerido faltante -> 422
      await request(server())
        .post("/v1/auth/register")
        .send({
          email: "missing-kind-025@example.invalid",
          password,
          client: "MOBILE",
          role: "COURIER",
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            sensitiveDataAccepted: true,
            documents: { TERMS: termsV2Id, PRIVACY_NOTICE: privV2Id },
          },
        })
        .expect(422);

      // 6) version + documents incoherentes -> 422
      await request(server())
        .post("/v1/auth/register")
        .send({
          email: "incoherent-025@example.invalid",
          password,
          client: "WEB",
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            version: "0.1-borrador",
            documents: { TERMS: termsV2Id, PRIVACY_NOTICE: privV2Id },
          },
        })
        .expect(422);

      // Cero escrituras tras todos los rechazos
      expect(await tableCount(pool, "users")).toBe(usersBefore);
      expect(await tableCount(pool, "sessions")).toBe(sessionsBefore);
      expect(await tableCount(pool, "consent_records")).toBe(consentsBefore);

      // 7) Sin documents sigue exactamente igual que hoy -> 201 con los vigentes
      const legacyReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "sin-documents-025@example.invalid",
          password,
          client: "WEB",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      expect(record(legacyReg.body)["consents"]).toEqual([
        { purpose: "TERMS_ACCEPTANCE", legalDocumentId: termsV2Id, version: "2026-02" },
        { purpose: "ACCOUNT", legalDocumentId: privV2Id, version: "2026-02" },
      ]);
    } finally {
      await pool.end();
    }
  });
});
