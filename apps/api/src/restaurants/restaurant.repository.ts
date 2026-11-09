import { Injectable } from "@nestjs/common";
import { Database } from "../database.js";

export type VisibleRestaurant = {
  id: string;
  tradeName: string;
};

@Injectable()
export class RestaurantRepository {
  constructor(private readonly database: Database) {}

  async findForMember(restaurantId: string, userId: string): Promise<VisibleRestaurant | null> {
    const result = await this.database.pool.query<VisibleRestaurant>(
      `SELECT r.id, r."tradeName"
       FROM restaurants r
       JOIN restaurant_memberships m ON m."restaurantId" = r.id
       WHERE r.id = $1 AND m."userId" = $2 AND m.status = 'ACTIVE'`,
      [restaurantId, userId],
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
}
