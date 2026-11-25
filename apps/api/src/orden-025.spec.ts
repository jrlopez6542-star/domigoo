import type { AuditRecorder } from "./audit/audit.service.js";
import type { Database } from "./database.js";
import {
  IdentityRepository,
  InvalidLegalDocumentError,
  MissingLegalVersionError,
  OutdatedLegalVersionError,
} from "./identity/identity.repository.js";
import { AuthError, IdentityService, parseRegistrationInput } from "./identity/identity.service.js";

type DocRow = { id: string; kind: string; version: string; publishedAt: number };

const TERMS_V1 = "11111111-1111-4111-8111-111111111111";
const TERMS_V2 = "22222222-2222-4222-8222-222222222222";
const PRIV_V1 = "33333333-3333-4333-8333-333333333333";
const PRIV_V2 = "44444444-4444-4444-8444-444444444444";
const DOC_PROC_V1 = "55555555-5555-4555-8555-555555555555";
const MISSING_UUID = "99999999-9999-4999-8999-999999999999";

function createFakeDb(initialDocs: DocRow[]) {
  const docs: DocRow[] = [...initialDocs];
  const users: Array<{ id: string; email: string | null }> = [];
  const consents: Array<{ userId: string; legalDocumentId: string; purpose: string }> = [];
  const sqlLog: string[] = [];
  let seq = 0;

  const client = {
    query: (sql: string, params?: unknown[]) => {
      sqlLog.push(sql.trim());
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql.includes("FROM legal_documents") && sql.includes("WHERE id = $1")) {
        const id = String(params?.[0]);
        const found = docs.find((d) => d.id === id);
        return Promise.resolve({ rows: found ? [found] : [], rowCount: found ? 1 : 0 });
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
          .sort((a, b) => b.publishedAt - a.publishedAt || b.id.localeCompare(a.id));
        const top = sorted[0];
        return Promise.resolve({ rows: top ? [top] : [], rowCount: top ? 1 : 0 });
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

  return {
    database: { pool: { connect: () => Promise.resolve(client) } } as unknown as Database,
    users,
    consents,
    sqlLog,
  };
}

function catchAuthError(fn: () => unknown): AuthError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AuthError);
    return err as AuthError;
  }
  throw new Error("Se esperaba AuthError");
}

