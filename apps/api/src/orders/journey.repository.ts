import { Injectable } from "@nestjs/common";
import { Database } from "../database.js";
import { canTransition, type OrderStatus } from "./order-machine.js";

const PHONE_STATES = new Set([
  "ACCEPTED",
  "ARRIVING_PICKUP",
  "AT_PICKUP",
  "PICKED_UP",
  "AT_DROPOFF",
]);

export type CourierOrderView = {
  id: string;
  status: string;
  customerPhoneE164?: string;
};

export type OrderStep = {
  fromStatus: string;
  toStatus: string;
};

@Injectable()
export class JourneyRepository {
  constructor(private readonly database: Database) {}

  async step(
    orderId: string,
    userId: string,
    from: OrderStatus,
    to: OrderStatus,
  ): Promise<CourierOrderView | "missing" | "forbidden" | "invalid"> {
    if (!canTransition(from, to)) {
      return "invalid";
    }
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{
        status: string;
        assignedCourierId: string | null;
        customerPhoneE164: string | null;
        courierId: string | null;
      }>(
        `SELECT o.status::text AS status, o."assignedCourierId", o."customerPhoneE164", c.id AS "courierId"
         FROM orders o
         LEFT JOIN couriers c ON c."userId" = $2
         WHERE o.id = $1
         FOR UPDATE OF o`,
        [orderId, userId],
      );
      const row = locked.rows[0];
      if (row === undefined) {
        await client.query("ROLLBACK");
        return "missing";
      }
      if (row.courierId === null || row.assignedCourierId !== row.courierId) {
        await client.query("ROLLBACK");
        return "forbidden";
      }
      if (row.status !== from) {
        await client.query("ROLLBACK");
        return "invalid";
      }
      await client.query(
        `UPDATE orders SET status = $2::"OrderStatus", "updatedAt" = now() WHERE id = $1`,
        [orderId, to],
      );
      await client.query(
        `INSERT INTO order_events (
           id, "orderId", "fromStatus", "toStatus", "actorKind", "actorId", "createdAt"
         ) VALUES (gen_random_uuid(), $1, $2::"OrderStatus", $3::"OrderStatus", 'COURIER', $4, now())`,
        [orderId, from, to, userId],
      );
      await client.query("COMMIT");
      return view(orderId, to, row.customerPhoneE164);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async courierView(
    orderId: string,
    userId: string,
  ): Promise<CourierOrderView | "missing" | "forbidden"> {
    const result = await this.database.pool.query<{
      status: string;
      assignedCourierId: string | null;
      customerPhoneE164: string | null;
      courierId: string | null;
    }>(
      `SELECT o.status::text AS status, o."assignedCourierId", o."customerPhoneE164", c.id AS "courierId"
       FROM orders o
       LEFT JOIN couriers c ON c."userId" = $2
       WHERE o.id = $1`,
      [orderId, userId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return "missing";
    }
    if (row.courierId === null || row.assignedCourierId !== row.courierId) {
      return "forbidden";
    }
    return view(orderId, row.status, row.customerPhoneE164);
  }

  async events(orderId: string, userId: string): Promise<OrderStep[] | "missing" | "forbidden"> {
    const access = await this.database.pool.query<{ kind: string }>(
      `SELECT CASE
         WHEN m."userId" IS NOT NULL THEN 'member'
         WHEN c.id IS NOT NULL AND c.id = o."assignedCourierId" THEN 'courier'
         WHEN c.id IS NOT NULL THEN 'other-courier'
         ELSE 'none'
       END AS kind
       FROM orders o
       LEFT JOIN restaurant_memberships m
         ON m."restaurantId" = o."restaurantId" AND m."userId" = $2 AND m.status = 'ACTIVE'
       LEFT JOIN couriers c ON c."userId" = $2
       WHERE o.id = $1`,
      [orderId, userId],
    );
    const kind = access.rows[0]?.kind;
    if (kind === undefined) {
      return "missing";
    }
    if (kind === "other-courier") {
      return "forbidden";
    }
    if (kind !== "member" && kind !== "courier") {
      return "missing";
    }
    const rows = await this.database.pool.query<{ fromStatus: string | null; toStatus: string }>(
      `SELECT "fromStatus"::text AS "fromStatus", "toStatus"::text AS "toStatus"
       FROM order_events
       WHERE "orderId" = $1
       ORDER BY "createdAt" ASC`,
      [orderId],
    );
    return rows.rows.flatMap((row) =>
      row.fromStatus === null ? [] : [{ fromStatus: row.fromStatus, toStatus: row.toStatus }],
    );
  }
}

function view(id: string, status: string, phone: string | null): CourierOrderView {
  if (phone !== null && PHONE_STATES.has(status)) {
    return { id, status, customerPhoneE164: phone };
  }
  return { id, status };
}
