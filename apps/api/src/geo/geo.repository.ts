import { Injectable } from "@nestjs/common";
import { Database } from "../database.js";
import { CANDIDATE_SQL } from "./candidate-query.js";

export type PingInput = {
  userId: string;
  longitude: number;
  latitude: number;
  accuracyM: number | null;
};

@Injectable()
export class GeoRepository {
  constructor(private readonly database: Database) {}

  async setAvailability(
    userId: string,
    state: "AVAILABLE" | "OFFLINE",
  ): Promise<"ok" | "missing" | "not-approved" | "needs-consent"> {
    const courier = await this.courier(userId);
    if (courier === null) {
      return "missing";
    }
    if (state === "OFFLINE") {
      await this.database.pool.query(
        `INSERT INTO courier_availabilities ("courierId", state, "updatedAt")
         VALUES ($1, 'OFFLINE', now())
         ON CONFLICT ("courierId") DO UPDATE SET state = 'OFFLINE', "updatedAt" = now()`,
        [courier.id],
      );
      return "ok";
    }
    if (courier.status !== "APPROVED") {
      return "not-approved";
    }
    const consentId = await this.geolocationConsent(userId);
    if (consentId === null) {
      return "needs-consent";
    }
    await this.database.pool.query(
      `INSERT INTO courier_availabilities ("courierId", state, "consentId", "updatedAt")
       VALUES ($1, 'AVAILABLE', $2, now())
       ON CONFLICT ("courierId") DO UPDATE
         SET state = 'AVAILABLE', "consentId" = EXCLUDED."consentId", "updatedAt" = now()`,
      [courier.id, consentId],
    );
    return "ok";
  }

  async recordPing(input: PingInput): Promise<"ok" | "missing" | "needs-consent" | "unavailable"> {
    const courierId = await this.courierId(input.userId);
    if (courierId === null) {
      return "missing";
    }
    const consentId = await this.geolocationConsent(input.userId);
    if (consentId === null) {
      return "needs-consent";
    }
    const updated = await this.database.pool.query(
      `UPDATE courier_availabilities
       SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
           "recordedAt" = now(),
           "accuracyM" = $4,
           "consentId" = $5,
           "updatedAt" = now()
       WHERE "courierId" = $1 AND state = 'AVAILABLE'`,
      [courierId, input.longitude, input.latitude, input.accuracyM, consentId],
    );
    if ((updated.rowCount ?? 0) === 0) {
      return "unavailable";
    }
    await this.database.pool.query(
      `INSERT INTO location_pings (id, "courierId", purpose, location, "accuracyM", "recordedAt")
       VALUES (
         gen_random_uuid(), $1, 'AVAILABILITY',
         ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, now()
       )`,
      [courierId, input.longitude, input.latitude, input.accuracyM],
    );
    return "ok";
  }

  async candidates(
    branchId: string,
    userId: string,
    radiusMeters: number,
  ): Promise<{ ids: string[] } | "hidden"> {
    const member = await this.database.pool.query(
      `SELECT 1
       FROM branches b
       JOIN establishments e ON e.id = b."establishmentId"
       JOIN restaurant_memberships m ON m."restaurantId" = e."restaurantId"
       WHERE b.id = $1 AND m."userId" = $2 AND m.status = 'ACTIVE'`,
      [branchId, userId],
    );
    if ((member.rowCount ?? 0) === 0) {
      return "hidden";
    }
    return { ids: await this.idsInRadius(branchId, radiusMeters) };
  }

  async isEligible(branchId: string, courierId: string, radiusMeters: number): Promise<boolean> {
    const ids = await this.idsInRadius(branchId, radiusMeters);
    return ids.includes(courierId);
  }

  async listEligible(branchId: string, radiusMeters: number, limit: number): Promise<string[]> {
    const ids = await this.idsInRadius(branchId, radiusMeters);
    return ids.slice(0, limit);
  }

  private async idsInRadius(branchId: string, radiusMeters: number): Promise<string[]> {
    const policy = await this.database.pool.query<{ seconds: number }>(
      `SELECT "locationFreshnessSeconds" AS seconds
       FROM operations_policies WHERE status = 'PUBLISHED' LIMIT 1`,
    );
    const freshness = policy.rows[0]?.seconds ?? 120;
    const result = await this.database.pool.query<{ id: string }>(CANDIDATE_SQL, [
      branchId,
      freshness,
      radiusMeters,
    ]);
    return result.rows.map((row) => row.id);
  }

  private async courier(userId: string): Promise<{ id: string; status: string } | null> {
    const result = await this.database.pool.query<{ id: string; status: string }>(
      `SELECT id, status::text AS status FROM couriers WHERE "userId" = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  private async courierId(userId: string): Promise<string | null> {
    const found = await this.courier(userId);
    return found?.id ?? null;
  }

  private async geolocationConsent(userId: string): Promise<string | null> {
    const result = await this.database.pool.query<{ id: string }>(
      `SELECT id FROM consent_records
       WHERE "userId" = $1 AND purpose = 'GEOLOCATION' AND "revokedAt" IS NULL
       ORDER BY "grantedAt" DESC
       LIMIT 1`,
      [userId],
    );
    return result.rows[0]?.id ?? null;
  }
}
