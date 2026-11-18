import { Pool } from "pg";
import {
  SIMULACRO_EMAIL_DOMAIN,
  SIMULACRO_NIT,
  SIMULACRO_PREFIX,
  validateSimulacrosEnv,
  type SimulacrosConfig,
} from "./simulacros-guard.js";

let config: SimulacrosConfig;
try {
  config = validateSimulacrosEnv(process.env);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const client = await pool.connect();
  const emailPattern = `${SIMULACRO_PREFIX}%@${SIMULACRO_EMAIL_DOMAIN}`;

  try {
    await client.query("BEGIN");

    const simUsers = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email LIKE $1`,
      [emailPattern],
    );
    const userIds = simUsers.rows.map((row) => row.id);

    const simRestaurants = await client.query<{ id: string }>(
      `SELECT id FROM restaurants WHERE nit = $1`,
      [SIMULACRO_NIT],
    );
    const restaurantIds = simRestaurants.rows.map((row) => row.id);

    const simCouriers =
      userIds.length > 0
        ? await client.query<{ id: string }>(
            `SELECT id FROM couriers WHERE "userId" = ANY($1::text[])`,
            [userIds],
          )
        : { rows: [] };
    const courierIds = simCouriers.rows.map((row) => row.id);

    const simOrders =
      restaurantIds.length > 0 || userIds.length > 0
        ? await client.query<{ id: string }>(
            `SELECT id FROM orders
             WHERE "restaurantId" = ANY($1::text[])
                OR "createdById" = ANY($2::text[])`,
            [restaurantIds, userIds],
          )
        : { rows: [] };
    const orderIds = simOrders.rows.map((row) => row.id);

    let deletedOrders = 0;
    if (orderIds.length > 0) {
      await client.query(
        `DELETE FROM tracking_accesses
         WHERE "trackingLinkId" IN (
           SELECT id FROM tracking_links WHERE "orderId" = ANY($1::text[])
         )`,
        [orderIds],
      );
      await client.query(`DELETE FROM tracking_links WHERE "orderId" = ANY($1::text[])`, [
        orderIds,
      ]);
      await client.query(`DELETE FROM pin_attempts WHERE "orderId" = ANY($1::text[])`, [orderIds]);
      await client.query(`DELETE FROM dispatch_offers WHERE "orderId" = ANY($1::text[])`, [
        orderIds,
      ]);
      await client.query(`DELETE FROM order_events WHERE "orderId" = ANY($1::text[])`, [orderIds]);
      await client.query(`DELETE FROM tariff_quotes WHERE "orderId" = ANY($1::text[])`, [orderIds]);
      await client.query(
        `DELETE FROM incident_events
         WHERE "incidentId" IN (
           SELECT id FROM incidents WHERE "orderId" = ANY($1::text[])
         )`,
        [orderIds],
      );
      await client.query(`DELETE FROM incidents WHERE "orderId" = ANY($1::text[])`, [orderIds]);
      const delOrd = await client.query(`DELETE FROM orders WHERE id = ANY($1::text[])`, [
        orderIds,
      ]);
      deletedOrders = delOrd.rowCount ?? 0;
    }

    let deletedCouriers = 0;
    if (courierIds.length > 0) {
      await client.query(`DELETE FROM location_pings WHERE "courierId" = ANY($1::text[])`, [
        courierIds,
      ]);
      await client.query(`DELETE FROM courier_availabilities WHERE "courierId" = ANY($1::text[])`, [
        courierIds,
      ]);
      await client.query(
        `DELETE FROM verification_decisions
         WHERE "caseId" IN (
           SELECT id FROM verification_cases WHERE "courierId" = ANY($1::text[])
         )`,
        [courierIds],
      );
      await client.query(
        `DELETE FROM verification_checks
         WHERE "caseId" IN (
           SELECT id FROM verification_cases WHERE "courierId" = ANY($1::text[])
         )`,
        [courierIds],
      );
      await client.query(`DELETE FROM verification_cases WHERE "courierId" = ANY($1::text[])`, [
        courierIds,
      ]);
      await client.query(`DELETE FROM courier_documents WHERE "courierId" = ANY($1::text[])`, [
        courierIds,
      ]);
      await client.query(`DELETE FROM vehicles WHERE "courierId" = ANY($1::text[])`, [courierIds]);
      const delCour = await client.query(`DELETE FROM couriers WHERE id = ANY($1::text[])`, [
        courierIds,
      ]);
      deletedCouriers = delCour.rowCount ?? 0;
    }

    let deletedRestaurants = 0;
    if (restaurantIds.length > 0) {
      await client.query(
        `DELETE FROM subscription_payment_declarations WHERE "restaurantId" = ANY($1::text[])`,
        [restaurantIds],
      );
      await client.query(
        `DELETE FROM subscription_events
         WHERE "subscriptionId" IN (
           SELECT id FROM restaurant_subscriptions WHERE "restaurantId" = ANY($1::text[])
         )`,
        [restaurantIds],
      );
      await client.query(
        `DELETE FROM restaurant_subscriptions WHERE "restaurantId" = ANY($1::text[])`,
        [restaurantIds],
      );
      await client.query(
        `DELETE FROM branch_hours
         WHERE "branchId" IN (
           SELECT b.id FROM branches b
           JOIN establishments e ON e.id = b."establishmentId"
           WHERE e."restaurantId" = ANY($1::text[])
         )`,
        [restaurantIds],
      );
      await client.query(
        `DELETE FROM branches
         WHERE "establishmentId" IN (
           SELECT id FROM establishments WHERE "restaurantId" = ANY($1::text[])
         )`,
        [restaurantIds],
      );
      await client.query(`DELETE FROM establishments WHERE "restaurantId" = ANY($1::text[])`, [
        restaurantIds,
      ]);
      await client.query(
        `DELETE FROM restaurant_memberships WHERE "restaurantId" = ANY($1::text[])`,
        [restaurantIds],
      );
      const delRest = await client.query(`DELETE FROM restaurants WHERE id = ANY($1::text[])`, [
        restaurantIds,
      ]);
      deletedRestaurants = delRest.rowCount ?? 0;
    }

    let deletedUsers = 0;
    if (userIds.length > 0) {
      await client.query(`DELETE FROM notification_outbox WHERE "userId" = ANY($1::text[])`, [
        userIds,
      ]);
      await client.query(`DELETE FROM idempotency_keys WHERE "userId" = ANY($1::text[])`, [
        userIds,
      ]);
      await client.query(`DELETE FROM data_subject_requests WHERE "userId" = ANY($1::text[])`, [
        userIds,
      ]);
      await client.query(`DELETE FROM consent_records WHERE "userId" = ANY($1::text[])`, [userIds]);
      await client.query(`DELETE FROM device_push_tokens WHERE "userId" = ANY($1::text[])`, [
        userIds,
      ]);
      await client.query(`DELETE FROM admin_profiles WHERE "userId" = ANY($1::text[])`, [userIds]);
      await client.query(`DELETE FROM sessions WHERE "userId" = ANY($1::text[])`, [userIds]);
      const delUsr = await client.query(`DELETE FROM users WHERE id = ANY($1::text[])`, [userIds]);
      deletedUsers = delUsr.rowCount ?? 0;
    }

    await client.query("COMMIT");

    process.stdout.write(
      `${JSON.stringify(
        {
          reset: true,
          marker: "sim-m52",
          deletedOrders,
          deletedCouriers,
          deletedRestaurants,
          deletedUsers,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
