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
};

export type RegistrationConsentInput = {
  version: string;
  termsAccepted: boolean;
  privacyAccepted: boolean;
  sensitiveDataAccepted: boolean;
  marketingAccepted: boolean;
  channel: "WEB" | "MOBILE" | "ADMIN";
  ip?: string;
  userAgent?: string;
};

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

      const docIds = new Map<string, string>();
      for (const entry of entries) {
        if (!docIds.has(entry.kind)) {
          const defaultHash = DEFAULT_DOCUMENT_HASHES[entry.kind] ?? "0".repeat(64);
          await client.query(
            `INSERT INTO legal_documents (id, kind, version, "contentHash", "publishedAt")
             VALUES (gen_random_uuid(), $1::"LegalDocumentKind", $2, $3, now())
             ON CONFLICT (kind, version) DO NOTHING`,
            [entry.kind, input.consents.version, defaultHash],
          );
          const docRes = await client.query<{ id: string }>(
            `SELECT id FROM legal_documents WHERE kind = $1::"LegalDocumentKind" AND version = $2 LIMIT 1`,
            [entry.kind, input.consents.version],
          );
          const docId = docRes.rows[0]?.id;
          if (docId === undefined) {
            throw new Error(`No se pudo resolver el documento legal ${entry.kind}`);
          }
          docIds.set(entry.kind, docId);
        }

        const legalDocumentId = docIds.get(entry.kind);
        await client.query(
          `INSERT INTO consent_records (
             id, "userId", "legalDocumentId", purpose, channel, "grantedAt", ip, "userAgent"
           ) VALUES (
             gen_random_uuid(), $1, $2, $3::"ConsentPurpose", $4::"ConsentChannel", now(), $5, $6
           )`,
          [
            user.id,
            legalDocumentId,
            entry.purpose,
            input.consents.channel,
            input.consents.ip ?? null,
            input.consents.userAgent ?? null,
          ],
        );
      }

      await client.query("COMMIT");
      return {
        user,
        consentPurposes: entries.map((e) => e.purpose),
        legalVersion: input.consents.version,
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
      `SELECT id, "userId", client, "revokedAt", "expiresAt"
       FROM sessions WHERE "tokenHash" = $1`,
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
