import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./database.js";
import { PrivacyRepository } from "./privacy/privacy.repository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const migrationsDir = path.join(apiRoot, "prisma", "migrations");
const migrationName = "20261125120000_d19_legal_consents_immutability";
const migrationDir = path.join(migrationsDir, migrationName);

describe("ORDEN 024 - D19 parte 2: inmutabilidad en BD de legal_documents y consent_records", () => {
  const migrationSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
  const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
  const m45DownSql = fs.readFileSync(
    path.join(migrationsDir, "20261117150000_m45_legal_registration_consents", "down.sql"),
    "utf8",
  );
  const schemaPrisma = fs.readFileSync(path.join(apiRoot, "prisma", "schema.prisma"), "utf8");
  const resetDbSource = fs.readFileSync(path.join(apiRoot, "test", "reset-db.ts"), "utf8");

  it("1) La migración nueva es aditiva, va después de m47 y trae down.sql", () => {
    const entries = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(entries).toContain(migrationName);
    expect(entries.indexOf(migrationName)).toBeGreaterThan(
      entries.indexOf("20261117170000_m47_hardening_storage_ratelimit"),
    );
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("2) migration.sql agrega columna nullable content en legal_documents y triggers de inmutabilidad", () => {
    // Columna de texto nullable para filas viejas (sin NOT NULL)
    expect(migrationSql).toMatch(
      /ALTER TABLE "legal_documents"\s+ADD COLUMN IF NOT EXISTS "content" TEXT;/,
    );
    expect(migrationSql).not.toMatch(/ADD COLUMN[^;]*"content"[^;]*NOT NULL/i);

    // Trigger legal_documents: BEFORE UPDATE OR DELETE -> excepción
    expect(migrationSql).toContain(
      "CREATE OR REPLACE FUNCTION legal_documents_immutable() RETURNS trigger",
    );
    expect(migrationSql).toContain("CREATE TRIGGER legal_documents_no_mutate");
    expect(migrationSql).toContain("BEFORE UPDATE OR DELETE ON legal_documents");
    expect(migrationSql).toContain("FOR EACH ROW EXECUTE FUNCTION legal_documents_immutable()");

    // Trigger consent_records: BEFORE UPDATE OR DELETE -> solo permite primera revocación con todas las demás columnas iguales
    expect(migrationSql).toContain(
      "CREATE OR REPLACE FUNCTION consent_records_immutable() RETURNS trigger",
    );
    expect(migrationSql).toContain("CREATE TRIGGER consent_records_no_mutate");
    expect(migrationSql).toContain("BEFORE UPDATE OR DELETE ON consent_records");
    expect(migrationSql).toContain("FOR EACH ROW EXECUTE FUNCTION consent_records_immutable()");
    expect(migrationSql).toContain("IF TG_OP = 'DELETE' THEN");
    expect(migrationSql).toContain('OLD."revokedAt" IS NULL');
    expect(migrationSql).toContain('NEW."revokedAt" IS NOT NULL');

    for (const col of [
      "id",
      "userId",
      "legalDocumentId",
      "purpose",
      "channel",
      "grantedAt",
      "ip",
      "userAgent",
    ]) {
      expect(migrationSql).toContain(`NEW."${col}" IS NOT DISTINCT FROM OLD."${col}"`);
    }
  });

  it("3) down.sql revierte triggers, funciones y columna content; schema.prisma declara content nullable", () => {
    expect(downSql).toContain(
      "DROP TRIGGER IF EXISTS consent_records_no_mutate ON consent_records;",
    );
    expect(downSql).toContain("DROP FUNCTION IF EXISTS consent_records_immutable();");
    expect(downSql).toContain(
      "DROP TRIGGER IF EXISTS legal_documents_no_mutate ON legal_documents;",
    );
    expect(downSql).toContain("DROP FUNCTION IF EXISTS legal_documents_immutable();");
    expect(downSql).toMatch(/ALTER TABLE "legal_documents"\s+DROP COLUMN IF EXISTS "content";/);

    const legalDocModelMatch = schemaPrisma.match(/model LegalDocument \{[\s\S]*?\n\}/);
    expect(legalDocModelMatch).not.toBeNull();
    expect(legalDocModelMatch?.[0]).toMatch(/content\s+String\?/);
  });

  it("4) m45 down.sql y test/reset-db.ts deshabilitan y rehabilitan los triggers nuevos alrededor de DELETE", () => {
    expect(m45DownSql).toContain("legal_documents_no_mutate");
    expect(m45DownSql).toContain(
      "ALTER TABLE legal_documents DISABLE TRIGGER legal_documents_no_mutate",
    );
    expect(m45DownSql).toContain("DELETE FROM legal_documents WHERE version = '0.1-borrador';");
    expect(m45DownSql).toContain(
      "ALTER TABLE legal_documents ENABLE TRIGGER legal_documents_no_mutate",
    );
    expect(m45DownSql).toContain("EXCEPTION WHEN OTHERS THEN");

    expect(resetDbSource).toContain(
      "ALTER TABLE consent_records DISABLE TRIGGER consent_records_no_mutate",
    );
    expect(resetDbSource).toContain(
      "ALTER TABLE consent_records ENABLE TRIGGER consent_records_no_mutate",
    );
    expect(resetDbSource).toContain(
      "ALTER TABLE legal_documents DISABLE TRIGGER legal_documents_no_mutate",
    );
    expect(resetDbSource).toContain(
      "ALTER TABLE legal_documents ENABLE TRIGGER legal_documents_no_mutate",
    );
  });

  it("5) PrivacyRepository.insertDocument persiste el texto exacto en content con sha256(content) = contentHash", async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const content =
      "Términos y condiciones DOMIGOO — versión 2026-024\nCláusula 1: sin cobros ni pasarela.";
    const expectedHash = createHash("sha256").update(content).digest("hex");

    const repo = new PrivacyRepository({
      pool: {
        query: (sql: string, params: unknown[] = []) => {
          captured.push({ sql, params });
          return Promise.resolve({
            rows: [
              {
                id: "doc-024",
                kind: "TERMS",
                version: "2026-024",
                contentHash: String(params[2]),
              },
            ],
            rowCount: 1,
          });
        },
      },
    } as unknown as Database);

    const inserted = await repo.insertDocument({
      kind: "TERMS",
      version: "2026-024",
      content,
    });

    expect(inserted).toEqual({
      id: "doc-024",
      kind: "TERMS",
      version: "2026-024",
      contentHash: expectedHash,
    });
    expect(captured).toHaveLength(1);
    const call = captured[0];
    expect(call?.sql).toContain(
      'INSERT INTO legal_documents (id, kind, version, "contentHash", content, "publishedAt")',
    );
    expect(call?.params).toEqual(["TERMS", "2026-024", expectedHash, content]);
    expect(createHash("sha256").update(String(call?.params[3])).digest("hex")).toBe(
      call?.params[2],
    );
  });

  it("6) PrivacyRepository.revoke solo actualiza revokedAt cuando revokedAt IS NULL", async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const repo = new PrivacyRepository({
      pool: {
        query: (sql: string, params: unknown[] = []) => {
          captured.push({ sql, params });
          return Promise.resolve({ rows: [], rowCount: 1 });
        },
      },
    } as unknown as Database);

    const revoked = await repo.revoke("consent-1", "user-1");
    expect(revoked).toBe(true);
    expect(captured[0]?.sql).toContain('UPDATE consent_records SET "revokedAt" = now()');
    expect(captured[0]?.sql).toContain('AND "revokedAt" IS NULL');
  });
});
