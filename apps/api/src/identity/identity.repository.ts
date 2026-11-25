import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { Database } from "../database.js";

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

export type RegistrationConsentInput = {
  version: string;
  requestedVersion?: string;
  termsAccepted: boolean;
  privacyAccepted: boolean;
  sensitiveDataAccepted: boolean;
  marketingAccepted: boolean;
  channel: "WEB" | "MOBILE" | "ADMIN";
  ip?: string;
  userAgent?: string;
};

export class MissingLegalVersionError extends Error {
  constructor() {
    super("La versión de los documentos legales no existe");
    this.name = "MissingLegalVersionError";
  }
}

const DEFAULT_LEGAL_VERSION = "0.1-borrador";

const DEFAULT_DOCUMENT_HASHES: Record<string, string> = {
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
  }): Promise<{ user: PublicUser; consentPurposes: string[]; legalVersion: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const entries: Array<{
        kind: "TERMS" | "PRIVACY_NOTICE" | "DOCUMENT_PROCESSING";
        purpose: string;
      }> = [
        { kind: "TERMS", purpose: "TERMS_ACCEPTANCE" },
        { kind: "PRIVACY_NOTICE", purpose: "ACCOUNT" },
      ];
      if (input.consents.sensitiveDataAccepted) {
        entries.push({ kind: "DOCUMENT_PROCESSING", purpose: "DOCUMENT_STORAGE" });
      }
      if (input.consents.marketingAccepted) {
        entries.push({ kind: "PRIVACY_NOTICE", purpose: "MARKETING" });
      }

      const requestedVersion = input.consents.requestedVersion;
      const docsByKind = new Map<string, { id: string; version: string }>();

      for (const entry of entries) {
        if (docsByKind.has(entry.kind)) {
          continue;
        }
        const latestRes = await client.query<{ id: string; version: string }>(
          `SELECT id, version
           FROM legal_documents
           WHERE kind = $1::"LegalDocumentKind"
           ORDER BY "publishedAt" DESC, id DESC
           LIMIT 1`,
          [entry.kind],
        );
        const latest = latestRes.rows[0];

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
              `SELECT id, version
               FROM legal_documents
               WHERE kind = $1::"LegalDocumentKind"
               ORDER BY "publishedAt" DESC, id DESC
               LIMIT 1`,
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
          }
          const exactRes = await client.query<{ id: string; version: string }>(
            `SELECT id, version
             FROM legal_documents
             WHERE kind = $1::"LegalDocumentKind" AND version = $2
             LIMIT 1`,
            [entry.kind, requestedVersion],
          );
          resolved = exactRes.rows[0];
          if (resolved === undefined) {
            throw new MissingLegalVersionError();
          }
        }

        if (resolved === undefined) {
          throw new Error(`No se pudo resolver el documento legal ${entry.kind}`);
        }
        docsByKind.set(entry.kind, resolved);
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
