import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Database } from "../database.js";
import { LoginLimitedError } from "../identity/login-throttle.js";

const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export type RateLimitDecision = {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
};

@Injectable()
export class RateLimitService {
  constructor(private readonly database: Database) {}

  async consume(
    rawKey: string,
    limit: number,
    windowMs: number,
    blockMs = windowMs,
  ): Promise<RateLimitDecision> {
    const key = normalizeKey(rawKey);
    const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
    const blockSec = Math.max(1, Math.ceil(blockMs / 1000));

    const result = await this.database.pool.query<{
      count: number;
      blockedUntil: Date | null;
      windowStart: Date;
    }>(
      `INSERT INTO rate_limit_buckets ("key", "count", "windowStart", "blockedUntil")
       VALUES (
         $1,
         1,
         now(),
         CASE WHEN 1 > $2 THEN now() + make_interval(secs => $4) ELSE NULL END
       )
       ON CONFLICT ("key") DO UPDATE SET
         "count" = CASE
           WHEN rate_limit_buckets."blockedUntil" IS NOT NULL AND rate_limit_buckets."blockedUntil" > now()
             THEN rate_limit_buckets."count"
           WHEN rate_limit_buckets."windowStart" + make_interval(secs => $3) <= now()
             THEN 1
           ELSE rate_limit_buckets."count" + 1
         END,
         "windowStart" = CASE
           WHEN rate_limit_buckets."blockedUntil" IS NOT NULL AND rate_limit_buckets."blockedUntil" > now()
             THEN rate_limit_buckets."windowStart"
           WHEN rate_limit_buckets."windowStart" + make_interval(secs => $3) <= now()
             THEN now()
           ELSE rate_limit_buckets."windowStart"
         END,
         "blockedUntil" = CASE
           WHEN rate_limit_buckets."blockedUntil" IS NOT NULL AND rate_limit_buckets."blockedUntil" > now()
             THEN rate_limit_buckets."blockedUntil"
           WHEN (
             CASE
               WHEN rate_limit_buckets."windowStart" + make_interval(secs => $3) <= now() THEN 1
               ELSE rate_limit_buckets."count" + 1
             END
           ) > $2
             THEN now() + make_interval(secs => $4)
           ELSE NULL
         END
       RETURNING "count", "blockedUntil", "windowStart"`,
      [key, limit, windowSec, blockSec],
    );

    const row = result.rows[0];
    if (row === undefined) {
      return { allowed: true, count: 1, retryAfterSeconds: 0 };
    }
    if (row.blockedUntil !== null && row.blockedUntil.getTime() > Date.now()) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((row.blockedUntil.getTime() - Date.now()) / 1000),
      );
      return { allowed: false, count: row.count, retryAfterSeconds };
    }
    return { allowed: true, count: row.count, retryAfterSeconds: 0 };
  }

  async assertLoginAllowed(identifier: string, ip: string): Promise<void> {
    const key = loginBucketKey(identifier, ip);
    const result = await this.database.pool.query<{
      count: number;
      blockedUntil: Date | null;
    }>(
      `SELECT "count", "blockedUntil"
       FROM rate_limit_buckets
       WHERE "key" = $1`,
      [key],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return;
    }
    if (row.blockedUntil !== null && row.blockedUntil.getTime() > Date.now()) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((row.blockedUntil.getTime() - Date.now()) / 1000),
      );
      throw new LoginLimitedError(retryAfterSeconds);
    }
  }

  async recordLoginFailure(identifier: string, ip: string): Promise<void> {
    const key = loginBucketKey(identifier, ip);
    const windowSec = Math.ceil(LOGIN_WINDOW_MS / 1000);
    await this.database.pool.query(
      `INSERT INTO rate_limit_buckets ("key", "count", "windowStart", "blockedUntil")
       VALUES ($1, 1, now(), NULL)
       ON CONFLICT ("key") DO UPDATE SET
         "count" = CASE
           WHEN rate_limit_buckets."windowStart" + make_interval(secs => $2) <= now()
             AND (rate_limit_buckets."blockedUntil" IS NULL OR rate_limit_buckets."blockedUntil" <= now())
             THEN 1
           ELSE rate_limit_buckets."count" + 1
         END,
         "windowStart" = CASE
           WHEN rate_limit_buckets."windowStart" + make_interval(secs => $2) <= now()
             AND (rate_limit_buckets."blockedUntil" IS NULL OR rate_limit_buckets."blockedUntil" <= now())
             THEN now()
           ELSE rate_limit_buckets."windowStart"
         END,
         "blockedUntil" = CASE
           WHEN (
             CASE
               WHEN rate_limit_buckets."windowStart" + make_interval(secs => $2) <= now()
                 AND (rate_limit_buckets."blockedUntil" IS NULL OR rate_limit_buckets."blockedUntil" <= now())
                 THEN 1
               ELSE rate_limit_buckets."count" + 1
             END
           ) >= $3 * 2
             THEN now() + make_interval(secs => $2 * 2)
           WHEN (
             CASE
               WHEN rate_limit_buckets."windowStart" + make_interval(secs => $2) <= now()
                 AND (rate_limit_buckets."blockedUntil" IS NULL OR rate_limit_buckets."blockedUntil" <= now())
                 THEN 1
               ELSE rate_limit_buckets."count" + 1
             END
           ) >= $3
             THEN now() + make_interval(secs => $2)
           ELSE NULL
         END`,
      [key, windowSec, LOGIN_MAX_FAILURES],
    );
  }

  async clearLoginFailures(identifier: string, ip: string): Promise<void> {
    await this.database.pool.query(`DELETE FROM rate_limit_buckets WHERE "key" = $1`, [
      loginBucketKey(identifier, ip),
    ]);
  }

  async clearAll(): Promise<void> {
    await this.database.pool.query(`DELETE FROM rate_limit_buckets`);
  }
}

function loginBucketKey(identifier: string, ip: string): string {
  const hash = createHash("sha256")
    .update(`${identifier.trim().toLowerCase()}|${ip.trim()}`)
    .digest("hex")
    .slice(0, 40);
  return `login:${hash}`;
}

function normalizeKey(raw: string): string {
  if (raw.length <= 180) {
    return raw;
  }
  return `h:${createHash("sha256").update(raw).digest("hex")}`;
}
