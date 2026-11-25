import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { Database } from "../database.js";
import { isNightInBogota } from "./bogota-time.js";
import { quoteCop } from "./quote.js";

export type TariffQuote = {
  versionId: string;
  zoneCode: string | null;
  distanceMeters: number;
  deliveryFeeCop: number;
};

@Injectable()
export class TariffRepository {
  constructor(private readonly database: Database) {}

  async createVersion(name: string): Promise<string> {
    const result = await this.database.pool.query<{ id: string }>(
      `INSERT INTO tariff_versions (id, name, status, "createdAt")
       VALUES (gen_random_uuid(), $1, 'DRAFT', now())
       RETURNING id`,
      [name],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error("No se pudo crear la tarifa");
    }
    return id;
  }

  async addZone(input: {
    versionId: string;
    code: string;
    name: string;
    polygonWkt: string;
    priority: number;
  }): Promise<{ id: string } | "conflict"> {
    try {
      const result = await this.database.pool.query<{ id: string }>(
        `INSERT INTO tariff_zones (id, "versionId", code, name, area, priority)
         VALUES (gen_random_uuid(), $1, $2, $3, ST_GeogFromText($4), $5)
         RETURNING id`,
        [input.versionId, input.code, input.name, input.polygonWkt, input.priority],
      );
      const id = result.rows[0]?.id;
      if (id === undefined) {
        throw new Error("No se pudo crear la zona");
      }
      return { id };
    } catch (error) {
      if (pgCode(error) === "23505") {
        return "conflict";
      }
      throw error;
    }
  }

  async addRule(input: {
    versionId: string;
    zoneId: string | null;
    baseFeeCop: number;
    perKmCop: number;
    minimumFeeCop: number;
    nightMultiplierBps: number;
    nightStartsMinute: number;
    nightEndsMinute: number;
  }): Promise<void> {
    await this.database.pool.query(
      `INSERT INTO tariff_rules (
         id, "versionId", "zoneId", "baseFeeCop", "perKmCop", "minimumFeeCop",
         "nightMultiplierBps", "nightStartsMinute", "nightEndsMinute"
       ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.versionId,
        input.zoneId,
        input.baseFeeCop,
        input.perKmCop,
        input.minimumFeeCop,
        input.nightMultiplierBps,
        input.nightStartsMinute,
        input.nightEndsMinute,
      ],
    );
  }

  async publish(versionId: string): Promise<boolean> {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE tariff_versions SET status = 'RETIRED' WHERE status = 'PUBLISHED'`,
      );
      const updated = await client.query(
        `UPDATE tariff_versions SET status = 'PUBLISHED', "publishedAt" = now()
         WHERE id = $1 AND status = 'DRAFT'`,
        [versionId],
      );
      if ((updated.rowCount ?? 0) !== 1) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async quote(
    input: {
      origin: { longitude: number; latitude: number };
      destination: { longitude: number; latitude: number };
      at: Date;
    },
    db: Pick<PoolClient, "query"> = this.database.pool,
  ): Promise<TariffQuote | null> {
    const version = await db.query<{ id: string }>(
      `SELECT id FROM tariff_versions WHERE status = 'PUBLISHED'`,
    );
    const versionId = version.rows[0]?.id;
    if (versionId === undefined) {
      return null;
    }
    const distance = await db.query<{ meters: number }>(
      `SELECT ST_Distance(
         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
         ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
       )::float8 AS meters`,
      [
        input.origin.longitude,
        input.origin.latitude,
        input.destination.longitude,
        input.destination.latitude,
      ],
    );
    const distanceMeters = Math.round(distance.rows[0]?.meters ?? 0);
    const zone = await db.query<{ id: string; code: string }>(
      `SELECT id, code FROM tariff_zones
       WHERE "versionId" = $1
         AND ST_Covers(area, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)
       ORDER BY priority DESC
       LIMIT 1`,
      [versionId, input.destination.longitude, input.destination.latitude],
    );
    const zoneRow = zone.rows[0];
    const ruleSql =
      zoneRow === undefined
        ? `SELECT "baseFeeCop", "perKmCop", "minimumFeeCop", "nightMultiplierBps",
                  "nightStartsMinute", "nightEndsMinute"
           FROM tariff_rules WHERE "versionId" = $1 AND "zoneId" IS NULL LIMIT 1`
        : `SELECT "baseFeeCop", "perKmCop", "minimumFeeCop", "nightMultiplierBps",
                  "nightStartsMinute", "nightEndsMinute"
           FROM tariff_rules
           WHERE "versionId" = $1 AND ("zoneId" = $2 OR "zoneId" IS NULL)
           ORDER BY ("zoneId" IS NOT NULL) DESC
           LIMIT 1`;
    const rule = await db.query<{
      baseFeeCop: number;
      perKmCop: number;
      minimumFeeCop: number;
      nightMultiplierBps: number;
      nightStartsMinute: number;
      nightEndsMinute: number;
    }>(ruleSql, zoneRow === undefined ? [versionId] : [versionId, zoneRow.id]);
    const pricing = rule.rows[0];
    if (pricing === undefined) {
      return null;
    }
    const deliveryFeeCop = quoteCop({
      baseFeeCop: pricing.baseFeeCop,
      perKmCop: pricing.perKmCop,
      minimumFeeCop: pricing.minimumFeeCop,
      distanceMeters,
      nightMultiplierBps: pricing.nightMultiplierBps,
      isNight: isNightInBogota(input.at, pricing.nightStartsMinute, pricing.nightEndsMinute),
    });
    return {
      versionId,
      zoneCode: zoneRow?.code ?? null,
      distanceMeters,
      deliveryFeeCop,
    };
  }

  async publishedCount(): Promise<number> {
    const result = await this.database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM tariff_versions WHERE status = 'PUBLISHED'`,
    );
    return Number(result.rows[0]?.count ?? "0");
  }
}

function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
