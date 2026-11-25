import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../prisma/migrations");
const d19MigrationDir = path.join(migrationsDir, "20261125120000_d19_legal_consents_immutability");
const m45DownPath = path.join(
  migrationsDir,
  "20261117150000_m45_legal_registration_consents",
  "down.sql",
);

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

async function promoteSuperadmin(pool: Pool, email: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
     SELECT id, 'Admin 024', 'SUPERADMIN', now(), now()
     FROM users WHERE email = $1
     RETURNING "userId" AS id`,
    [email],
  );
  const id = res.rows[0]?.id;
  if (id === undefined) {
    throw new Error("No se pudo promover al admin");
  }
  return id;
}

async function expectSqlReject(
  pool: Pool,
  sql: string,
  params: unknown[],
  expectedSubstring: string,
): Promise<void> {
  let caught: unknown = null;
  try {
    await pool.query(sql, params);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toContain(expectedSubstring);
}

describe("ORDEN 024 - D19 parte 2: inmutabilidad en BD de legal_documents y consent_records", () => {
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

  it("legal_documents guarda copia inmutable del texto (sha256 = contentHash) y bloquea UPDATE y DELETE por SQL", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const adminReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "admin-legal-024@example.invalid",
          password,
          client: "ADMIN",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const adminCookie = sessionCookie(adminReg.headers);
      await promoteSuperadmin(pool, "admin-legal-024@example.invalid");

      const content =
        "Términos y condiciones DOMIGOO — versión 2026-024\nCláusula 1: texto inmutable con acentos y ñ.";
      const expectedHash = createHash("sha256").update(content).digest("hex");

      const published = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "GEOLOCATION_CONSENT", version: "2026-024-geo", content })
        .expect(201);
      const docId = String(record(published.body)["id"]);
      expect(record(published.body)["contentHash"]).toBe(expectedHash);

      const beforeQ = await pool.query<{
        id: string;
        kind: string;
        version: string;
        contentHash: string;
        content: string | null;
        publishedAt: string;
      }>(
        `SELECT id, kind::text AS kind, version, "contentHash", content, "publishedAt"::text AS "publishedAt"
         FROM legal_documents
         WHERE id = $1`,
        [docId],
      );
      const before = beforeQ.rows[0];
      expect(before).toBeDefined();
      expect(before?.content).toBe(content);
      expect(
        createHash("sha256")
          .update(before?.content ?? "")
          .digest("hex"),
      ).toBe(before?.contentHash);

      // UPDATE sobre cualquier columna falla por trigger
      await expectSqlReject(
        pool,
        `UPDATE legal_documents SET content = 'texto alterado' WHERE id = $1`,
        [docId],
        "legal_documents es inmutable",
      );
      await expectSqlReject(
        pool,
        `UPDATE legal_documents SET "contentHash" = $2 WHERE id = $1`,
        [docId, "0".repeat(64)],
        "legal_documents es inmutable",
      );
      await expectSqlReject(
        pool,
        `UPDATE legal_documents SET version = '2026-024-edit' WHERE id = $1`,
        [docId],
        "legal_documents es inmutable",
      );
      await expectSqlReject(
        pool,
        `UPDATE legal_documents SET "publishedAt" = now() - interval '1 day' WHERE id = $1`,
        [docId],
        "legal_documents es inmutable",
      );

      // DELETE sobre documento sin consentimientos también falla por trigger (antes de FK)
      await expectSqlReject(
        pool,
        `DELETE FROM legal_documents WHERE id = $1`,
        [docId],
        "legal_documents es inmutable",
      );

      const afterQ = await pool.query<{
        id: string;
        kind: string;
        version: string;
        contentHash: string;
        content: string | null;
        publishedAt: string;
      }>(
        `SELECT id, kind::text AS kind, version, "contentHash", content, "publishedAt"::text AS "publishedAt"
         FROM legal_documents
         WHERE id = $1`,
        [docId],
      );
      expect(afterQ.rows[0]).toEqual(before);
    } finally {
      await pool.end();
    }
  });

  it("consent_records bloquea DELETE y UPDATE fuera de primera revocación; API revoca una vez, segunda responde 404 sin cambiar fila, y DSR REVOCATION sigue funcionando", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const adminReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "admin-consent-024@example.invalid",
          password,
          client: "ADMIN",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const adminCookie = sessionCookie(adminReg.headers);
      const adminUserId = await promoteSuperadmin(pool, "admin-consent-024@example.invalid");

      const geoDoc = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "GEOLOCATION_CONSENT", version: "2026-024-geo", content: "GPS 024" })
        .expect(201);
      const geoDocId = String(record(geoDoc.body)["id"]);

      const termsDoc = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "TERMS", version: "2026-024-terms", content: "Términos 024" })
        .expect(201);
      const termsDocId = String(record(termsDoc.body)["id"]);

      const userReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "user-consent-024@example.invalid",
          password,
          client: "WEB",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const userCookie = sessionCookie(userReg.headers);

      const granted = await request(server())
        .post("/v1/consents")
        .set("Cookie", userCookie)
        .set("User-Agent", "domigoo-e2e-024")
        .send({ legalDocumentId: geoDocId, purpose: "GEOLOCATION", channel: "WEB" })
        .expect(201);
      const consentId = String(record(granted.body)["id"]);

      type ConsentRow = {
        id: string;
        userId: string;
        legalDocumentId: string;
        purpose: string;
        channel: string;
        grantedAt: string;
        revokedAt: string | null;
        ip: string | null;
        userAgent: string | null;
      };
      const loadConsent = async (id: string): Promise<ConsentRow | undefined> => {
        const res = await pool.query<ConsentRow>(
          `SELECT id, "userId", "legalDocumentId", purpose::text AS purpose, channel::text AS channel,
                  "grantedAt"::text AS "grantedAt", "revokedAt"::text AS "revokedAt", ip, "userAgent"
           FROM consent_records
           WHERE id = $1`,
          [id],
        );
        return res.rows[0];
      };

      const snapshot = await loadConsent(consentId);
      expect(snapshot).toBeDefined();
      expect(snapshot?.revokedAt).toBeNull();
      expect(snapshot?.userAgent).toBe("domigoo-e2e-024");

      // DELETE falla
      await expectSqlReject(
        pool,
        `DELETE FROM consent_records WHERE id = $1`,
        [consentId],
        "consent_records es inmutable",
      );

      // UPDATE de cualquier columna distinta de revokedAt falla (sola y junto con revokedAt)
      await expectSqlReject(
        pool,
        `UPDATE consent_records SET id = gen_random_uuid() WHERE id = $1`,
        [consentId],
        "consent_records es inmutable",
      );
      await expectSqlReject(
        pool,
        `UPDATE consent_records SET "userId" = $2 WHERE id = $1`,
        [consentId, adminUserId],
        "consent_records es inmutable",
      );
      await expectSqlReject(
        pool,
        `UPDATE consent_records SET "legalDocumentId" = $2 WHERE id = $1`,
        [consentId, termsDocId],
        "consent_records es inmutable",
      );
      await expectSqlReject(
        pool,
        `UPDATE consent_records SET purpose = 'MARKETING'::"ConsentPurpose" WHERE id = $1`,
        [consentId],
        "consent_records es inmutable",
      );
      await expectSqlReject(
        pool,
        `UPDATE consent_records SET channel = 'MOBILE'::"ConsentChannel" WHERE id = $1`,
        [consentId],
        "consent_records es inmutable",
      );
      await expectSqlReject(
        pool,
        `UPDATE consent_records SET "grantedAt" = "grantedAt" - interval '1 hour' WHERE id = $1`,
        [consentId],
        "consent_records es inmutable",
      );
      await expectSqlReject(
        pool,
        `UPDATE consent_records SET ip = '203.0.113.99' WHERE id = $1`,
        [consentId],
        "consent_records es inmutable",
      );
      await expectSqlReject(
        pool,
        `UPDATE consent_records SET "userAgent" = 'alterado-ua' WHERE id = $1`,
        [consentId],
        "consent_records es inmutable",
      );
      await expectSqlReject(
        pool,
        `UPDATE consent_records SET "revokedAt" = NULL WHERE id = $1`,
        [consentId],
        "consent_records es inmutable",
      );
      await expectSqlReject(
        pool,
        `UPDATE consent_records SET "revokedAt" = now(), purpose = 'MARKETING'::"ConsentPurpose" WHERE id = $1`,
        [consentId],
        "consent_records es inmutable",
      );
      await expectSqlReject(
        pool,
        `UPDATE consent_records SET "revokedAt" = now(), ip = '203.0.113.99' WHERE id = $1`,
        [consentId],
        "consent_records es inmutable",
      );
      await expectSqlReject(
        pool,
        `UPDATE consent_records SET "revokedAt" = now(), "userAgent" = NULL WHERE id = $1`,
        [consentId],
        "consent_records es inmutable",
      );

      expect(await loadConsent(consentId)).toEqual(snapshot);

      // Revocación legítima por API funciona una vez
      await request(server())
        .post(`/v1/consents/${consentId}/revoke`)
        .set("Cookie", userCookie)
        .expect(201)
        .expect({ revoked: true });

      const afterFirstRevoke = await loadConsent(consentId);
      expect(afterFirstRevoke?.revokedAt).not.toBeNull();
      expect({ ...afterFirstRevoke, revokedAt: null }).toEqual(snapshot);

      // Segunda revocación por API responde 404 y no cambia la fila
      await request(server())
        .post(`/v1/consents/${consentId}/revoke`)
        .set("Cookie", userCookie)
        .expect(404);
      expect(await loadConsent(consentId)).toEqual(afterFirstRevoke);

      // Segunda revocación o borrado de revokedAt por SQL falla
      await expectSqlReject(
        pool,
        `UPDATE consent_records SET "revokedAt" = now() + interval '1 minute' WHERE id = $1`,
        [consentId],
        "consent_records es inmutable",
      );
      await expectSqlReject(
        pool,
        `UPDATE consent_records SET "revokedAt" = NULL WHERE id = $1`,
        [consentId],
        "consent_records es inmutable",
      );
      await expectSqlReject(
        pool,
        `DELETE FROM consent_records WHERE id = $1`,
        [consentId],
        "consent_records es inmutable",
      );
      expect(await loadConsent(consentId)).toEqual(afterFirstRevoke);

      // Revocación GEOLOCATION por habeas data (privacy.repository.ts:260) sigue funcionando
      const grantedAgain = await request(server())
        .post("/v1/consents")
        .set("Cookie", userCookie)
        .send({ legalDocumentId: geoDocId, purpose: "GEOLOCATION", channel: "WEB" })
        .expect(201);
      const secondConsentId = String(record(grantedAgain.body)["id"]);

      const dsr = await request(server())
        .post("/v1/data-subject-requests")
        .set("Cookie", userCookie)
        .send({ type: "REVOCATION", note: "Revocar GPS" })
        .expect(201);
      const dsrId = String(record(dsr.body)["id"]);

      await request(server())
        .post(`/v1/data-subject-requests/${dsrId}/process`)
        .set("Cookie", userCookie)
        .send({ action: "COMPLETE" })
        .expect(201);

      const afterDsr = await loadConsent(secondConsentId);
      expect(afterDsr?.revokedAt).not.toBeNull();
      await request(server())
        .get("/v1/consents/current")
        .query({ purpose: "GEOLOCATION" })
        .set("Cookie", userCookie)
        .expect(200)
        .expect({ active: false });
    } finally {
      await pool.end();
    }
  });

  it("publicar una versión nueva no altera las aceptaciones previas (legalDocumentId, grantedAt y version aceptada iguales)", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const adminReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "admin-ver-024@example.invalid",
          password,
          client: "ADMIN",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const adminCookie = sessionCookie(adminReg.headers);
      await promoteSuperadmin(pool, "admin-ver-024@example.invalid");

      const termsV1 = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "TERMS", version: "2026-024-v1", content: "Términos v1" })
        .expect(201);
      const privV1 = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "PRIVACY_NOTICE", version: "2026-024-v1", content: "Privacidad v1" })
        .expect(201);
      const geoV1 = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "GEOLOCATION_CONSENT", version: "2026-024-v1", content: "GPS v1" })
        .expect(201);

      const userA = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "user-a-024@example.invalid",
          password,
          client: "WEB",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const userAId = String(record(userA.body)["id"]);
      const userACookie = sessionCookie(userA.headers);

      await request(server())
        .post("/v1/consents")
        .set("Cookie", userACookie)
        .send({
          legalDocumentId: record(geoV1.body)["id"],
          purpose: "GEOLOCATION",
          channel: "WEB",
        })
        .expect(201);

      type AcceptanceRow = {
        id: string;
        purpose: string;
        legalDocumentId: string;
        grantedAt: string;
        version: string;
        contentHash: string;
        content: string | null;
      };
      const loadUserAcceptances = async (userId: string): Promise<AcceptanceRow[]> => {
        const res = await pool.query<AcceptanceRow>(
          `SELECT cr.id, cr.purpose::text AS purpose, cr."legalDocumentId",
                  cr."grantedAt"::text AS "grantedAt", ld.version, ld."contentHash", ld.content
           FROM consent_records cr
           JOIN legal_documents ld ON ld.id = cr."legalDocumentId"
           WHERE cr."userId" = $1
           ORDER BY cr.purpose::text`,
          [userId],
        );
        return res.rows;
      };

      const beforeNewVersion = await loadUserAcceptances(userAId);
      expect(beforeNewVersion).toHaveLength(3);
      expect(beforeNewVersion.map((r) => ({ purpose: r.purpose, version: r.version }))).toEqual([
        { purpose: "ACCOUNT", version: "2026-024-v1" },
        { purpose: "GEOLOCATION", version: "2026-024-v1" },
        { purpose: "TERMS_ACCEPTANCE", version: "2026-024-v1" },
      ]);
      expect(beforeNewVersion.find((r) => r.purpose === "TERMS_ACCEPTANCE")?.legalDocumentId).toBe(
        record(termsV1.body)["id"],
      );
      expect(beforeNewVersion.find((r) => r.purpose === "ACCOUNT")?.legalDocumentId).toBe(
        record(privV1.body)["id"],
      );
      expect(beforeNewVersion.find((r) => r.purpose === "GEOLOCATION")?.legalDocumentId).toBe(
        record(geoV1.body)["id"],
      );

      // Publicar v2 de todos los documentos
      await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "TERMS", version: "2026-024-v2", content: "Términos v2" })
        .expect(201);
      await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "PRIVACY_NOTICE", version: "2026-024-v2", content: "Privacidad v2" })
        .expect(201);
      await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "GEOLOCATION_CONSENT", version: "2026-024-v2", content: "GPS v2" })
        .expect(201);

      // Las aceptaciones previas de userA siguen idénticas (legalDocumentId, grantedAt, version, content)
      const afterNewVersion = await loadUserAcceptances(userAId);
      expect(afterNewVersion).toEqual(beforeNewVersion);

      // Un usuario nuevo registra con v2 mientras userA conserva v1
      const userB = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "user-b-024@example.invalid",
          password,
          client: "WEB",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      expect(record(userB.body)["legalVersion"]).toBe("2026-024-v2");
      expect(await loadUserAcceptances(userAId)).toEqual(beforeNewVersion);
    } finally {
      await pool.end();
    }
  });

  it("migración aplicada sobre una BD que ya tiene aceptaciones preserva filas previas, activa inmutabilidad y m45 down.sql funciona con el trigger", async () => {
    const upSql = fs.readFileSync(path.join(d19MigrationDir, "migration.sql"), "utf8");
    const downSql = fs.readFileSync(path.join(d19MigrationDir, "down.sql"), "utf8");
    const m45DownSql = fs.readFileSync(m45DownPath, "utf8");

    const pool = new Pool({ connectionString: databaseUrl });
    let reapplied = false;
    try {
      // 1) Simular BD previa a D19 parte 2 ejecutando down.sql
      await pool.query(downSql);

      const colCheck = await pool.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = 'legal_documents' AND column_name = 'content'`,
      );
      expect(colCheck.rows).toHaveLength(0);

      // 2) Insertar usuario, documento legal previo (sin columna content) y aceptaciones previas
      const userRes = await pool.query<{ id: string }>(
        `INSERT INTO users (id, email, "passwordHash", status, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), 'previo-024@example.invalid', 'hash', 'ACTIVE', now(), now())
         RETURNING id`,
      );
      const userId = userRes.rows[0]?.id;
      if (userId === undefined) {
        throw new Error("No se insertó el usuario previo");
      }

      const legacyDocRes = await pool.query<{ id: string; publishedAt: string }>(
        `INSERT INTO legal_documents (id, kind, version, "contentHash", "publishedAt")
         VALUES (gen_random_uuid(), 'TERMS'::"LegalDocumentKind", '2026-legacy', $1, now())
         RETURNING id, "publishedAt"::text AS "publishedAt"`,
        ["a".repeat(64)],
      );
      const legacyDocId = legacyDocRes.rows[0]?.id;
      if (legacyDocId === undefined) {
        throw new Error("No se insertó el documento previo");
      }

      const activeConsentRes = await pool.query<{ id: string; grantedAt: string }>(
        `INSERT INTO consent_records (id, "userId", "legalDocumentId", purpose, channel, "grantedAt")
         VALUES (gen_random_uuid(), $1, $2, 'TERMS_ACCEPTANCE'::"ConsentPurpose", 'WEB'::"ConsentChannel", now())
         RETURNING id, "grantedAt"::text AS "grantedAt"`,
        [userId, legacyDocId],
      );
      const activeConsentId = activeConsentRes.rows[0]?.id;
      const activeGrantedAt = activeConsentRes.rows[0]?.grantedAt;
      if (activeConsentId === undefined || activeGrantedAt === undefined) {
        throw new Error("No se insertó la aceptación activa previa");
      }

      const revokedConsentRes = await pool.query<{ id: string; revokedAt: string }>(
        `INSERT INTO consent_records (id, "userId", "legalDocumentId", purpose, channel, "grantedAt", "revokedAt")
         VALUES (gen_random_uuid(), $1, $2, 'MARKETING'::"ConsentPurpose", 'WEB'::"ConsentChannel", now() - interval '2 hours', now() - interval '1 hour')
         RETURNING id, "revokedAt"::text AS "revokedAt"`,
        [userId, legacyDocId],
      );
      const revokedConsentId = revokedConsentRes.rows[0]?.id;
      const priorRevokedAt = revokedConsentRes.rows[0]?.revokedAt;
      if (revokedConsentId === undefined || priorRevokedAt === undefined) {
        throw new Error("No se insertó la aceptación revocada previa");
      }

      // 3) Aplicar la migración D19 parte 2 encima de la BD con datos existentes
      await pool.query(upSql);
      reapplied = true;

      // 4) Las filas previas se conservan intactas (content = NULL para fila vieja)
      const docAfter = await pool.query<{
        id: string;
        version: string;
        contentHash: string;
        content: string | null;
      }>(`SELECT id, version, "contentHash", content FROM legal_documents WHERE id = $1`, [
        legacyDocId,
      ]);
      expect(docAfter.rows[0]).toEqual({
        id: legacyDocId,
        version: "2026-legacy",
        contentHash: "a".repeat(64),
        content: null,
      });

      const activeAfter = await pool.query<{
        id: string;
        legalDocumentId: string;
        grantedAt: string;
        revokedAt: string | null;
      }>(
        `SELECT id, "legalDocumentId", "grantedAt"::text AS "grantedAt", "revokedAt"::text AS "revokedAt"
         FROM consent_records WHERE id = $1`,
        [activeConsentId],
      );
      expect(activeAfter.rows[0]).toEqual({
        id: activeConsentId,
        legalDocumentId: legacyDocId,
        grantedAt: activeGrantedAt,
        revokedAt: null,
      });

      // 5) La inmutabilidad protege inmediatamente las filas previas
      await expectSqlReject(
        pool,
        `UPDATE legal_documents SET content = 'relleno ilegal' WHERE id = $1`,
        [legacyDocId],
        "legal_documents es inmutable",
      );
      await expectSqlReject(
        pool,
        `DELETE FROM legal_documents WHERE id = $1`,
        [legacyDocId],
        "legal_documents es inmutable",
      );
      await expectSqlReject(
        pool,
        `DELETE FROM consent_records WHERE id = $1`,
        [activeConsentId],
        "consent_records es inmutable",
      );
      await expectSqlReject(
        pool,
        `UPDATE consent_records SET purpose = 'ACCOUNT'::"ConsentPurpose" WHERE id = $1`,
        [activeConsentId],
        "consent_records es inmutable",
      );
      await expectSqlReject(
        pool,
        `UPDATE consent_records SET "revokedAt" = now() WHERE id = $1`,
        [revokedConsentId],
        "consent_records es inmutable",
      );

      // Primera revocación de la fila previa activa sigue permitida
      await pool.query(`UPDATE consent_records SET "revokedAt" = now() WHERE id = $1`, [
        activeConsentId,
      ]);
      const revokedNow = await pool.query<{ revokedAt: string | null }>(
        `SELECT "revokedAt"::text AS "revokedAt" FROM consent_records WHERE id = $1`,
        [activeConsentId],
      );
      expect(revokedNow.rows[0]?.revokedAt).not.toBeNull();

      // 6) m45 down.sql funciona con el trigger activo y lo deja rehabilitado
      const draftDocRes = await pool.query<{ id: string }>(
        `INSERT INTO legal_documents (id, kind, version, "contentHash", "publishedAt")
         VALUES (gen_random_uuid(), 'GEOLOCATION_CONSENT'::"LegalDocumentKind", '0.1-borrador', $1, now())
         RETURNING id`,
        ["b".repeat(64)],
      );
      const draftDocId = draftDocRes.rows[0]?.id;
      expect(draftDocId).toBeDefined();

      await pool.query(m45DownSql);

      const draftLeft = await pool.query<{ id: string }>(
        `SELECT id FROM legal_documents WHERE version = '0.1-borrador'`,
      );
      expect(draftLeft.rows).toHaveLength(0);

      // El trigger quedó rehabilitado sobre las filas restantes
      await expectSqlReject(
        pool,
        `DELETE FROM legal_documents WHERE id = $1`,
        [legacyDocId],
        "legal_documents es inmutable",
      );
    } finally {
      if (!reapplied) {
        await pool.query(upSql);
      }
      await pool.end();
    }
  });
});
