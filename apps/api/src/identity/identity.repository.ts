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
