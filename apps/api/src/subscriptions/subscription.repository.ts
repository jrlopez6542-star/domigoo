import { Injectable } from "@nestjs/common";
import { Database } from "../database.js";

export type PlanInput = {
  code: string;
  name: string;
  priceCop: number;
  periodDays: number;
  trialDays: number;
  maxBranches: number;
  maxConcurrentOrders: number;
};

export type OpenedSubscription = {
  id: string;
  priceCop: number;
  status: "TRIAL" | "ACTIVE";
};

const METHODS = new Set(["CASH", "NEQUI", "DAVIPLATA", "TRANSFER"]);

@Injectable()
export class SubscriptionRepository {
  constructor(private readonly database: Database) {}

  async createPlan(input: PlanInput): Promise<string | null> {
    try {
      const result = await this.database.pool.query<{ id: string }>(
        `INSERT INTO subscription_plans (
           id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders", "createdAt"
         ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now())
         RETURNING id`,
        [
          input.code,
          input.name,
          input.priceCop,
          input.periodDays,
          input.trialDays,
          input.maxBranches,
          input.maxConcurrentOrders,
        ],
      );
      return result.rows[0]?.id ?? null;
    } catch (error) {
      if (pgCode(error) === "23505" || pgCode(error) === "23514") {
        return null;
      }
      throw error;
    }
  }

