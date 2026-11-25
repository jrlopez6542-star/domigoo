import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { Database } from "../database.js";
import {
  PURPOSE_TO_LEGAL_DOCUMENT_KIND,
  SELECT_CURRENT_LEGAL_DOCUMENT_BY_KIND_SQL,
  type LegalDocumentKind,
  type MappedConsentPurpose,
} from "../privacy/legal-documents.js";

export type PublicUser = {
  id: string;
  email: string | null;
  phoneE164: string | null;
  status: string;
};

export type StoredUser = PublicUser & {
  passwordHash: string | null;
};

export type StoredSession = {
  id: string;
  userId: string;
  client: string;
  revokedAt: Date | null;
  expiresAt: Date;
  userStatus: string;
};

export type RegistrationDocumentKind = "TERMS" | "PRIVACY_NOTICE" | "DOCUMENT_PROCESSING";

export type RegistrationDocumentsMap = Partial<Record<RegistrationDocumentKind, string>>;

export type CurrentLegalDocumentSummary = {
  kind: RegistrationDocumentKind;
  id: string;
  version: string;
};

export type RegistrationConsentInput = {
  version: string;
  requestedVersion?: string;
  requestedDocuments?: RegistrationDocumentsMap;
  termsAccepted: boolean;
  privacyAccepted: boolean;
  sensitiveDataAccepted: boolean;
  marketingAccepted: boolean;
  channel: "WEB" | "MOBILE" | "ADMIN";
  ip?: string;
  userAgent?: string;
};

export type RecordedRegistrationConsent = {
  purpose: string;
  legalDocumentId: string;
  version: string;
};

export class MissingLegalVersionError extends Error {
  constructor() {
    super("La versión de los documentos legales no existe");
    this.name = "MissingLegalVersionError";
  }
}

export class OutdatedLegalVersionError extends Error {
  readonly currentDocuments?: CurrentLegalDocumentSummary[];

  constructor(currentDocuments?: CurrentLegalDocumentSummary[]) {
    super("La versión de los documentos legales está desactualizada");
    this.name = "OutdatedLegalVersionError";
    if (currentDocuments !== undefined) {
      this.currentDocuments = currentDocuments;
    }
  }
}

export class InvalidLegalDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLegalDocumentError";
  }
}

const DEFAULT_LEGAL_VERSION = "0.1-borrador";

export const DEFAULT_DOCUMENT_HASHES: Readonly<Record<string, string>> = {
  TERMS: "fdb4df73fe68e0fb046efb0780f820fc259736bfaa63eb8287139eba27db33ae",
  PRIVACY_NOTICE: "1fbf6783816887d20674fdd01fd70c70ce58bc4ee20d9e21a7b923e611bc6061",
  DOCUMENT_PROCESSING: "634f193272c15d53a869db7ee8c462da4b70f3f7fb43695f5355202f203f2892",
};

@Injectable()
export class IdentityRepository {
  constructor(private readonly database: Database) {}

  private get pool(): Pool {
    return this.database.pool;
  }

  async insertUser(input: {
    email: string | null;
    phoneE164: string | null;
    passwordHash: string;
  }): Promise<PublicUser> {
    const result = await this.pool.query<PublicUser>(
      `INSERT INTO users (id, email, "phoneE164", "passwordHash", status, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, 'ACTIVE', now(), now())
       RETURNING id, email, "phoneE164", status`,
      [input.email, input.phoneE164, input.passwordHash],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("No se pudo crear la cuenta");
    }
    return row;
  }

  async insertUserWithConsents(input: {
    email: string | null;
    phoneE164: string | null;
    passwordHash: string;
    consents: RegistrationConsentInput;
  }): Promise<{
    user: PublicUser;
    consentPurposes: string[];
    legalVersion: string;
    consents: RecordedRegistrationConsent[];
  }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const purposes: MappedConsentPurpose[] = ["TERMS_ACCEPTANCE", "ACCOUNT"];
      if (input.consents.sensitiveDataAccepted) {
        purposes.push("DOCUMENT_STORAGE");
      }
      if (input.consents.marketingAccepted) {
        purposes.push("MARKETING");
      }
      const entries: Array<{ kind: LegalDocumentKind; purpose: MappedConsentPurpose }> =
        purposes.map((purpose) => ({
          kind: PURPOSE_TO_LEGAL_DOCUMENT_KIND[purpose],
          purpose,
        }));

      const requestedVersion = input.consents.requestedVersion;
      const requestedDocuments = input.consents.requestedDocuments;
      const docsByKind = new Map<LegalDocumentKind, { id: string; version: string }>();

