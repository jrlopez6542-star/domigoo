import { Injectable } from "@nestjs/common";
import { redactDiff } from "../audit/redact-diff.js";
import { Database } from "../database.js";

export type AdminStats = {
  ordersByStatus: Record<string, number>;
  eligibleCouriers: number;
  medianAcceptSeconds: number | null;
  openIncidents: number;
  activeRestaurants: number;
  registeredCouriers: number;
  registeredClients: number;
  ordersToday: number;
  ordersInProgress: number;
  ordersCompletedToday: number;
};

@Injectable()
export class AdminRepository {
  constructor(private readonly database: Database) {}

  async setCourierSuspension(input: {
    courierId: string;
    userId: string;
    suspend: boolean;
    reason: string;
  }): Promise<{ id: string; status: string } | "missing" | "forbidden"> {
    if (!(await this.isOpsOrSuperadmin(input.userId))) {
      return "forbidden";
    }
    const target = input.suspend ? "SUSPENDED" : "APPROVED";
    const action = input.suspend ? "courier.suspended" : "courier.reinstated";

    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const curQ = await client.query<{ status: string }>(
        `SELECT status::text AS status FROM couriers WHERE id = $1 FOR UPDATE`,
        [input.courierId],
      );
      const cur = curQ.rows[0];
      if (cur === undefined) {
        await client.query("ROLLBACK");
        return "missing";
      }

      await client.query(
        `UPDATE couriers SET status = $2::"CourierStatus", "updatedAt" = now() WHERE id = $1`,
        [input.courierId, target],
      );
      if (input.suspend) {
        await client.query(
          `UPDATE courier_availabilities SET state = 'OFFLINE', "updatedAt" = now()
           WHERE "courierId" = $1`,
          [input.courierId],
        );
      }

      const diff = redactDiff({ from: cur.status, to: target, reason: input.reason });
      await client.query(
        `INSERT INTO audit_logs
          (id, "actorId", "actorKind", action, "entityType", "entityId", reason, diff, "createdAt")
         VALUES (gen_random_uuid(), $1, 'ADMIN', $2, 'courier', $3, $4, $5::jsonb, now())`,
        [input.userId, action, input.courierId, input.reason, JSON.stringify(diff)],
      );

      await client.query("COMMIT");
      return { id: input.courierId, status: target };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setRestaurantSuspension(input: {
    restaurantId: string;
    userId: string;
    suspend: boolean;
    reason: string;
  }): Promise<{ id: string; status: string } | "missing" | "forbidden"> {
    if (!(await this.isOpsOrSuperadmin(input.userId))) {
      return "forbidden";
    }
    const target = input.suspend ? "SUSPENDED" : "ACTIVE";
    const action = input.suspend ? "restaurant.suspended" : "restaurant.reinstated";

    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const curQ = await client.query<{ status: string }>(
        `SELECT status::text AS status FROM restaurants WHERE id = $1 FOR UPDATE`,
        [input.restaurantId],
      );
      const cur = curQ.rows[0];
      if (cur === undefined) {
        await client.query("ROLLBACK");
        return "missing";
      }

      await client.query(
        `UPDATE restaurants SET status = $2::"RestaurantStatus", "updatedAt" = now() WHERE id = $1`,
        [input.restaurantId, target],
      );

      const diff = redactDiff({ from: cur.status, to: target, reason: input.reason });
      await client.query(
        `INSERT INTO audit_logs
          (id, "actorId", "actorKind", action, "entityType", "entityId", reason, diff, "createdAt")
         VALUES (gen_random_uuid(), $1, 'ADMIN', $2, 'restaurant', $3, $4, $5::jsonb, now())`,
        [input.userId, action, input.restaurantId, input.reason, JSON.stringify(diff)],
      );

      await client.query("COMMIT");
      return { id: input.restaurantId, status: target };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getStats(input: {
    userId: string;
    from: Date;
    to: Date;
  }): Promise<AdminStats | "forbidden"> {
    if (!(await this.isOpsOrSuperadmin(input.userId))) {
      return "forbidden";
    }

    const statusRows = await this.database.pool.query<{ status: string; total: number }>(
      `SELECT status::text AS status, COUNT(*)::int AS total
       FROM orders
       WHERE "createdAt" >= $1 AND "createdAt" <= $2
       GROUP BY status`,
      [input.from, input.to],
    );
    const ordersByStatus: Record<string, number> = {};
    for (const row of statusRows.rows) {
      ordersByStatus[row.status] = row.total;
    }

    const couriersRow = await this.database.pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM couriers c
       JOIN courier_availabilities a ON a."courierId" = c.id
       WHERE c.status = 'APPROVED' AND a.state = 'AVAILABLE'`,
    );

    const medianRow = await this.database.pool.query<{ medianSeconds: number | null }>(
      `SELECT percentile_cont(0.5) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM ("acceptedAt" - "createdAt"))
       )::float8 AS "medianSeconds"
       FROM orders
       WHERE "acceptedAt" IS NOT NULL AND "createdAt" >= $1 AND "createdAt" <= $2`,
      [input.from, input.to],
    );

    const incidentsRow = await this.database.pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM incidents
       WHERE status IN ('OPEN', 'ACKNOWLEDGED', 'INVESTIGATING')`,
    );

