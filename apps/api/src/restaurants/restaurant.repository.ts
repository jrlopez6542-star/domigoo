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
}
