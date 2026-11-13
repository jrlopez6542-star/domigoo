import { Inject, Injectable, Optional } from "@nestjs/common";
import { APP_ENV, defaultPinEnv, type AppEnv } from "../config/env.js";
import { Database } from "../database.js";
import { redactDiff } from "../audit/redact-diff.js";
import { canTransition, type OrderStatus } from "./order-machine.js";
import { verifyPinHmac, type PinKind } from "./pin-crypto.js";

export type JourneyStatus = "ARRIVING_PICKUP" | "AT_PICKUP" | "AT_DROPOFF";

export type JourneyTransitionResult = {
  id: string;
  fromStatus: string;
  toStatus: string;
  status: string;
};

export type VerifyPinResult =
  | { kind: "ok"; id: string; fromStatus: string; toStatus: string; status: string }
  | { kind: "missing" }
  | { kind: "forbidden" }
  | { kind: "invalid_transition" }
  | { kind: "locked"; attempts: number; maxAttempts: number }
  | { kind: "invalid_pin"; attempts: number; maxAttempts: number; lockedOut: boolean };

@Injectable()
export class JourneyRepository {
  private readonly pinEnv: Pick<AppEnv, "pinPepper" | "appEncryptionKey">;

  constructor(
    private readonly database: Database,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.pinEnv = env ?? defaultPinEnv();
  }

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

