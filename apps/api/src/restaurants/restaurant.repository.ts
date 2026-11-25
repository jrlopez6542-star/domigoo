import { Inject, Injectable, Optional } from "@nestjs/common";
import { APP_ENV, type AppEnv } from "../config/env.js";
import { Database } from "../database.js";

export type VisibleRestaurant = {
  id: string;
  tradeName: string;
};

export type MyBranchItem = {
  id: string;
  restaurantId: string;
  restaurantName: string;
  restaurantStatus: string;
  establishmentName: string;
  name: string;
  addressLine: string;
  status: string;
};

@Injectable()
export class RestaurantRepository {
  constructor(
    private readonly database: Database,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  async createSite(input: {
    ownerId: string;
    legalName: string;
    tradeName: string;
    nit: string;
    email: string;
    phoneE164: string;
    establishmentName: string;
    branchName: string;
    addressLine: string;
    longitude: number;
    latitude: number;
  }): Promise<{
    id: string;
    establishmentId: string;
    branchId: string;
    longitude: number;
    latitude: number;
  }> {
    const trialDays = this.env?.subscriptionTrialDays ?? 15;
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const restaurant = await client.query<{ id: string }>(
        `INSERT INTO restaurants (id, "legalName", "tradeName", nit, email, "phoneE164", status, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'DRAFT', now(), now())
         RETURNING id`,
        [input.legalName, input.tradeName, input.nit, input.email, input.phoneE164],
      );
      const restaurantId = restaurant.rows[0]?.id;
      if (restaurantId === undefined) {
        throw new Error("No se pudo crear el restaurante");
      }
      const establishment = await client.query<{ id: string }>(
        `INSERT INTO establishments (id, "restaurantId", name, status, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, 'DRAFT', now(), now())
         RETURNING id`,
        [restaurantId, input.establishmentName],
      );
      const establishmentId = establishment.rows[0]?.id;
      if (establishmentId === undefined) {
        throw new Error("No se pudo crear el establecimiento");
      }
      const branch = await client.query<{ id: string; longitude: number; latitude: number }>(
        `INSERT INTO branches (
           id, "establishmentId", name, "addressLine", location, status, "createdAt", "updatedAt"
         )
         VALUES (
           gen_random_uuid(), $1, $2, $3,
           ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
           'DRAFT', now(), now()
         )
         RETURNING id,
           ST_X(location::geometry)::float8 AS longitude,
           ST_Y(location::geometry)::float8 AS latitude`,
        [establishmentId, input.branchName, input.addressLine, input.longitude, input.latitude],
      );
      const created = branch.rows[0];
      if (created === undefined) {
        throw new Error("No se pudo crear la sucursal");
      }
      await client.query(
        `INSERT INTO restaurant_memberships (id, "restaurantId", "userId", role, status, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, 'OWNER', 'ACTIVE', now(), now())`,
        [restaurantId, input.ownerId],
      );
      const trialPlan = await client.query<{ id: string; trialDays: number }>(
        `INSERT INTO subscription_plans (
           id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders", active, "createdAt"
         ) VALUES (
           gen_random_uuid(), 'TRIAL_15D', 'Prueba gratuita 15 días', 0, 30, $1, 5, 20, true, now()
         )
         ON CONFLICT (code) DO UPDATE
           SET "priceCop" = 0,
               "trialDays" = EXCLUDED."trialDays",
               active = true
         RETURNING id, "trialDays"`,
        [trialDays],
      );
      const trialPlanRow = trialPlan.rows[0];
      if (trialPlanRow !== undefined) {
        const sub = await client.query<{ id: string }>(
          `INSERT INTO restaurant_subscriptions (
             id, "restaurantId", "planId", "priceCop", status, "isCurrent",
             "periodStartsAt", "periodEndsAt", "createdAt", "updatedAt"
           ) VALUES (
             gen_random_uuid(), $1, $2, 0, 'TRIAL', true,
             now(), now() + make_interval(days => $3), now(), now()
           )
           RETURNING id`,
          [restaurantId, trialPlanRow.id, trialPlanRow.trialDays],
        );
        const subId = sub.rows[0]?.id;
        if (subId !== undefined) {
          await client.query(
            `INSERT INTO subscription_events (
               id, "subscriptionId", "fromStatus", "toStatus", "actorId", reason, "createdAt"
             ) VALUES (
               gen_random_uuid(), $1, NULL, 'TRIAL', $2, 'auto_trial_15d', now()
             )`,
            [subId, input.ownerId],
          );
        }
      }
      await client.query("COMMIT");
      return {
        id: restaurantId,
        establishmentId,
        branchId: created.id,
        longitude: created.longitude,
        latitude: created.latitude,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findSiteForMember(
    restaurantId: string,
    userId: string,
  ): Promise<{
    id: string;
    tradeName: string;
    establishmentId: string;
    branchId: string;
    longitude: number;
    latitude: number;
  } | null> {
    const result = await this.database.pool.query<{
      id: string;
      tradeName: string;
      establishmentId: string;
      branchId: string;
      longitude: number;
      latitude: number;
    }>(
      `SELECT r.id, r."tradeName", e.id AS "establishmentId", b.id AS "branchId",
              ST_X(b.location::geometry)::float8 AS longitude,
              ST_Y(b.location::geometry)::float8 AS latitude
       FROM restaurants r
       JOIN restaurant_memberships m ON m."restaurantId" = r.id
       JOIN establishments e ON e."restaurantId" = r.id
       JOIN branches b ON b."establishmentId" = e.id
       WHERE r.id = $1 AND m."userId" = $2 AND m.status = 'ACTIVE' AND b.location IS NOT NULL
       ORDER BY b."createdAt"
       LIMIT 1`,
      [restaurantId, userId],
    );
    return result.rows[0] ?? null;
  }

  async replaceHours(
    branchId: string,
    userId: string,
    slots: { weekday: number; opensMinute: number; closesMinute: number; closed: boolean }[],
  ): Promise<boolean> {
    const owned = await this.ownsBranch(branchId, userId);
    if (!owned) {
      return false;
    }
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM branch_hours WHERE "branchId" = $1`, [branchId]);
      for (const slot of slots) {
        await client.query(
          `INSERT INTO branch_hours (id, "branchId", weekday, "opensMinute", "closesMinute", closed)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
          [branchId, slot.weekday, slot.opensMinute, slot.closesMinute, slot.closed],
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

  async activateBranch(branchId: string, userId: string): Promise<"ok" | "missing" | "unready"> {
    const result = await this.database.pool.query<{ hasPoint: boolean; hours: string }>(
      `SELECT b.location IS NOT NULL AS "hasPoint",
              (SELECT count(*) FROM branch_hours h WHERE h."branchId" = b.id)::text AS hours
       FROM branches b
       JOIN establishments e ON e.id = b."establishmentId"
       JOIN restaurant_memberships m ON m."restaurantId" = e."restaurantId"
       WHERE b.id = $1 AND m."userId" = $2 AND m.role = 'OWNER' AND m.status = 'ACTIVE'`,
      [branchId, userId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return "missing";
    }
    if (!row.hasPoint || Number(row.hours) < 1) {
      return "unready";
    }
    await this.database.pool.query(
      `UPDATE branches SET status = 'ACTIVE', "updatedAt" = now() WHERE id = $1`,
      [branchId],
    );
    return "ok";
  }

  async submitRestaurant(restaurantId: string, userId: string): Promise<boolean> {
    const result = await this.database.pool.query(
      `UPDATE restaurants r SET status = 'PENDING_REVIEW', "updatedAt" = now()
       FROM restaurant_memberships m
       WHERE r.id = m."restaurantId" AND r.id = $1 AND m."userId" = $2
         AND m.role = 'OWNER' AND m.status = 'ACTIVE' AND r.status = 'DRAFT'`,
      [restaurantId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async activateRestaurant(restaurantId: string): Promise<boolean> {
    const result = await this.database.pool.query(
      `UPDATE restaurants SET status = 'ACTIVE', "updatedAt" = now()
       WHERE id = $1 AND status = 'PENDING_REVIEW'`,
      [restaurantId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async ownsBranch(branchId: string, userId: string): Promise<boolean> {
    const result = await this.database.pool.query(
      `SELECT 1
       FROM branches b
       JOIN establishments e ON e.id = b."establishmentId"
       JOIN restaurant_memberships m ON m."restaurantId" = e."restaurantId"
       WHERE b.id = $1 AND m."userId" = $2 AND m.role = 'OWNER' AND m.status = 'ACTIVE'`,
      [branchId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findForMember(
    restaurantId: string,
    userId: string,
    options?: { allowOnboarding?: boolean },
  ): Promise<VisibleRestaurant | null> {
    const allowedStatuses = options?.allowOnboarding
      ? ["ACTIVE", "DRAFT", "PENDING_REVIEW"]
      : ["ACTIVE"];
    const result = await this.database.pool.query<VisibleRestaurant>(
      `SELECT r.id, r."tradeName"
       FROM restaurants r
       JOIN restaurant_memberships m ON m."restaurantId" = r.id
       WHERE r.id = $1 AND m."userId" = $2 AND m.status = 'ACTIVE'
         AND r.status = ANY($3::"RestaurantStatus"[])`,
      [restaurantId, userId, allowedStatuses],
    );
    return result.rows[0] ?? null;
  }

  async changeRole(input: {
    restaurantId: string;
    actorId: string;
    targetUserId: string;
    role: "OWNER" | "MANAGER" | "OPERATOR";
  }): Promise<{ membershipId: string; from: string; to: string } | null> {
    const actor = await this.database.pool.query<{ role: string }>(
      `SELECT role::text AS role FROM restaurant_memberships
       WHERE "restaurantId" = $1 AND "userId" = $2 AND status = 'ACTIVE'`,
      [input.restaurantId, input.actorId],
    );
    if (actor.rows[0]?.role !== "OWNER") {
      return null;
    }
    const current = await this.database.pool.query<{ id: string; role: string }>(
      `SELECT id, role::text AS role FROM restaurant_memberships
       WHERE "restaurantId" = $1 AND "userId" = $2`,
      [input.restaurantId, input.targetUserId],
    );
    const membership = current.rows[0];
    if (membership === undefined) {
      return null;
    }
    await this.database.pool.query(
      `UPDATE restaurant_memberships SET role = $2::"MembershipRole", "updatedAt" = now() WHERE id = $1`,
      [membership.id, input.role],
    );
    return { membershipId: membership.id, from: membership.role, to: input.role };
  }

  async listBranchesForUser(userId: string): Promise<MyBranchItem[] | "forbidden"> {
    const memberCheck = await this.database.pool.query<{ id: string }>(
      `SELECT id FROM restaurant_memberships WHERE "userId" = $1 AND status = 'ACTIVE' LIMIT 1`,
      [userId],
    );
    if (memberCheck.rows.length === 0) {
      return "forbidden";
    }
    const result = await this.database.pool.query<MyBranchItem>(
      `SELECT
         b.id,
         r.id AS "restaurantId",
         r."tradeName" AS "restaurantName",
         r.status::text AS "restaurantStatus",
         e.name AS "establishmentName",
         b.name,
         b."addressLine",
         b.status::text AS status
       FROM branches b
       JOIN establishments e ON e.id = b."establishmentId"
       JOIN restaurants r ON r.id = e."restaurantId"
       JOIN restaurant_memberships m ON m."restaurantId" = r.id
       WHERE m."userId" = $1 AND m.status = 'ACTIVE'
       ORDER BY b."createdAt" DESC`,
      [userId],
    );
    return result.rows;
  }
}
