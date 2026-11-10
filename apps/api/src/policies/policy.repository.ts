import { Injectable } from "@nestjs/common";
import { Database } from "../database.js";

export type PolicyDraft = {
  name: string;
  offerRadiusMeters: number;
  directOfferTtlSeconds: number;
  openOfferTtlSeconds: number;
  seekingTtlSeconds: number;
  maxOffersPerWave: number;
  locationFreshnessSeconds: number;
};

@Injectable()
export class PolicyRepository {
  constructor(private readonly database: Database) {}

  async create(input: PolicyDraft): Promise<string> {
    const result = await this.database.pool.query<{ id: string }>(
      `INSERT INTO operations_policies (
         id, name, status, "offerRadiusMeters", "directOfferTtlSeconds", "openOfferTtlSeconds",
         "seekingTtlSeconds", "maxOffersPerWave", "locationFreshnessSeconds", "createdAt"
       ) VALUES (gen_random_uuid(), $1, 'DRAFT', $2, $3, $4, $5, $6, $7, now())
       RETURNING id`,
      [
        input.name,
        input.offerRadiusMeters,
        input.directOfferTtlSeconds,
        input.openOfferTtlSeconds,
        input.seekingTtlSeconds,
        input.maxOffersPerWave,
        input.locationFreshnessSeconds,
      ],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error("No se pudo crear la política");
    }
    return id;
  }

  async publish(id: string): Promise<boolean> {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE operations_policies SET status = 'RETIRED' WHERE status = 'PUBLISHED'`,
      );
      const updated = await client.query(
        `UPDATE operations_policies SET status = 'PUBLISHED', "publishedAt" = now() WHERE id = $1 AND status = 'DRAFT'`,
        [id],
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
}