  async verifyPinByCourier(input: {
    orderId: string;
    userId: string;
    kind: PinKind;
    pin: string;
  }): Promise<VerifyPinResult> {
    const expectedFrom: OrderStatus = input.kind === "PICKUP" ? "AT_PICKUP" : "AT_DROPOFF";
    const targetStatus: OrderStatus = input.kind === "PICKUP" ? "PICKED_UP" : "DELIVERED";

    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const orderQuery = await client.query<{
        id: string;
        restaurantId: string;
        status: string;
        assignedCourierId: string | null;
        operationsPolicyId: string | null;
        pickupPinHash: string | null;
        deliveryPinHash: string | null;
        pickupPinAttempts: number;
        deliveryPinAttempts: number;
      }>(
        `SELECT id, "restaurantId", status::text AS status, "assignedCourierId",
                "operationsPolicyId", "pickupPinHash", "deliveryPinHash",
                "pickupPinAttempts", "deliveryPinAttempts"
         FROM orders
         WHERE id = $1
         FOR UPDATE`,
        [input.orderId],
      );
      const order = orderQuery.rows[0];
      if (order === undefined) {
        await client.query("ROLLBACK");
        return { kind: "missing" };
      }

      const courierQuery = await client.query<{ id: string }>(
        `SELECT id FROM couriers WHERE "userId" = $1`,
        [input.userId],
      );
      const courier = courierQuery.rows[0];
      if (courier === undefined || order.assignedCourierId !== courier.id) {
        await client.query("ROLLBACK");
        return { kind: "forbidden" };
      }

      if (order.status !== expectedFrom || !canTransition(expectedFrom, targetStatus)) {
        await client.query("ROLLBACK");
        return { kind: "invalid_transition" };
      }

      let maxAttempts = 5;
      if (order.operationsPolicyId !== null) {
        const policyQuery = await client.query<{ maxPinAttempts: number }>(
          `SELECT "maxPinAttempts" FROM operations_policies WHERE id = $1`,
          [order.operationsPolicyId],
        );
        const policyAttempts = policyQuery.rows[0]?.maxPinAttempts;
        if (policyAttempts !== undefined && policyAttempts > 0) {
          maxAttempts = policyAttempts;
        }
      }

      const attempts =
        input.kind === "PICKUP" ? order.pickupPinAttempts : order.deliveryPinAttempts;
      if (attempts >= maxAttempts) {
        await client.query("ROLLBACK");
        return { kind: "locked", attempts, maxAttempts };
      }

      const expectedHash = input.kind === "PICKUP" ? order.pickupPinHash : order.deliveryPinHash;
      const valid =
        expectedHash !== null &&
        verifyPinHmac(input.pin, expectedHash, order.id, input.kind, this.pinEnv.pinPepper);

      await client.query(
        `INSERT INTO pin_attempts (id, "orderId", "courierId", kind, success, "createdAt")
         VALUES (gen_random_uuid(), $1, $2, $3::"PinKind", $4, now())`,
        [order.id, courier.id, input.kind, valid],
      );

      if (valid) {
        if (targetStatus === "PICKED_UP") {
          await client.query(
            `UPDATE orders
             SET status = 'PICKED_UP', "pickedUpAt" = now(), "updatedAt" = now()
             WHERE id = $1`,
            [order.id],
          );
        } else {
          await client.query(
            `UPDATE orders
             SET status = 'DELIVERED', "deliveredAt" = now(), "updatedAt" = now()
             WHERE id = $1`,
            [order.id],
          );
          await client.query(
            `UPDATE courier_availabilities
             SET state = 'AVAILABLE', "updatedAt" = now()
             WHERE "courierId" = $1 AND state = 'ON_SERVICE'`,
            [courier.id],
          );
        }

        await client.query(
          `INSERT INTO order_events (
             id, "orderId", "fromStatus", "toStatus", "actorKind", "actorId", "createdAt"
           ) VALUES (gen_random_uuid(), $1, $2::"OrderStatus", $3::"OrderStatus", 'COURIER', $4, now())`,
          [order.id, order.status, targetStatus, input.userId],
        );

        const diff = redactDiff({ from: order.status, to: targetStatus, pinKind: input.kind });
        await client.query(
          `INSERT INTO audit_logs
            (id, "actorId", "actorKind", action, "entityType", "entityId", diff, "createdAt")
           VALUES (gen_random_uuid(), $1, 'COURIER', 'order.status_changed', 'order', $2, $3::jsonb, now())`,
          [input.userId, order.id, JSON.stringify(diff)],
        );

        await client.query("COMMIT");
        return {
          kind: "ok",
          id: order.id,
          fromStatus: order.status,
          toStatus: targetStatus,
          status: targetStatus,
        };
      }

      const newAttempts = attempts + 1;
      if (input.kind === "PICKUP") {
        await client.query(
          `UPDATE orders SET "pickupPinAttempts" = $2, "updatedAt" = now() WHERE id = $1`,
          [order.id, newAttempts],
        );
      } else {
        await client.query(
          `UPDATE orders SET "deliveryPinAttempts" = $2, "updatedAt" = now() WHERE id = $1`,
          [order.id, newAttempts],
        );
      }

      const lockedOut = newAttempts >= maxAttempts;
      if (lockedOut) {
        const incidentRes = await client.query<{ id: string }>(
          `INSERT INTO incidents (
             id, "orderId", "restaurantId", "courierId", "reporterId", type, severity, status, summary, "createdAt", "updatedAt"
           ) VALUES (
             gen_random_uuid(), $1, $2, $3, $4, 'PIN_LOCKOUT', 'HIGH', 'OPEN', $5, now(), now()
           )
           RETURNING id`,
          [
            order.id,
            order.restaurantId,
            courier.id,
            input.userId,
            `Bloqueo por límite de intentos fallidos en PIN de ${input.kind === "PICKUP" ? "recogida" : "entrega"}`,
          ],
        );
        const incidentId = incidentRes.rows[0]?.id;
        if (incidentId !== undefined) {
          await client.query(
            `INSERT INTO incident_events (id, "incidentId", "actorId", kind, payload, "createdAt")
             VALUES (gen_random_uuid(), $1, $2, 'CREATED', $3::jsonb, now())`,
            [
              incidentId,
              input.userId,
              JSON.stringify({ pinKind: input.kind, attempts: newAttempts, maxAttempts }),
            ],
          );
        }
      }

      const failDiff = redactDiff({
        pinKind: input.kind,
        attempts: newAttempts,
        lockedOut,
      });
      await client.query(
        `INSERT INTO audit_logs
          (id, "actorId", "actorKind", action, "entityType", "entityId", diff, "createdAt")
         VALUES (gen_random_uuid(), $1, 'COURIER', 'order.pin_failed', 'order', $2, $3::jsonb, now())`,
        [input.userId, order.id, JSON.stringify(failDiff)],
      );

      await client.query("COMMIT");
      return {
        kind: "invalid_pin",
        attempts: newAttempts,
        maxAttempts,
        lockedOut,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelOrder(input: {
    orderId: string;
    userId: string;
    reason: string;
  }): Promise<JourneyTransitionResult | "missing" | "forbidden" | "invalid_transition"> {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const orderQuery = await client.query<{
        id: string;
        restaurantId: string;
        status: string;
        assignedCourierId: string | null;
      }>(
        `SELECT id, "restaurantId", status::text AS status, "assignedCourierId"
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

      let actorKind: "RESTAURANT" | "COURIER" | "ADMIN" | null = null;
      let targetStatus: OrderStatus | null = null;

      const memberQuery = await client.query<{ id: string }>(
        `SELECT id FROM restaurant_memberships
         WHERE "restaurantId" = $1 AND "userId" = $2 AND status = 'ACTIVE'
           AND role IN ('OWNER', 'MANAGER', 'OPERATOR')`,
        [order.restaurantId, input.userId],
      );
      if (memberQuery.rows[0] !== undefined) {
        actorKind = "RESTAURANT";
        targetStatus = "CANCELLED_RESTAURANT";
      } else {
        const courierQuery = await client.query<{ id: string }>(
          `SELECT id FROM couriers WHERE "userId" = $1`,
          [input.userId],
        );
        const courier = courierQuery.rows[0];
        if (courier !== undefined) {
          if (order.assignedCourierId !== courier.id) {
            await client.query("ROLLBACK");
            return "forbidden";
          }
          actorKind = "COURIER";
          targetStatus = "CANCELLED_COURIER";
        } else {
          const adminQuery = await client.query<{ role: string }>(
            `SELECT role::text AS role FROM admin_profiles WHERE "userId" = $1`,
            [input.userId],
          );
          const role = adminQuery.rows[0]?.role;
          if (role === "SUPERADMIN" || role === "OPERATIONS") {
            actorKind = "ADMIN";
            targetStatus = "CANCELLED_ADMIN";
          }
        }
      }

      if (actorKind === null || targetStatus === null) {
        await client.query("ROLLBACK");
        return "missing";
      }

      if (!canTransition(order.status as OrderStatus, targetStatus)) {
        await client.query("ROLLBACK");
        return "invalid_transition";
      }

      await client.query(
        `UPDATE orders
         SET status = $2::"OrderStatus",
             "cancelledAt" = now(),
             "cancelReason" = $3,
             "updatedAt" = now()
         WHERE id = $1`,
        [order.id, targetStatus, input.reason],
      );

      await client.query(
        `UPDATE dispatch_offers
         SET status = 'CANCELLED', "respondedAt" = now()
         WHERE "orderId" = $1 AND status = 'PENDING'`,
        [order.id],
      );

      if (order.assignedCourierId !== null) {
        await client.query(
          `UPDATE courier_availabilities
           SET state = 'AVAILABLE', "updatedAt" = now()
           WHERE "courierId" = $1 AND state = 'ON_SERVICE'`,
          [order.assignedCourierId],
        );
      }

      await client.query(
        `INSERT INTO order_events (
           id, "orderId", "fromStatus", "toStatus", "actorKind", "actorId", reason, "createdAt"
         ) VALUES (gen_random_uuid(), $1, $2::"OrderStatus", $3::"OrderStatus", $4::"ActorKind", $5, $6, now())`,
        [order.id, order.status, targetStatus, actorKind, input.userId, input.reason],
      );

      const diff = redactDiff({ from: order.status, to: targetStatus, reason: input.reason });
      await client.query(
        `INSERT INTO audit_logs
          (id, "actorId", "actorKind", action, "entityType", "entityId", reason, diff, "createdAt")
         VALUES (gen_random_uuid(), $1, $2::"ActorKind", 'order.cancelled', 'order', $3, $4, $5::jsonb, now())`,
        [input.userId, actorKind, order.id, input.reason, JSON.stringify(diff)],
      );

      await client.query("COMMIT");
      return {
        id: order.id,
        fromStatus: order.status,
        toStatus: targetStatus,
        status: targetStatus,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