      if (requestedDocuments !== undefined) {
        const requiredKinds: RegistrationDocumentKind[] = [];
        for (const entry of entries) {
          const kind = entry.kind as RegistrationDocumentKind;
          if (!requiredKinds.includes(kind)) {
            requiredKinds.push(kind);
          }
        }

        const currentDocuments: CurrentLegalDocumentSummary[] = [];
        let hasOutdatedDocument = false;

        for (const kind of requiredKinds) {
          const docId = requestedDocuments[kind];
          if (docId === undefined) {
            throw new InvalidLegalDocumentError(
              "Faltan documentos legales requeridos para completar el registro",
            );
          }

          const latestRes = await client.query<{ id: string; version: string }>(
            SELECT_CURRENT_LEGAL_DOCUMENT_BY_KIND_SQL,
            [kind],
          );
          const latest = latestRes.rows[0];
          if (latest !== undefined) {
            currentDocuments.push({ kind, id: latest.id, version: latest.version });
          }

          if (latest !== undefined && docId === latest.id) {
            docsByKind.set(kind, latest);
            continue;
          }

          const targetRes = await client.query<{ id: string; kind: string; version: string }>(
            `SELECT id, kind::text AS kind, version
             FROM legal_documents
             WHERE id = $1
             LIMIT 1`,
            [docId],
          );
          const target = targetRes.rows[0];
          if (target === undefined) {
            throw new InvalidLegalDocumentError("Uno de los documentos legales enviados no existe");
          }
          if (target.kind !== kind) {
            throw new InvalidLegalDocumentError(
              "El documento legal enviado no corresponde al consentimiento requerido",
            );
          }
          hasOutdatedDocument = true;
        }

        if (hasOutdatedDocument) {
          throw new OutdatedLegalVersionError(currentDocuments);
        }

        if (requestedVersion !== undefined) {
          for (const kind of requiredKinds) {
            const latest = docsByKind.get(kind);
            if (latest === undefined || latest.version === requestedVersion) {
              continue;
            }
            const exactRes = await client.query<{ id: string; version: string }>(
              `SELECT id, version
               FROM legal_documents
               WHERE kind = $1::"LegalDocumentKind" AND version = $2
               LIMIT 1`,
              [kind, requestedVersion],
            );
            if (exactRes.rows[0] !== undefined) {
              throw new OutdatedLegalVersionError(currentDocuments);
            }
            throw new MissingLegalVersionError();
          }
        }
      } else {
        for (const entry of entries) {
          if (docsByKind.has(entry.kind)) {
            continue;
          }
          const latestRes = await client.query<{ id: string; version: string }>(
            SELECT_CURRENT_LEGAL_DOCUMENT_BY_KIND_SQL,
            [entry.kind],
          );
          let latest = latestRes.rows[0];

          let resolved: { id: string; version: string } | undefined;
          if (requestedVersion === undefined) {
            if (latest !== undefined) {
              resolved = latest;
            } else {
              const defaultHash = DEFAULT_DOCUMENT_HASHES[entry.kind] ?? "0".repeat(64);
              await client.query(
                `INSERT INTO legal_documents (id, kind, version, "contentHash", "publishedAt")
                 SELECT gen_random_uuid(), $1::"LegalDocumentKind", $2, $3, now()
                 WHERE NOT EXISTS (
                   SELECT 1 FROM legal_documents WHERE kind = $1::"LegalDocumentKind"
                 )
                 ON CONFLICT (kind, version) DO NOTHING`,
                [entry.kind, DEFAULT_LEGAL_VERSION, defaultHash],
              );
              const bootstrappedRes = await client.query<{ id: string; version: string }>(
                SELECT_CURRENT_LEGAL_DOCUMENT_BY_KIND_SQL,
                [entry.kind],
              );
              resolved = bootstrappedRes.rows[0];
            }
          } else {
            if (latest === undefined) {
              if (requestedVersion !== DEFAULT_LEGAL_VERSION) {
                throw new MissingLegalVersionError();
              }
              const defaultHash = DEFAULT_DOCUMENT_HASHES[entry.kind] ?? "0".repeat(64);
              await client.query(
                `INSERT INTO legal_documents (id, kind, version, "contentHash", "publishedAt")
                 SELECT gen_random_uuid(), $1::"LegalDocumentKind", $2, $3, now()
                 WHERE NOT EXISTS (
                   SELECT 1 FROM legal_documents WHERE kind = $1::"LegalDocumentKind"
                 )
                 ON CONFLICT (kind, version) DO NOTHING`,
                [entry.kind, DEFAULT_LEGAL_VERSION, defaultHash],
              );
              const bootstrappedRes = await client.query<{ id: string; version: string }>(
                SELECT_CURRENT_LEGAL_DOCUMENT_BY_KIND_SQL,
                [entry.kind],
              );
              latest = bootstrappedRes.rows[0];
            }

            if (latest === undefined) {
              throw new MissingLegalVersionError();
            }
            if (latest.version === requestedVersion) {
              resolved = latest;
            } else {
              const exactRes = await client.query<{ id: string; version: string }>(
                `SELECT id, version
                 FROM legal_documents
                 WHERE kind = $1::"LegalDocumentKind" AND version = $2
                 LIMIT 1`,
                [entry.kind, requestedVersion],
              );
              if (exactRes.rows[0] !== undefined) {
                throw new OutdatedLegalVersionError();
              }
              throw new MissingLegalVersionError();
            }
          }

          if (resolved === undefined) {
            throw new Error(`No se pudo resolver el documento legal ${entry.kind}`);
          }
          docsByKind.set(entry.kind, resolved);
        }
      }

