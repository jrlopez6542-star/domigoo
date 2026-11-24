import type { Pool } from "pg";

export async function activateRestaurantForTest(
  pool: Pool,
  restaurantId: string,
  branchId: string,
): Promise<void> {
  await pool.query(`UPDATE restaurants SET status = 'ACTIVE', "updatedAt" = now() WHERE id = $1`, [
    restaurantId,
  ]);
  await pool.query(`UPDATE branches SET status = 'ACTIVE', "updatedAt" = now() WHERE id = $1`, [
    branchId,
  ]);
}
