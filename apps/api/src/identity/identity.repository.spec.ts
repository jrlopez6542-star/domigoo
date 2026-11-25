import type { AuditRecorder } from "../audit/audit.service.js";
import type { Database } from "../database.js";
import { IdentityRepository, MissingLegalVersionError } from "./identity.repository.js";
import {
  AuthError,
  CURRENT_LEGAL_VERSION,
  IdentityService,
  parseRegistrationInput,
} from "./identity.service.js";

type DocRow = { id: string; kind: string; version: string; publishedAt: number };

function createFakeDb(initialDocs: DocRow[] = []) {
  const docs: DocRow[] = [...initialDocs];
  const users: Array<{ id: string; email: string | null }> = [];
  const consents: Array<{ userId: string; legalDocumentId: string; purpose: string }> = [];
  const sqlLog: string[] = [];
  let txDocsSnapshot: DocRow[] = [];
  let seq = 0;

  const client = {
    query: (sql: string, params?: unknown[]) => {
      sqlLog.push(sql.trim());
      if (sql === "BEGIN") {
        txDocsSnapshot = [...docs];
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql === "COMMIT") {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql === "ROLLBACK") {
        docs.length = 0;
        docs.push(...txDocsSnapshot);
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql.includes("FROM legal_documents") && sql.includes("AND version = $2")) {
        const kind = String(params?.[0]);
        const version = String(params?.[1]);
        const found = docs.find((d) => d.kind === kind && d.version === version);
        return Promise.resolve({ rows: found ? [found] : [], rowCount: found ? 1 : 0 });
      }
      if (sql.includes("FROM legal_documents") && sql.includes('ORDER BY "publishedAt" DESC')) {
        const kind = String(params?.[0]);
        const sorted = docs
          .filter((d) => d.kind === kind)
          .sort((a, b) => b.publishedAt - a.publishedAt);
        const top = sorted[0];
        return Promise.resolve({ rows: top ? [top] : [], rowCount: top ? 1 : 0 });
      }
      if (sql.includes("INSERT INTO legal_documents")) {
        const kind = String(params?.[0]);
        const version = String(params?.[1]);
        const hasAnyForKind = docs.some((d) => d.kind === kind);
        if (!hasAnyForKind) {
          seq += 1;
          docs.push({ id: `doc-${String(seq)}`, kind, version, publishedAt: 1000 + seq });
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql.includes("INSERT INTO users")) {
        seq += 1;
        const user = {
          id: `user-${String(seq)}`,
          email: (params?.[0] as string | null) ?? null,
          phoneE164: (params?.[1] as string | null) ?? null,
          status: "ACTIVE",
        };
        users.push({ id: user.id, email: user.email });
        return Promise.resolve({ rows: [user], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO consent_records")) {
        consents.push({
          userId: String(params?.[0]),
          legalDocumentId: String(params?.[1]),
          purpose: String(params?.[2]),
        });
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      throw new Error(`SQL no esperado en mock: ${sql}`);
    },
    release: () => {},
  };

  const database = {
    pool: {
      connect: () => Promise.resolve(client),
    },
  } as unknown as Database;

  return { database, docs, users, consents, sqlLog };
}

describe("integridad de documentos legales en registro (ORDEN 020)", () => {
  it("parseRegistrationInput distingue versión omitida (requestedVersion undefined) de versión explícita", () => {
    const omitted = parseRegistrationInput({
      email: "sin-version@example.invalid",
      password: "clave-de-prueba-12",
      client: "WEB",
      consents: { termsAccepted: true, privacyAccepted: true },
    });
    expect(omitted.consents.version).toBe(CURRENT_LEGAL_VERSION);
    expect(omitted.consents.requestedVersion).toBeUndefined();

    const explicit = parseRegistrationInput({
      email: "con-version@example.invalid",
      password: "clave-de-prueba-12",
      client: "WEB",
      consents: { termsAccepted: true, privacyAccepted: true, version: "2026-02" },
    });
    expect(explicit.consents.version).toBe("2026-02");
    expect(explicit.consents.requestedVersion).toBe("2026-02");
  });

  it("en BD limpia sin consents.version inserta solo 0.1-borrador y devuelve legalVersion 0.1-borrador", async () => {
    const fake = createFakeDb([]);
    const repo = new IdentityRepository(fake.database);
    const res = await repo.insertUserWithConsents({
      email: "nuevo@example.invalid",
      phoneE164: null,
      passwordHash: "hash",
      consents: {
        version: CURRENT_LEGAL_VERSION,
        termsAccepted: true,
        privacyAccepted: true,
        sensitiveDataAccepted: false,
        marketingAccepted: false,
        channel: "WEB",
      },
    });
    expect(res.legalVersion).toBe("0.1-borrador");
    expect(fake.docs.map((d) => `${d.kind}:${d.version}`)).toEqual([
      "TERMS:0.1-borrador",
      "PRIVACY_NOTICE:0.1-borrador",
    ]);
    expect(fake.consents).toHaveLength(2);
  });

  it("sin consents.version usa el documento vigente de cada kind sin insertar filas nuevas y legalVersion es la de TERMS", async () => {
    const fake = createFakeDb([
      { id: "doc-terms-1", kind: "TERMS", version: "2026-01", publishedAt: 10 },
      { id: "doc-priv-1", kind: "PRIVACY_NOTICE", version: "2026-01", publishedAt: 10 },
      { id: "doc-priv-2", kind: "PRIVACY_NOTICE", version: "2026-02", publishedAt: 20 },
    ]);
    const repo = new IdentityRepository(fake.database);
    const res = await repo.insertUserWithConsents({
      email: "vigente@example.invalid",
      phoneE164: null,
      passwordHash: "hash",
      consents: {
        version: CURRENT_LEGAL_VERSION,
        termsAccepted: true,
        privacyAccepted: true,
        sensitiveDataAccepted: false,
        marketingAccepted: false,
        channel: "WEB",
      },
    });
    expect(res.legalVersion).toBe("2026-01");
    expect(fake.docs).toHaveLength(3);
    expect(fake.sqlLog.some((q) => q.includes("INSERT INTO legal_documents"))).toBe(false);
    expect(fake.consents).toEqual([
      { userId: res.user.id, legalDocumentId: "doc-terms-1", purpose: "TERMS_ACCEPTANCE" },
      { userId: res.user.id, legalDocumentId: "doc-priv-2", purpose: "ACCOUNT" },
    ]);
  });

  it("con consents.version inexistente hace ROLLBACK, lanza MissingLegalVersionError y no inserta usuarios ni documentos", async () => {
    const fake = createFakeDb([
      { id: "doc-terms-1", kind: "TERMS", version: "2026-02", publishedAt: 20 },
      { id: "doc-priv-1", kind: "PRIVACY_NOTICE", version: "2026-02", publishedAt: 20 },
    ]);
    const repo = new IdentityRepository(fake.database);
    await expect(
      repo.insertUserWithConsents({
        email: "atacante@example.invalid",
        phoneE164: null,
        passwordHash: "hash",
        consents: {
          version: "x-123",
          requestedVersion: "x-123",
          termsAccepted: true,
          privacyAccepted: true,
          sensitiveDataAccepted: false,
          marketingAccepted: false,
          channel: "WEB",
        },
      }),
    ).rejects.toThrow(MissingLegalVersionError);
    expect(fake.docs).toHaveLength(2);
    expect(fake.users).toHaveLength(0);
    expect(fake.consents).toHaveLength(0);
    expect(fake.sqlLog).toContain("ROLLBACK");
  });

  it("con consents.version existente pero no vigente la acepta sin crear filas nuevas", async () => {
    const fake = createFakeDb([
      { id: "doc-terms-1", kind: "TERMS", version: "2026-01", publishedAt: 10 },
      { id: "doc-terms-2", kind: "TERMS", version: "2026-02", publishedAt: 20 },
      { id: "doc-priv-1", kind: "PRIVACY_NOTICE", version: "2026-01", publishedAt: 10 },
      { id: "doc-priv-2", kind: "PRIVACY_NOTICE", version: "2026-02", publishedAt: 20 },
    ]);
    const repo = new IdentityRepository(fake.database);
    const res = await repo.insertUserWithConsents({
      email: "previa@example.invalid",
      phoneE164: null,
      passwordHash: "hash",
      consents: {
        version: "2026-01",
        requestedVersion: "2026-01",
        termsAccepted: true,
        privacyAccepted: true,
        sensitiveDataAccepted: false,
        marketingAccepted: false,
        channel: "WEB",
      },
    });
    expect(res.legalVersion).toBe("2026-01");
    expect(fake.docs).toHaveLength(4);
    expect(fake.consents).toEqual([
      { userId: res.user.id, legalDocumentId: "doc-terms-1", purpose: "TERMS_ACCEPTANCE" },
      { userId: res.user.id, legalDocumentId: "doc-priv-1", purpose: "ACCOUNT" },
    ]);
  });

  it("IdentityService.register convierte MissingLegalVersionError en AuthError 422 con el mensaje exacto", async () => {
    const repo = {
      insertUserWithConsents: () => Promise.reject(new MissingLegalVersionError()),
    } as unknown as IdentityRepository;
    const service = new IdentityService(repo, {} as AuditRecorder);

    let caught: unknown = null;
    try {
      await service.register(
        parseRegistrationInput({
          email: "fail422@example.invalid",
          password: "clave-de-prueba-12",
          client: "WEB",
          consents: { termsAccepted: true, privacyAccepted: true, version: "x-123" },
        }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).status).toBe(422);
    expect((caught as AuthError).message).toBe("La versión de los documentos legales no existe");
  });
});