  async open(input: {
    restaurantId: string;
    planId: string;
    status: "TRIAL" | "ACTIVE";
    actorId: string;
  }): Promise<OpenedSubscription | null> {
    const plan = await this.database.pool.query<{
      priceCop: number;
      periodDays: number;
      trialDays: number;
    }>(
      `SELECT "priceCop", "periodDays", "trialDays" FROM subscription_plans WHERE id = $1 AND active`,
      [input.planId],
    );
    const chosen = plan.rows[0];
    if (chosen === undefined) {
      return null;
    }
    const days = input.status === "TRIAL" ? chosen.trialDays : chosen.periodDays;
    if (days <= 0) {
      return null;
    }
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const created = await client.query<{ id: string; priceCop: number }>(
        `INSERT INTO restaurant_subscriptions (
           id, "restaurantId", "planId", "priceCop", status, "isCurrent",
           "periodStartsAt", "periodEndsAt", "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, $4::"SubscriptionStatus", true,
           now(), now() + make_interval(days => $5), now(), now()
         )
         RETURNING id, "priceCop"`,
        [input.restaurantId, input.planId, chosen.priceCop, input.status, days],
      );
      const row = created.rows[0];
      if (row === undefined) {
        throw new Error("No se pudo abrir la suscripción");
      }
      await client.query(
        `INSERT INTO subscription_events (
           id, "subscriptionId", "fromStatus", "toStatus", "actorId", reason, "createdAt"
         ) VALUES (gen_random_uuid(), $1, NULL, $2::"SubscriptionStatus", $3, 'opened', now())`,
        [row.id, input.status, input.actorId],
      );
      await client.query("COMMIT");
      return { id: row.id, priceCop: row.priceCop, status: input.status };
    } catch (error) {
      await client.query("ROLLBACK");
      if (pgCode(error) === "23503" || pgCode(error) === "23505") {
        return null;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async declare(input: {
    restaurantId: string;
    userId: string;
    amountCop: number;
    method: string;
    reference: string | null;
  }): Promise<string | null> {
    if (!METHODS.has(input.method) || input.amountCop <= 0) {
      return null;
    }
    const member = await this.database.pool.query(
      `SELECT 1 FROM restaurant_memberships
       WHERE "restaurantId" = $1 AND "userId" = $2 AND status = 'ACTIVE'`,
      [input.restaurantId, input.userId],
    );
    if (member.rowCount === 0) {
      return null;
    }
    const current = await this.database.pool.query<{ id: string }>(
      `SELECT id FROM restaurant_subscriptions WHERE "restaurantId" = $1 AND "isCurrent"`,
      [input.restaurantId],
    );
    const subscriptionId = current.rows[0]?.id;
    if (subscriptionId === undefined) {
      return null;
    }
    const created = await this.database.pool.query<{ id: string }>(
      `INSERT INTO subscription_payment_declarations (
         id, "subscriptionId", "amountCop", method, reference, status, "declaredById", "declaredAt"
       ) VALUES (
         gen_random_uuid(), $1, $2, $3::"PaymentMethod", $4, 'DECLARED', $5, now()
       )
       RETURNING id`,
      [subscriptionId, input.amountCop, input.method, input.reference, input.userId],
    );
    return created.rows[0]?.id ?? null;
  }

  async acknowledge(declarationId: string, actorId: string): Promise<boolean> {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{
        subscriptionId: string;
        status: string;
        periodDays: number;
      }>(
        `SELECT d."subscriptionId", s.status::text AS status, p."periodDays"
         FROM subscription_payment_declarations d
         JOIN restaurant_subscriptions s ON s.id = d."subscriptionId"
         JOIN subscription_plans p ON p.id = s."planId"
         WHERE d.id = $1 AND d.status = 'DECLARED'
         FOR UPDATE OF d, s`,
        [declarationId],
      );
      const row = found.rows[0];
      if (row === undefined) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `UPDATE subscription_payment_declarations
         SET status = 'ACKNOWLEDGED', "reviewedAt" = now()
         WHERE id = $1`,
        [declarationId],
      );
      await client.query(
        `UPDATE restaurant_subscriptions
         SET status = 'ACTIVE', "periodStartsAt" = now(),
             "periodEndsAt" = now() + make_interval(days => $2), "updatedAt" = now()
         WHERE id = $1`,
        [row.subscriptionId, row.periodDays],
      );
      if (row.status !== "ACTIVE") {
        await client.query(
          `INSERT INTO subscription_events (
             id, "subscriptionId", "fromStatus", "toStatus", "actorId", reason, "createdAt"
           ) VALUES (
             gen_random_uuid(), $1, $2::"SubscriptionStatus", 'ACTIVE', $3, 'payment_acknowledged', now()
           )`,
          [row.subscriptionId, row.status, actorId],
        );
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

  async memberCanDispatch(
    restaurantId: string,
    userId: string,
    at: Date,
  ): Promise<"hidden" | "blocked" | "ok"> {
    const member = await this.database.pool.query(
      `SELECT 1 FROM restaurant_memberships
       WHERE "restaurantId" = $1 AND "userId" = $2 AND status = 'ACTIVE'`,
      [restaurantId, userId],
    );
    if ((member.rowCount ?? 0) === 0) {
      return "hidden";
    }
    const allowed = await this.canDispatch(restaurantId, at);
    return allowed ? "ok" : "blocked";
  }

  async canDispatch(restaurantId: string, at: Date): Promise<boolean> {
    const result = await this.database.pool.query<{ status: string }>(
      `SELECT status::text AS status
       FROM restaurant_subscriptions
       WHERE "restaurantId" = $1 AND "isCurrent" AND "periodEndsAt" > $2
         AND status IN ('TRIAL', 'ACTIVE')`,
      [restaurantId, at],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async advance(at: Date): Promise<number> {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const due = await client.query<{ id: string; status: string }>(
        `SELECT id, status::text AS status
         FROM restaurant_subscriptions
         WHERE "isCurrent" AND "periodEndsAt" <= $1
           AND status IN ('TRIAL', 'ACTIVE', 'PAST_DUE')
         FOR UPDATE`,
        [at],
      );
      for (const row of due.rows) {
        const next = row.status === "ACTIVE" ? "PAST_DUE" : "SUSPENDED";
        await client.query(
          `UPDATE restaurant_subscriptions
           SET status = $2::"SubscriptionStatus", "updatedAt" = now()
           WHERE id = $1`,
          [row.id, next],
        );
        await client.query(
          `INSERT INTO subscription_events (
             id, "subscriptionId", "fromStatus", "toStatus", "actorId", reason, "createdAt"
           ) VALUES (
             gen_random_uuid(), $1, $2::"SubscriptionStatus", $3::"SubscriptionStatus", NULL, 'period_elapsed', now()
           )`,
          [row.id, row.status, next],
        );
      }
      await client.query("COMMIT");
      return due.rows.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
