import { Injectable } from "@nestjs/common";
import { Database } from "../database.js";

export type MaintenanceSummary = {
  expiredOffers: number;
  expiredCourierInvitations: number;
  purgedAccessInvites: number;
  revokedExpiredTrackingLinks: number;
  purgedSessions: number;
  purgedIdempotencyKeys: number;
  purgedRateLimitBuckets: number;
  purgedLocationPings: number;
  purgedTrackingAccesses: number;
};

@Injectable()
export class MaintenanceService {
  constructor(private readonly database: Database) {}

  async runMaintenance(now = new Date()): Promise<MaintenanceSummary> {
    const expiredOffers = await this.execCount(
      `UPDATE dispatch_offers
       SET status = 'EXPIRED'
       WHERE status = 'PENDING' AND "expiresAt" < $1`,
      [now],
    );

    const expiredCourierInvitations = await this.execCount(
      `UPDATE courier_invitations
       SET status = 'EXPIRED'
       WHERE status = 'PENDING' AND "expiresAt" < $1`,
      [now],
    );

    const purgedAccessInvites = await this.execCount(
      `DELETE FROM access_invites
       WHERE "consumedAt" IS NULL AND "expiresAt" < $1`,
      [now],
    );

    const revokedExpiredTrackingLinks = await this.execCount(
      `UPDATE tracking_links
       SET "revokedAt" = $1
       WHERE "revokedAt" IS NULL AND "expiresAt" < $1`,
      [now],
    );

    const purgedSessions = await this.execCount(
      `DELETE FROM sessions
       WHERE "expiresAt" < $1`,
      [now],
    );

    const purgedIdempotencyKeys = await this.execCount(
      `DELETE FROM idempotency_keys
       WHERE "expiresAt" < $1`,
      [now],
    );

    const purgedRateLimitBuckets = await this.execCount(
      `DELETE FROM rate_limit_buckets
       WHERE "windowStart" < ($1::timestamptz - interval '24 hours')
         AND ("blockedUntil" IS NULL OR "blockedUntil" < $1::timestamptz)`,
      [now],
    );

    // Retención según docs/legal/politica-tratamiento-datos.md:
    // Recorridos detallados de geolocalización: 90 días (conservando pings ligados a incidentes abiertos).
    const purgedLocationPings = await this.execCount(
      `DELETE FROM location_pings
       WHERE "recordedAt" < ($1::timestamptz - interval '90 days')
         AND (
           "orderId" IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM incidents i
             WHERE i."orderId" = location_pings."orderId"
               AND i.status NOT IN ('RESOLVED', 'DISMISSED')
           )
         )`,
      [now],
    );

    const purgedTrackingAccesses = await this.execCount(
      `DELETE FROM tracking_accesses
       WHERE "accessedAt" < ($1::timestamptz - interval '90 days')`,
      [now],
    );

    return {
      expiredOffers,
      expiredCourierInvitations,
      purgedAccessInvites,
      revokedExpiredTrackingLinks,
      purgedSessions,
      purgedIdempotencyKeys,
      purgedRateLimitBuckets,
      purgedLocationPings,
      purgedTrackingAccesses,
    };
  }

  private async execCount(sql: string, params: unknown[]): Promise<number> {
    const result = await this.database.pool.query(sql, params);
    return result.rowCount ?? 0;
  }
}
