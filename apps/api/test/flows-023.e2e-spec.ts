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
     SELECT id, 'Admin 023', 'SUPERADMIN', now(), now()
     FROM users WHERE email = $1`,
    [email],
  );
}

async function tableCount(pool: Pool, table: string): Promise<number> {
  const res = await pool.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM ${table}`);
  return res.rows[0]?.total ?? 0;
}

describe("ORDEN 023 - D19 parte 1: integridad de consentimientos en la API", () => {
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

  it("POST /v1/consents valida existencia, tipo y vigencia; sin escrituras al fallar; ORDER_CONTACT conserva comportamiento actual", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const adminReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "admin-consents-023@example.invalid",
          password,
          client: "ADMIN",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const adminCookie = sessionCookie(adminReg.headers);
      await promoteSuperadmin(pool, "admin-consents-023@example.invalid");

      const userReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "usuario-consents-023@example.invalid",
          password,
          client: "WEB",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const userCookie = sessionCookie(userReg.headers);

      const termsDoc = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "TERMS", version: "2026-023-terms", content: "Términos 023" })
        .expect(201);
      const termsId = String(record(termsDoc.body)["id"]);

      const geoV1 = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "GEOLOCATION_CONSENT", version: "2026-023-geo-1", content: "GPS v1" })
        .expect(201);
      const geoV1Id = String(record(geoV1.body)["id"]);

      const geoV2 = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "GEOLOCATION_CONSENT", version: "2026-023-geo-2", content: "GPS v2" })
        .expect(201);
      const geoV2Id = String(record(geoV2.body)["id"]);

      const consentsBefore = await tableCount(pool, "consent_records");
      const auditsBefore = await tableCount(pool, "audit_logs");

      // 1) Tipo incorrecto -> 422, sin escrituras
      const wrongKind = await request(server())
        .post("/v1/consents")
        .set("Cookie", userCookie)
        .send({ legalDocumentId: termsId, purpose: "GEOLOCATION", channel: "WEB" })
        .expect(422);
      expect(record(wrongKind.body)).toEqual({
        message: "El documento no corresponde al propósito del consentimiento",
      });
      expect(await tableCount(pool, "consent_records")).toBe(consentsBefore);
      expect(await tableCount(pool, "audit_logs")).toBe(auditsBefore);

      // 2) Existente pero no vigente -> 422 con currentLegalDocumentId correcto, sin escrituras
      const outdated = await request(server())
        .post("/v1/consents")
        .set("Cookie", userCookie)
        .send({ legalDocumentId: geoV1Id, purpose: "GEOLOCATION", channel: "WEB" })
        .expect(422);
      expect(record(outdated.body)).toEqual({
        message: "La versión del documento está desactualizada",
        currentLegalDocumentId: geoV2Id,
      });
      expect(await tableCount(pool, "consent_records")).toBe(consentsBefore);
      expect(await tableCount(pool, "audit_logs")).toBe(auditsBefore);

      // 3) Inexistente -> 404, sin escrituras
      await request(server())
        .post("/v1/consents")
        .set("Cookie", userCookie)
        .send({
          legalDocumentId: "00000000-0000-4000-8000-000000000000",
          purpose: "GEOLOCATION",
          channel: "WEB",
        })
        .expect(404);
      expect(await tableCount(pool, "consent_records")).toBe(consentsBefore);
      expect(await tableCount(pool, "audit_logs")).toBe(auditsBefore);

      // 4) Mal formado -> 422 sin cambio, sin escrituras
      const malformed = await request(server())
        .post("/v1/consents")
        .set("Cookie", userCookie)
        .send({ legalDocumentId: "no-es-uuid", purpose: "GEOLOCATION", channel: "WEB" })
        .expect(422);
      expect(record(malformed.body)).toEqual({
        message: "El identificador del documento legal es inválido",
      });
      expect(await tableCount(pool, "consent_records")).toBe(consentsBefore);
      expect(await tableCount(pool, "audit_logs")).toBe(auditsBefore);

      // 5) Tipo correcto vigente -> 201 y guarda exactamente 1 fila
      const validConsent = await request(server())
        .post("/v1/consents")
        .set("Cookie", userCookie)
        .send({ legalDocumentId: geoV2Id, purpose: "GEOLOCATION", channel: "WEB" })
        .expect(201);
      expect(record(validConsent.body)["legalDocumentId"]).toBe(geoV2Id);
      expect(typeof record(validConsent.body)["id"]).toBe("string");
      expect(await tableCount(pool, "consent_records")).toBe(consentsBefore + 1);

      // 6) ORDER_CONTACT queda fuera del mapa y conserva el comportamiento actual
      const orderContact = await request(server())
        .post("/v1/consents")
        .set("Cookie", userCookie)
        .send({ legalDocumentId: termsId, purpose: "ORDER_CONTACT", channel: "WEB" })
        .expect(201);
      expect(record(orderContact.body)["legalDocumentId"]).toBe(termsId);
      expect(await tableCount(pool, "consent_records")).toBe(consentsBefore + 2);
    } finally {
      await pool.end();
    }
  });

  it("empate de publishedAt se resuelve por id DESC de forma idéntica en current, registro y POST /v1/consents", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const tiedAt = "2026-11-24T12:00:00.000Z";
      const termsLowId = "10000000-0000-4000-8000-000000000001";
      const termsHighId = "f0000000-0000-4000-8000-000000000001";
      const privLowId = "10000000-0000-4000-8000-000000000002";
      const privHighId = "f0000000-0000-4000-8000-000000000002";
      const geoLowId = "10000000-0000-4000-8000-000000000003";
      const geoHighId = "f0000000-0000-4000-8000-000000000003";

      const rows: Array<[string, string, string, string]> = [
        [termsLowId, "TERMS", "2026-tie-low", "a".repeat(64)],
        [termsHighId, "TERMS", "2026-tie-high", "b".repeat(64)],
        [privLowId, "PRIVACY_NOTICE", "2026-tie-low", "c".repeat(64)],
        [privHighId, "PRIVACY_NOTICE", "2026-tie-high", "d".repeat(64)],
        [geoLowId, "GEOLOCATION_CONSENT", "2026-tie-low", "e".repeat(64)],
        [geoHighId, "GEOLOCATION_CONSENT", "2026-tie-high", "f".repeat(64)],
      ];
      for (const [id, kind, version, hash] of rows) {
        await pool.query(
          `INSERT INTO legal_documents (id, kind, version, "contentHash", "publishedAt")
           VALUES ($1, $2::"LegalDocumentKind", $3, $4, $5::timestamptz)`,
          [id, kind, version, hash, tiedAt],
        );
      }

      // 1) GET /v1/legal-documents/current elige el id mayor en cada tipo
      const currentRes = await request(server()).get("/v1/legal-documents/current").expect(200);
      const currentDocs = record(currentRes.body)["documents"] as Array<{
        id: string;
        kind: string;
        version: string;
      }>;
      const byKind = new Map(currentDocs.map((d) => [d.kind, d.id]));
      expect(byKind.get("TERMS")).toBe(termsHighId);
      expect(byKind.get("PRIVACY_NOTICE")).toBe(privHighId);
      expect(byKind.get("GEOLOCATION_CONSENT")).toBe(geoHighId);

      // 2) Registro sin versión elige los mismos id mayores y los devuelve en consents[]
      const regRes = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "empate-023@example.invalid",
          password,
          client: "WEB",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const regCookie = sessionCookie(regRes.headers);
      expect(record(regRes.body)["legalVersion"]).toBe("2026-tie-high");
      expect(record(regRes.body)["consents"]).toEqual([
        { purpose: "TERMS_ACCEPTANCE", legalDocumentId: termsHighId, version: "2026-tie-high" },
        { purpose: "ACCOUNT", legalDocumentId: privHighId, version: "2026-tie-high" },
      ]);

      // 3) POST /v1/consents rechaza el id menor del empate y acepta el id mayor
      const rejectedLow = await request(server())
        .post("/v1/consents")
        .set("Cookie", regCookie)
        .send({ legalDocumentId: geoLowId, purpose: "GEOLOCATION", channel: "WEB" })
        .expect(422);
      expect(record(rejectedLow.body)).toEqual({
        message: "La versión del documento está desactualizada",
        currentLegalDocumentId: geoHighId,
      });

      const acceptedHigh = await request(server())
        .post("/v1/consents")
        .set("Cookie", regCookie)
        .send({ legalDocumentId: geoHighId, purpose: "GEOLOCATION", channel: "WEB" })
        .expect(201);
      expect(record(acceptedHigh.body)["legalDocumentId"]).toBe(geoHighId);
    } finally {
      await pool.end();
    }
  });

  it("registro rechaza versión no vigente con 422 sin escrituras parciales y sin versión devuelve consents[] igual a consent_records", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const adminReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "admin-reg-023@example.invalid",
          password,
          client: "ADMIN",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const adminCookie = sessionCookie(adminReg.headers);
      await promoteSuperadmin(pool, "admin-reg-023@example.invalid");

      const termsV2 = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "TERMS", version: "2026-02", content: "Términos v2" })
        .expect(201);
      const termsV2Id = String(record(termsV2.body)["id"]);

      const privV2 = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "PRIVACY_NOTICE", version: "2026-02", content: "Privacidad v2" })
        .expect(201);
      const privV2Id = String(record(privV2.body)["id"]);

      const docProcV2 = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "DOCUMENT_PROCESSING", version: "2026-02", content: "Docs v2" })
        .expect(201);
      const docProcV2Id = String(record(docProcV2.body)["id"]);

      const usersBefore = await tableCount(pool, "users");
      const sessionsBefore = await tableCount(pool, "sessions");
      const consentsBefore = await tableCount(pool, "consent_records");
      const docsBefore = await tableCount(pool, "legal_documents");

      // 1) Registro con versión existente pero no vigente ("0.1-borrador") -> 422 sin escrituras
      const outdatedReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "vieja-023@example.invalid",
          password,
          client: "WEB",
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            version: "0.1-borrador",
          },
        })
        .expect(422);
      expect(record(outdatedReg.body)).toEqual({
        message: "La versión de los documentos legales está desactualizada",
      });
      expect(await tableCount(pool, "users")).toBe(usersBefore);
      expect(await tableCount(pool, "sessions")).toBe(sessionsBefore);
      expect(await tableCount(pool, "consent_records")).toBe(consentsBefore);
      expect(await tableCount(pool, "legal_documents")).toBe(docsBefore);

      // 2) Registro sin versión explícita -> 201 con consents[] coincidente con consent_records
      const okReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "domi-ok-023@example.invalid",
          password,
          client: "MOBILE",
          role: "COURIER",
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            sensitiveDataAccepted: true,
            marketingAccepted: true,
          },
        })
        .expect(201);

      const newUserId = String(record(okReg.body)["id"]);
      expect(record(okReg.body)["legalVersion"]).toBe("2026-02");
      expect(record(okReg.body)["consentPurposes"]).toEqual([
        "TERMS_ACCEPTANCE",
        "ACCOUNT",
        "DOCUMENT_STORAGE",
        "MARKETING",
      ]);
      const expectedConsents = [
        { purpose: "TERMS_ACCEPTANCE", legalDocumentId: termsV2Id, version: "2026-02" },
        { purpose: "ACCOUNT", legalDocumentId: privV2Id, version: "2026-02" },
        { purpose: "DOCUMENT_STORAGE", legalDocumentId: docProcV2Id, version: "2026-02" },
        { purpose: "MARKETING", legalDocumentId: privV2Id, version: "2026-02" },
      ];
      expect(record(okReg.body)["consents"]).toEqual(expectedConsents);

      const savedRows = await pool.query<{
        purpose: string;
        legalDocumentId: string;
        version: string;
      }>(
        `SELECT cr.purpose::text AS purpose, cr."legalDocumentId", ld.version
         FROM consent_records cr
         JOIN legal_documents ld ON ld.id = cr."legalDocumentId"
         WHERE cr."userId" = $1
         ORDER BY cr.purpose::text`,
        [newUserId],
      );
      const sortedExpected = [...expectedConsents].sort((a, b) =>
        a.purpose.localeCompare(b.purpose),
      );
      expect(savedRows.rows).toEqual(sortedExpected);
    } finally {
      await pool.end();
    }
  });
});