    const summaryRow = await this.database.pool.query<{
      activeRestaurants: number;
      registeredCouriers: number;
      registeredClients: number;
      ordersToday: number;
      ordersInProgress: number;
      ordersCompletedToday: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM restaurants WHERE status = 'ACTIVE') AS "activeRestaurants",
         (SELECT COUNT(*)::int FROM couriers WHERE status <> 'REJECTED') AS "registeredCouriers",
         (SELECT COUNT(*)::int FROM users u
          WHERE u.status = 'ACTIVE'
            AND NOT EXISTS (SELECT 1 FROM admin_profiles ap WHERE ap."userId" = u.id)
            AND NOT EXISTS (SELECT 1 FROM restaurant_memberships rm WHERE rm."userId" = u.id)
            AND NOT EXISTS (SELECT 1 FROM couriers c WHERE c."userId" = u.id)
         ) AS "registeredClients",
         (SELECT COUNT(*)::int FROM orders
          WHERE ("createdAt" AT TIME ZONE 'America/Bogota')::date = (now() AT TIME ZONE 'America/Bogota')::date
         ) AS "ordersToday",
         (SELECT COUNT(*)::int FROM orders
          WHERE status IN ('SEEKING_COURIER', 'ACCEPTED', 'ARRIVING_PICKUP', 'AT_PICKUP', 'PICKED_UP', 'AT_DROPOFF')
         ) AS "ordersInProgress",
         (SELECT COUNT(*)::int FROM orders
          WHERE status = 'DELIVERED'
            AND ("deliveredAt" AT TIME ZONE 'America/Bogota')::date = (now() AT TIME ZONE 'America/Bogota')::date
         ) AS "ordersCompletedToday"`,
    );
    const s = summaryRow.rows[0];

    return {
      ordersByStatus,
      eligibleCouriers: couriersRow.rows[0]?.total ?? 0,
      medianAcceptSeconds: medianRow.rows[0]?.medianSeconds ?? null,
      openIncidents: incidentsRow.rows[0]?.total ?? 0,
      activeRestaurants: s?.activeRestaurants ?? 0,
      registeredCouriers: s?.registeredCouriers ?? 0,
      registeredClients: s?.registeredClients ?? 0,
      ordersToday: s?.ordersToday ?? 0,
      ordersInProgress: s?.ordersInProgress ?? 0,
      ordersCompletedToday: s?.ordersCompletedToday ?? 0,
    };
  }

  private async isOpsOrSuperadmin(userId: string): Promise<boolean> {
    const res = await this.database.pool.query<{ role: string }>(
      `SELECT role::text AS role FROM admin_profiles WHERE "userId" = $1`,
      [userId],
    );
    const role = res.rows[0]?.role;
    return role === "SUPERADMIN" || role === "OPERATIONS";
  }
}