      const userRes = await client.query<PublicUser>(
        `INSERT INTO users (id, email, "phoneE164", "passwordHash", status, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, 'ACTIVE', now(), now())
         RETURNING id, email, "phoneE164", status`,
        [input.email, input.phoneE164, input.passwordHash],
      );
      const user = userRes.rows[0];
      if (user === undefined) {
        throw new Error("No se pudo crear la cuenta");
      }

      const recordedConsents: RecordedRegistrationConsent[] = [];
      for (const entry of entries) {
        const doc = docsByKind.get(entry.kind);
        if (doc === undefined) {
          throw new Error(`No se pudo resolver el documento legal ${entry.kind}`);
        }
        await client.query(
          `INSERT INTO consent_records (
             id, "userId", "legalDocumentId", purpose, channel, "grantedAt", ip, "userAgent"
           ) VALUES (
             gen_random_uuid(), $1, $2, $3::"ConsentPurpose", $4::"ConsentChannel", now(), $5, $6
           )`,
          [
            user.id,
            doc.id,
            entry.purpose,
            input.consents.channel,
            input.consents.ip ?? null,
            input.consents.userAgent ?? null,
          ],
        );
        recordedConsents.push({
          purpose: entry.purpose,
          legalDocumentId: doc.id,
          version: doc.version,
        });
      }

      const termsDoc = docsByKind.get("TERMS");
      if (termsDoc === undefined) {
        throw new Error("No se pudo resolver el documento legal TERMS");
      }

      await client.query("COMMIT");
      return {
        user,
        consentPurposes: entries.map((e) => e.purpose),
        legalVersion: termsDoc.version,
        consents: recordedConsents,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findByEmail(email: string): Promise<StoredUser | null> {
    const result = await this.pool.query<StoredUser>(
      `SELECT id, email, "phoneE164", status, "passwordHash"
       FROM users WHERE email = $1`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  async findByPhone(phoneE164: string): Promise<StoredUser | null> {
    const result = await this.pool.query<StoredUser>(
      `SELECT id, email, "phoneE164", status, "passwordHash"
       FROM users WHERE "phoneE164" = $1`,
      [phoneE164],
    );
    return result.rows[0] ?? null;
  }

  async findById(id: string): Promise<PublicUser | null> {
    const result = await this.pool.query<PublicUser>(
      `SELECT id, email, "phoneE164", status FROM users WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async insertSession(input: {
    userId: string;
    tokenHash: string;
    client: string;
  }): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO sessions (id, "userId", "tokenHash", client, "expiresAt", "createdAt")
       VALUES (gen_random_uuid(), $1, $2, $3::"ClientKind", now() + interval '14 days', now())
       RETURNING id`,
      [input.userId, input.tokenHash, input.client],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("No se pudo abrir la sesión");
    }
    return row.id;
  }

  async findSession(tokenHash: string): Promise<StoredSession | null> {
    const result = await this.pool.query<StoredSession>(
      `SELECT s.id, s."userId", s.client, s."revokedAt", s."expiresAt",
              u.status::text AS "userStatus"
       FROM sessions s
       JOIN users u ON u.id = s."userId"
       WHERE s."tokenHash" = $1`,
      [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async revokeSession(id: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET "revokedAt" = now() WHERE id = $1`, [id]);
  }

  async secretRow(
    userId: string,
  ): Promise<{ passwordHash: string | null; tokenHash: string | null }> {
    const result = await this.pool.query<{ passwordHash: string | null; tokenHash: string | null }>(
      `SELECT u."passwordHash", s."tokenHash"
       FROM users u
       LEFT JOIN sessions s ON s."userId" = u.id
       WHERE u.id = $1
       ORDER BY s."createdAt" DESC NULLS LAST
       LIMIT 1`,
      [userId],
    );
    return result.rows[0] ?? { passwordHash: null, tokenHash: null };
  }
}
