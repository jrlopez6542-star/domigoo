import { Injectable } from "@nestjs/common";
import { Database } from "../database.js";

@Injectable()
export class ExpirationRepository {
  constructor(private readonly database: Database) {}

  async expireStale(at: Date): Promise<{ expiredOrders: number; expiredOffers: number }> {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const staleOrders = await client.query<{ id: string }>(
        `SELECT id
         FROM orders
         WHERE status = 'SEEKING_COURIER'
           AND "seekingExpiresAt" IS NOT NULL
           AND "seekingExpiresAt" <= $1
         FOR UPDATE SKIP LOCKED`,
        [at],
      );

      let expiredOrders = 0;
      let expiredOffers = 0;

      for (const row of staleOrders.rows) {
        const updated = await client.query(
          `UPDATE orders
           SET status = 'EXPIRED', "updatedAt" = now()
           WHERE id = $1 AND status = 'SEEKING_COURIER'`,
          [row.id],
        );
        if (updated.rowCount === 1) {
          expiredOrders += 1;
          await client.query(
            `INSERT INTO order_events (
               id, "orderId", "fromStatus", "toStatus", "actorKind", "actorId", reason, "createdAt"
             ) VALUES (
               gen_random_uuid(), $1, 'SEEKING_COURIER', 'EXPIRED', 'SYSTEM', NULL, 'seeking_expired', now()
             )`,
            [row.id],
          );
          const offersForOrder = await client.query(
            `UPDATE dispatch_offers
             SET status = 'EXPIRED', "respondedAt" = now()
             WHERE "orderId" = $1 AND status = 'PENDING'`,
            [row.id],
          );
          expiredOffers += offersForOrder.rowCount ?? 0;
        }
      }

      const staleOffers = await client.query(
        `UPDATE dispatch_offers
         SET status = 'EXPIRED', "respondedAt" = now()
         WHERE status = 'PENDING' AND "expiresAt" <= $1`,
        [at],
      );
      expiredOffers += staleOffers.rowCount ?? 0;

      await client.query("COMMIT");
      return { expiredOrders, expiredOffers };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
