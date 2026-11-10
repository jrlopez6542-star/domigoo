import { Injectable } from "@nestjs/common";
import { Database } from "../database.js";

export type VisibleRestaurant = {
  id: string;
  tradeName: string;
};

@Injectable()
export class RestaurantRepository {
  constructor(private readonly database: Database) {}

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
