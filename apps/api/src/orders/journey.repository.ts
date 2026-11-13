import { Injectable } from "@nestjs/common";
import { Database } from "../database.js";
import { redactDiff } from "../audit/redact-diff.js";
import { canTransition, type OrderStatus } from "./order-machine.js";

export type JourneyStatus = "ARRIVING_PICKUP" | "AT_PICKUP" | "AT_DROPOFF";

export type JourneyTransitionResult = {
  id: string;
  fromStatus: string;
  toStatus: JourneyStatus;
  status: JourneyStatus;
};

@Injectable()
export class JourneyRepository {
  constructor(private readonly database: Database) {}

  async transitionByCourier(input: {
    orderId: string;
    userId: string;
    targetStatus: JourneyStatus;
  }): Promise<JourneyTransitionResult | "missing" | "forbidden" | "invalid_transition"> {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const orderQuery = await client.query<{
        id: string;
        status: string;
        assignedCourierId: string | null;
      }>(
        `SELECT id, status::text AS status, "assignedCourierId"
         FROM orders
         WHERE id = $1
         FOR UPDATE`,
        [input.orderId],
      );
      const order = orderQuery.rows[0];
      if (order === undefined) {
        await client.query("ROLLBACK");
        return "missing";
      }

      const courierQuery = await client.query<{ id: string }>(
        `SELECT id FROM couriers WHERE "userId" = $1`,
        [input.userId],
      );
      const courier = courierQuery.rows[0];
      if (courier === undefined || order.assignedCourierId !== courier.id) {
        await client.query("ROLLBACK");
        return "forbidden";
      }

      if (!canTransition(order.status as OrderStatus, input.targetStatus)) {
        await client.query("ROLLBACK");
        return "invalid_transition";
      }

      await client.query(
        `UPDATE orders
         SET status = $2::"OrderStatus", "updatedAt" = now()
         WHERE id = $1`,
        [input.orderId, input.targetStatus],
      );

      await client.query(
        `INSERT INTO order_events (
           id, "orderId", "fromStatus", "toStatus", "actorKind", "actorId", "createdAt"
         ) VALUES (gen_random_uuid(), $1, $2::"OrderStatus", $3::"OrderStatus", 'COURIER', $4, now())`,
        [input.orderId, order.status, input.targetStatus, input.userId],
      );

      const diff = redactDiff({ from: order.status, to: input.targetStatus });
      await client.query(
        `INSERT INTO audit_logs
          (id, "actorId", "actorKind", action, "entityType", "entityId", diff, "createdAt")
         VALUES (gen_random_uuid(), $1, 'COURIER', 'order.status_changed', 'order', $2, $3::jsonb, now())`,
        [input.userId, input.orderId, JSON.stringify(diff)],
      );

      await client.query("COMMIT");
      return {
        id: input.orderId,
        fromStatus: order.status,
        toStatus: input.targetStatus,
        status: input.targetStatus,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
