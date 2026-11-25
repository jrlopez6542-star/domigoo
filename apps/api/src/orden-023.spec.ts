import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpException, NotFoundException } from "@nestjs/common";
import type { Database } from "./database.js";
import {
  DEFAULT_DOCUMENT_HASHES,
  IdentityRepository,
  OutdatedLegalVersionError,
} from "./identity/identity.repository.js";
import type { AuthenticatedRequest } from "./identity/session.guard.js";
import {
  CURRENT_LEGAL_DOCUMENT_ORDER_BY,
  PURPOSE_TO_LEGAL_DOCUMENT_KIND,
  SELECT_ALL_CURRENT_LEGAL_DOCUMENTS_SQL,
  SELECT_CURRENT_LEGAL_DOCUMENT_BY_KIND_SQL,
  expectedLegalDocumentKindForPurpose,
} from "./privacy/legal-documents.js";
import { PrivacyController } from "./privacy/privacy.controller.js";
import { PrivacyRepository } from "./privacy/privacy.repository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

async function catchHttp(fn: () => Promise<unknown>): Promise<HttpException> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    return err as HttpException;
  }
  throw new Error("Se esperaba HttpException");
}

describe("ORDEN 023 - D19 parte 1: vigencia única, mapa propósito->tipo, consents, registro y hashes legales", () => {
  const validUuid = "11111111-1111-4111-8111-111111111111";
  const currentUuid = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const olderUuid = "00000000-0000-4000-8000-000000000001";

  it("1) Regla única de vigencia en SQL usa publishedAt DESC, id DESC en current, registro y consents", async () => {
    expect(CURRENT_LEGAL_DOCUMENT_ORDER_BY).toBe('"publishedAt" DESC, id DESC');
    expect(SELECT_ALL_CURRENT_LEGAL_DOCUMENTS_SQL).toContain(
      'ORDER BY kind, "publishedAt" DESC, id DESC',
    );
    expect(SELECT_CURRENT_LEGAL_DOCUMENT_BY_KIND_SQL).toContain(
      'ORDER BY "publishedAt" DESC, id DESC',
    );

    const executedSql: string[] = [];
    const privacyRepo = new PrivacyRepository({
      pool: {
        query: (sql: string) => {
          executedSql.push(sql);
          if (sql.includes("WITH target AS")) {
            return Promise.resolve({
              rows: [
                {
                  targetId: currentUuid,
                  targetKind: "GEOLOCATION_CONSENT",
                  currentId: currentUuid,
                  consentId: "c-1",
                  legalDocumentId: currentUuid,
                },
              ],
              rowCount: 1,
            });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        },
      },
    } as unknown as Database);

    await privacyRepo.listCurrentDocuments();
    expect(executedSql[0]).toContain('ORDER BY kind, "publishedAt" DESC, id DESC');

    await privacyRepo.insertConsent({
      userId: "user-1",
      legalDocumentId: currentUuid,
      purpose: "GEOLOCATION",
      channel: "WEB",
    });
    expect(executedSql[1]).toContain('ORDER BY "publishedAt" DESC, id DESC');
  });

  it("1b) Empate de publishedAt se resuelve por id DESC en registro", async () => {
    const tiedDocs = [
      { id: olderUuid, kind: "TERMS", version: "2026-tie-a", publishedAt: 5000 },
      { id: currentUuid, kind: "TERMS", version: "2026-tie-b", publishedAt: 5000 },
      { id: olderUuid, kind: "PRIVACY_NOTICE", version: "2026-tie-a", publishedAt: 5000 },
      { id: currentUuid, kind: "PRIVACY_NOTICE", version: "2026-tie-b", publishedAt: 5000 },
    ];
    const queries: string[] = [];
    const client = {
      query: (sql: string, params?: unknown[]) => {
        queries.push(sql);
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (sql.includes('ORDER BY "publishedAt" DESC, id DESC')) {
          const kind = String(params?.[0]);
          const top = tiedDocs
            .filter((d) => d.kind === kind)
            .sort((a, b) => b.publishedAt - a.publishedAt || b.id.localeCompare(a.id))[0];
          return Promise.resolve({ rows: top ? [top] : [], rowCount: top ? 1 : 0 });
        }
        if (sql.includes("INSERT INTO users")) {
          return Promise.resolve({
            rows: [
              { id: "u-tie", email: "tie@example.invalid", phoneE164: null, status: "ACTIVE" },
            ],
            rowCount: 1,
          });
        }
        if (sql.includes("INSERT INTO consent_records")) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        throw new Error(`SQL inesperado: ${sql}`);
      },
      release: () => {},
    };
    const repo = new IdentityRepository({
      pool: { connect: () => Promise.resolve(client) },
    } as unknown as Database);

    const result = await repo.insertUserWithConsents({
      email: "tie@example.invalid",
      phoneE164: null,
      passwordHash: "hash",
      consents: {
        version: "0.1-borrador",
        termsAccepted: true,
        privacyAccepted: true,
        sensitiveDataAccepted: false,
        marketingAccepted: false,
        channel: "WEB",
      },
    });
    expect(result.legalVersion).toBe("2026-tie-b");
    expect(result.consents).toEqual([
      { purpose: "TERMS_ACCEPTANCE", legalDocumentId: currentUuid, version: "2026-tie-b" },
      { purpose: "ACCOUNT", legalDocumentId: currentUuid, version: "2026-tie-b" },
    ]);
    expect(queries.some((q) => q.includes('ORDER BY "publishedAt" DESC, id DESC'))).toBe(true);
  });

  it("2) Mapa propósito -> tipo cubre exactamente los 5 propósitos actuales y excluye ORDER_CONTACT", () => {
    expect(PURPOSE_TO_LEGAL_DOCUMENT_KIND).toEqual({
      TERMS_ACCEPTANCE: "TERMS",
      ACCOUNT: "PRIVACY_NOTICE",
      MARKETING: "PRIVACY_NOTICE",
      DOCUMENT_STORAGE: "DOCUMENT_PROCESSING",
      GEOLOCATION: "GEOLOCATION_CONSENT",
    });
    expect(expectedLegalDocumentKindForPurpose("TERMS_ACCEPTANCE")).toBe("TERMS");
    expect(expectedLegalDocumentKindForPurpose("ACCOUNT")).toBe("PRIVACY_NOTICE");
    expect(expectedLegalDocumentKindForPurpose("MARKETING")).toBe("PRIVACY_NOTICE");
    expect(expectedLegalDocumentKindForPurpose("DOCUMENT_STORAGE")).toBe("DOCUMENT_PROCESSING");
    expect(expectedLegalDocumentKindForPurpose("GEOLOCATION")).toBe("GEOLOCATION_CONSENT");
    expect(expectedLegalDocumentKindForPurpose("ORDER_CONTACT")).toBeNull();
  });

  it("3) PrivacyRepository.insertConsent y PrivacyController.grant distinguen inexistente (404), tipo incorrecto (422), desactualizado (422 + currentLegalDocumentId) y ORDER_CONTACT sin restricción de tipo", async () => {
    let executedOrderContactSql = "";
    const repoOrderContact = new PrivacyRepository({
      pool: {
        query: (sql: string) => {
          executedOrderContactSql = sql;
          return Promise.resolve({
            rows: [{ id: "c-oc", legalDocumentId: validUuid }],
            rowCount: 1,
          });
        },
      },
    } as unknown as Database);
    await expect(
      repoOrderContact.insertConsent({
        userId: "u-1",
        legalDocumentId: validUuid,
        purpose: "ORDER_CONTACT",
        channel: "WEB",
      }),
    ).resolves.toEqual({ id: "c-oc", legalDocumentId: validUuid });
    expect(executedOrderContactSql).not.toContain("WITH target AS");

    const repoWrongKind = new PrivacyRepository({
      pool: {
        query: () =>
          Promise.resolve({
            rows: [
              {
                targetId: validUuid,
                targetKind: "PRIVACY_NOTICE",
                currentId: currentUuid,
                consentId: null,
                legalDocumentId: null,
              },
            ],
            rowCount: 1,
          }),
      },
    } as unknown as Database);
    await expect(
      repoWrongKind.insertConsent({
        userId: "u-1",
        legalDocumentId: validUuid,
        purpose: "GEOLOCATION",
        channel: "WEB",
      }),
    ).resolves.toBe("wrong_kind");

    const repoOutdated = new PrivacyRepository({
      pool: {
        query: () =>
          Promise.resolve({
            rows: [
              {
                targetId: olderUuid,
                targetKind: "GEOLOCATION_CONSENT",
                currentId: currentUuid,
                consentId: null,
                legalDocumentId: null,
              },
            ],
            rowCount: 1,
          }),
      },
    } as unknown as Database);
    await expect(
      repoOutdated.insertConsent({
        userId: "u-1",
        legalDocumentId: olderUuid,
        purpose: "GEOLOCATION",
        channel: "WEB",
      }),
    ).resolves.toEqual({ kind: "outdated", currentLegalDocumentId: currentUuid });

    const req = {
      auth: { userId: "u-1", sessionId: "s-1" },
      headers: {},
    } as unknown as AuthenticatedRequest;

    const wrongKindCtrl = new PrivacyController(repoWrongKind);
    const wrongEx = await catchHttp(() =>
      wrongKindCtrl.grant(
        { legalDocumentId: validUuid, purpose: "GEOLOCATION", channel: "WEB" },
        req,
      ),
    );
    expect(wrongEx.getStatus()).toBe(422);
    expect(wrongEx.getResponse()).toEqual({
      message: "El documento no corresponde al propósito del consentimiento",
    });

    const outdatedCtrl = new PrivacyController(repoOutdated);
    const outdatedEx = await catchHttp(() =>
      outdatedCtrl.grant(
        { legalDocumentId: olderUuid, purpose: "GEOLOCATION", channel: "WEB" },
        req,
      ),
    );
    expect(outdatedEx.getStatus()).toBe(422);
    expect(outdatedEx.getResponse()).toEqual({
      message: "La versión del documento está desactualizada",
      currentLegalDocumentId: currentUuid,
    });

    const repoMissing = new PrivacyRepository({
      pool: {
        query: () =>
          Promise.resolve({
            rows: [
              {
                targetId: null,
                targetKind: null,
                currentId: currentUuid,
                consentId: null,
                legalDocumentId: null,
              },
            ],
            rowCount: 1,
          }),
      },
    } as unknown as Database);
    const missingCtrl = new PrivacyController(repoMissing);
    await expect(
      missingCtrl.grant(
        { legalDocumentId: validUuid, purpose: "GEOLOCATION", channel: "WEB" },
        req,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it("4) OutdatedLegalVersionError mantiene el mensaje exacto requerido por D19", () => {
    const err = new OutdatedLegalVersionError();
    expect(err.message).toBe("La versión de los documentos legales está desactualizada");
  });

  it("5) DEFAULT_DOCUMENT_HASHES coincide exactamente con el sha256 de los archivos en docs/legal/*.md", () => {
    const expectedFiles: Array<{ kind: string; relativePath: string }> = [
      { kind: "TERMS", relativePath: "docs/legal/terminos-y-condiciones.md" },
      { kind: "PRIVACY_NOTICE", relativePath: "docs/legal/politica-tratamiento-datos.md" },
      { kind: "DOCUMENT_PROCESSING", relativePath: "docs/legal/autorizacion-tratamiento-datos.md" },
    ];

    for (const item of expectedFiles) {
      const content = fs.readFileSync(path.join(repoRoot, item.relativePath));
      const sha256 = createHash("sha256").update(content).digest("hex");
      expect(DEFAULT_DOCUMENT_HASHES[item.kind]).toBe(sha256);
    }
  });
});