describe("ORDEN 025 - D19 parte 3: consents.documents en POST /v1/auth/register", () => {
  const basePayload = {
    email: "registro-025@example.invalid",
    password: "clave-segura-025",
    client: "WEB",
  };

  it("1) parseRegistrationInput valida consents.documents opcional (claves permitidas, UUIDs y tipos requeridos) con 422 en español sin IDs ni enums", () => {
    const withoutDocs = parseRegistrationInput({
      ...basePayload,
      consents: { termsAccepted: true, privacyAccepted: true },
    });
    expect(withoutDocs.consents.requestedDocuments).toBeUndefined();

    const customerWithDocs = parseRegistrationInput({
      ...basePayload,
      role: "CUSTOMER",
      consents: {
        termsAccepted: true,
        privacyAccepted: true,
        documents: { TERMS: TERMS_V2, PRIVACY_NOTICE: PRIV_V2 },
      },
    });
    expect(customerWithDocs.consents.requestedDocuments).toEqual({
      TERMS: TERMS_V2,
      PRIVACY_NOTICE: PRIV_V2,
    });

    const courierWithDocs = parseRegistrationInput({
      ...basePayload,
      client: "MOBILE",
      role: "COURIER",
      consents: {
        termsAccepted: true,
        privacyAccepted: true,
        sensitiveDataAccepted: true,
        documents: {
          TERMS: TERMS_V2,
          PRIVACY_NOTICE: PRIV_V2,
          DOCUMENT_PROCESSING: DOC_PROC_V1,
        },
      },
    });
    expect(courierWithDocs.consents.requestedDocuments).toEqual({
      TERMS: TERMS_V2,
      PRIVACY_NOTICE: PRIV_V2,
      DOCUMENT_PROCESSING: DOC_PROC_V1,
    });

    const invalidCases: Array<{ name: string; body: unknown }> = [
      {
        name: "documents no es objeto",
        body: {
          ...basePayload,
          consents: { termsAccepted: true, privacyAccepted: true, documents: "invalido" },
        },
      },
      {
        name: "UUID mal formado",
        body: {
          ...basePayload,
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            documents: { TERMS: "no-es-uuid", PRIVACY_NOTICE: PRIV_V2 },
          },
        },
      },
      {
        name: "falta PRIVACY_NOTICE requerido",
        body: {
          ...basePayload,
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            documents: { TERMS: TERMS_V2 },
          },
        },
      },
      {
        name: "COURIER sin DOCUMENT_PROCESSING requerido",
        body: {
          ...basePayload,
          role: "COURIER",
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            sensitiveDataAccepted: true,
            documents: { TERMS: TERMS_V2, PRIVACY_NOTICE: PRIV_V2 },
          },
        },
      },
      {
        name: "clave no permitida",
        body: {
          ...basePayload,
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            documents: {
              TERMS: TERMS_V2,
              PRIVACY_NOTICE: PRIV_V2,
              GEOLOCATION_CONSENT: DOC_PROC_V1,
            },
          },
        },
      },
    ];

    for (const tc of invalidCases) {
      const err = catchAuthError(() => parseRegistrationInput(tc.body));
      expect(err.status).toBe(422);
      expect(err.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
      expect(err.message).not.toMatch(
        /TERMS|PRIVACY_NOTICE|DOCUMENT_PROCESSING|GEOLOCATION_CONSENT/,
      );
    }
  });

  it("2) COURIER con versiones vigentes distintas por tipo (v2 + 0.1-borrador) registra OK con consents.documents", async () => {
    const fake = createFakeDb([
      { id: TERMS_V1, kind: "TERMS", version: "0.1-borrador", publishedAt: 10 },
      { id: TERMS_V2, kind: "TERMS", version: "2026-02", publishedAt: 20 },
      { id: PRIV_V1, kind: "PRIVACY_NOTICE", version: "0.1-borrador", publishedAt: 10 },
      { id: PRIV_V2, kind: "PRIVACY_NOTICE", version: "2026-02", publishedAt: 20 },
      { id: DOC_PROC_V1, kind: "DOCUMENT_PROCESSING", version: "0.1-borrador", publishedAt: 10 },
    ]);
    const repo = new IdentityRepository(fake.database);

    const res = await repo.insertUserWithConsents({
      email: "domi-mixto@example.invalid",
      phoneE164: null,
      passwordHash: "hash",
      consents: {
        version: "0.1-borrador",
        requestedDocuments: {
          TERMS: TERMS_V2,
          PRIVACY_NOTICE: PRIV_V2,
          DOCUMENT_PROCESSING: DOC_PROC_V1,
        },
        termsAccepted: true,
        privacyAccepted: true,
        sensitiveDataAccepted: true,
        marketingAccepted: true,
        channel: "MOBILE",
      },
    });

    expect(res.legalVersion).toBe("2026-02");
    expect(res.consents).toEqual([
      { purpose: "TERMS_ACCEPTANCE", legalDocumentId: TERMS_V2, version: "2026-02" },
      { purpose: "ACCOUNT", legalDocumentId: PRIV_V2, version: "2026-02" },
      { purpose: "DOCUMENT_STORAGE", legalDocumentId: DOC_PROC_V1, version: "0.1-borrador" },
      { purpose: "MARKETING", legalDocumentId: PRIV_V2, version: "2026-02" },
    ]);
    expect(fake.consents).toEqual([
      { userId: res.user.id, legalDocumentId: TERMS_V2, purpose: "TERMS_ACCEPTANCE" },
      { userId: res.user.id, legalDocumentId: PRIV_V2, purpose: "ACCOUNT" },
      { userId: res.user.id, legalDocumentId: DOC_PROC_V1, purpose: "DOCUMENT_STORAGE" },
      { userId: res.user.id, legalDocumentId: PRIV_V2, purpose: "MARKETING" },
    ]);
  });

  it("3) ID no vigente rechaza con OutdatedLegalVersionError + currentDocuments y ROLLBACK (+0 escrituras)", async () => {
    const fake = createFakeDb([
      { id: TERMS_V1, kind: "TERMS", version: "2026-01", publishedAt: 10 },
      { id: TERMS_V2, kind: "TERMS", version: "2026-02", publishedAt: 20 },
      { id: PRIV_V2, kind: "PRIVACY_NOTICE", version: "2026-02", publishedAt: 20 },
    ]);
    const repo = new IdentityRepository(fake.database);

    let caught: unknown = null;
    try {
      await repo.insertUserWithConsents({
        email: "viejo@example.invalid",
        phoneE164: null,
        passwordHash: "hash",
        consents: {
          version: "0.1-borrador",
          requestedDocuments: { TERMS: TERMS_V1, PRIVACY_NOTICE: PRIV_V2 },
          termsAccepted: true,
          privacyAccepted: true,
          sensitiveDataAccepted: false,
          marketingAccepted: false,
          channel: "WEB",
        },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(OutdatedLegalVersionError);
    expect((caught as OutdatedLegalVersionError).message).toBe(
      "La versión de los documentos legales está desactualizada",
    );
    expect((caught as OutdatedLegalVersionError).currentDocuments).toEqual([
      { kind: "TERMS", id: TERMS_V2, version: "2026-02" },
      { kind: "PRIVACY_NOTICE", id: PRIV_V2, version: "2026-02" },
    ]);
    expect(fake.users).toHaveLength(0);
    expect(fake.consents).toHaveLength(0);
    expect(fake.sqlLog).toContain("ROLLBACK");
  });

  it("4) ID de otro tipo, inexistente o version+documents incoherentes rechazan con ROLLBACK y +0 escrituras", async () => {
    const fake = createFakeDb([
      { id: TERMS_V1, kind: "TERMS", version: "2026-01", publishedAt: 10 },
      { id: TERMS_V2, kind: "TERMS", version: "2026-02", publishedAt: 20 },
      { id: PRIV_V2, kind: "PRIVACY_NOTICE", version: "2026-02", publishedAt: 20 },
    ]);
    const repo = new IdentityRepository(fake.database);

    // ID de otro tipo (PRIV_V2 enviado en TERMS)
    await expect(
      repo.insertUserWithConsents({
        email: "otro-tipo@example.invalid",
        phoneE164: null,
        passwordHash: "hash",
        consents: {
          version: "0.1-borrador",
          requestedDocuments: { TERMS: PRIV_V2, PRIVACY_NOTICE: PRIV_V2 },
          termsAccepted: true,
          privacyAccepted: true,
          sensitiveDataAccepted: false,
          marketingAccepted: false,
          channel: "WEB",
        },
      }),
    ).rejects.toThrow(InvalidLegalDocumentError);

    // ID inexistente
    await expect(
      repo.insertUserWithConsents({
        email: "inexistente@example.invalid",
        phoneE164: null,
        passwordHash: "hash",
        consents: {
          version: "0.1-borrador",
          requestedDocuments: { TERMS: MISSING_UUID, PRIVACY_NOTICE: PRIV_V2 },
          termsAccepted: true,
          privacyAccepted: true,
          sensitiveDataAccepted: false,
          marketingAccepted: false,
          channel: "WEB",
        },
      }),
    ).rejects.toThrow(InvalidLegalDocumentError);

    // version existente pero incoherente con documents vigentes
    await expect(
      repo.insertUserWithConsents({
        email: "incoherente-1@example.invalid",
        phoneE164: null,
        passwordHash: "hash",
        consents: {
          version: "2026-01",
          requestedVersion: "2026-01",
          requestedDocuments: { TERMS: TERMS_V2, PRIVACY_NOTICE: PRIV_V2 },
          termsAccepted: true,
          privacyAccepted: true,
          sensitiveDataAccepted: false,
          marketingAccepted: false,
          channel: "WEB",
        },
      }),
    ).rejects.toThrow(OutdatedLegalVersionError);

    // version inexistente + documents vigentes
    await expect(
      repo.insertUserWithConsents({
        email: "incoherente-2@example.invalid",
        phoneE164: null,
        passwordHash: "hash",
        consents: {
          version: "2099-99",
          requestedVersion: "2099-99",
          requestedDocuments: { TERMS: TERMS_V2, PRIVACY_NOTICE: PRIV_V2 },
          termsAccepted: true,
          privacyAccepted: true,
          sensitiveDataAccepted: false,
          marketingAccepted: false,
          channel: "WEB",
        },
      }),
    ).rejects.toThrow(MissingLegalVersionError);

    expect(fake.users).toHaveLength(0);
    expect(fake.consents).toHaveLength(0);
  });

  it("5) IdentityService.register adjunta currentDocuments en AuthError 422 solo cuando OutdatedLegalVersionError lo incluye", async () => {
    const currentDocuments = [
      { kind: "TERMS" as const, id: TERMS_V2, version: "2026-02" },
      { kind: "PRIVACY_NOTICE" as const, id: PRIV_V2, version: "2026-02" },
    ];
    const svc = new IdentityService(
      {
        insertUserWithConsents: () =>
          Promise.reject(new OutdatedLegalVersionError(currentDocuments)),
      } as unknown as IdentityRepository,
      {} as AuditRecorder,
    );

    let caught: unknown = null;
    try {
      await svc.register(
        parseRegistrationInput({
          ...basePayload,
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            documents: { TERMS: TERMS_V1, PRIVACY_NOTICE: PRIV_V2 },
          },
        }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).status).toBe(422);
    expect((caught as AuthError).details).toEqual({ currentDocuments });
  });
});
