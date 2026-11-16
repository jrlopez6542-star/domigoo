import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { redactDiff } from "../audit/redact-diff.js";
import { APP_ENV, type AppEnv } from "../config/env.js";
import { Database } from "../database.js";
import { toCourierView, type CourierOrderView } from "./journey.repository.js";
import { canTransition, type OrderStatus } from "./order-machine.js";
import { generatePin, macsEqual, pinDecision, pinMac, sealPin, type PinKind } from "./pin.js";

export type PinFailure = "missing" | "forbidden" | "invalid" | "rejected" | "locked" | "conflict";

type LockedOrder = {
  status: string;
  assignedCourierId: string | null;
  customerPhoneE164: string | null;
  restaurantId: string;
  pickupPinHash: string | null;
  deliveryPinHash: string | null;
  pickupPinAttempts: number;
  deliveryPinAttempts: number;
  courierId: string | null;
  pinLength: number;
  maxPinAttempts: number;
  trackingHours: number;
};

@Injectable()
export class PinRepository {
  constructor(
    private readonly database: Database,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async confirm(
    orderId: string,
    userId: string,
    kind: PinKind,
    pin: string,
    idempotencyKey: string,
  ): Promise<CourierOrderView | PinFailure> {
    const requestHash = createHash("sha256")
      .update(
        `${orderId}:${kind}:${pinMac(this.env.pinPepper, orderId, kind, pin).toString("hex")}`,
      )
      .digest("hex");
    const from: OrderStatus = kind === "PICKUP" ? "AT_PICKUP" : "AT_DROPOFF";
    const to: OrderStatus = kind === "PICKUP" ? "PICKED_UP" : "DELIVERED";
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ requestHash: string; responseStatus: number }>(
        `SELECT "requestHash", "responseStatus" FROM idempotency_keys
         WHERE "userId" = $1 AND key = $2 FOR UPDATE`,
        [userId, idempotencyKey],
      );
      const prior = existing.rows[0];
      const locked = await client.query<LockedOrder>(
        `SELECT o.status::text AS status, o."assignedCourierId", o."customerPhoneE164", o."restaurantId",
                o."pickupPinHash", o."deliveryPinHash", o."pickupPinAttempts", o."deliveryPinAttempts",
                c.id AS "courierId",
                COALESCE(p."pinLength", 6) AS "pinLength",
                COALESCE(p."maxPinAttempts", 5) AS "maxPinAttempts",
                COALESCE(p."trackingHoursAfterTerminal", 24) AS "trackingHours"
         FROM orders o
         LEFT JOIN couriers c ON c."userId" = $2
         LEFT JOIN operations_policies p ON p.id = o."operationsPolicyId"
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
      if (prior !== undefined && prior.requestHash !== requestHash) {
        await client.query("ROLLBACK");
        return "conflict";
      }
      if (prior !== undefined) {
        await client.query("COMMIT");
        if (prior.responseStatus === 201) {
          return toCourierView(orderId, row.status, row.customerPhoneE164);
        }
        return prior.responseStatus === 423 ? "locked" : "rejected";
      }
      if (!canTransition(from, to) || row.status !== from) {
        await client.query("ROLLBACK");
        return "invalid";
      }
      const storedHash = kind === "PICKUP" ? row.pickupPinHash : row.deliveryPinHash;
      const attempts = kind === "PICKUP" ? row.pickupPinAttempts : row.deliveryPinAttempts;
      const maxAttempts = row.maxPinAttempts;
      if (storedHash === null || pinDecision(attempts, maxAttempts) === "locked") {
        await client.query("ROLLBACK");
        return storedHash === null ? "invalid" : "locked";
      }
      const stored = Buffer.from(storedHash, "hex");
      const computed = pinMac(this.env.pinPepper, orderId, kind, pin);
      const matches = macsEqual(stored, computed);
      if (!matches) {
        const next = attempts + 1;
        await this.recordAttempt(client, orderId, row.courierId, kind, false);
        await this.storeAttempts(client, orderId, kind, next);
        const lockedOut = next >= maxAttempts;
        if (lockedOut) {
          await this.openLockout(client, orderId, row, userId, kind);
        }
        await this.remember(client, userId, idempotencyKey, requestHash, lockedOut ? 423 : 422);
        await client.query("COMMIT");
        return lockedOut ? "locked" : "rejected";
      }
      if (kind === "PICKUP") {
        const deliveryPin = generatePin(row.pinLength, (size) => randomBytes(size));
        await client.query(
          `UPDATE orders
           SET status = 'PICKED_UP', "pickedUpAt" = now(),
               "deliveryPinHash" = $2, "deliveryPinCiphertext" = $3, "updatedAt" = now()
           WHERE id = $1`,
          [
            orderId,
            pinMac(this.env.pinPepper, orderId, "DELIVERY", deliveryPin).toString("hex"),
            sealPin(this.env.dataEncryptionKey, orderId, "DELIVERY", deliveryPin),
          ],
        );
      } else {
        await client.query(
          `UPDATE orders
           SET status = 'DELIVERED', "deliveredAt" = now(),
               "pickupPinCiphertext" = NULL, "deliveryPinCiphertext" = NULL, "updatedAt" = now()
           WHERE id = $1`,
          [orderId],
        );
        await client.query(
          `UPDATE courier_availabilities SET state = 'AVAILABLE', "updatedAt" = now()
           WHERE "courierId" = $1`,
          [row.courierId],
        );
        await client.query(
          `UPDATE tracking_links
           SET "expiresAt" = now() + ($2::int * interval '1 hour')
           WHERE "orderId" = $1`,
          [orderId, row.trackingHours],
        );
      }
      await this.recordAttempt(client, orderId, row.courierId, kind, true);
      await client.query(
        `INSERT INTO order_events (
           id, "orderId", "fromStatus", "toStatus", "actorKind", "actorId", "createdAt"
         ) VALUES (gen_random_uuid(), $1, $2::"OrderStatus", $3::"OrderStatus", 'COURIER', $4, now())`,
        [orderId, from, to, userId],
      );
      const diff = redactDiff({ from, to });
      await client.query(
        `INSERT INTO audit_logs
          (id, "actorId", "actorKind", action, "entityType", "entityId", diff, "createdAt")
         VALUES (gen_random_uuid(), $1, 'COURIER', $2, 'order', $3, $4::jsonb, now())`,
        [
          userId,
          kind === "PICKUP" ? "order.picked_up" : "order.delivered",
          orderId,
          JSON.stringify(diff),
        ],
      );
      await this.remember(client, userId, idempotencyKey, requestHash, 201);
      await client.query("COMMIT");
      return toCourierView(orderId, to, row.customerPhoneE164);
    } catch (error) {
      await client.query("ROLLBACK");
      if (pgCode(error) === "23505") {
        return "conflict";
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async recordAttempt(
    client: PoolClient,
    orderId: string,
    courierId: string,
    kind: PinKind,
    success: boolean,
  ): Promise<void> {
    await client.query(
      `INSERT INTO pin_attempts (id, "orderId", "courierId", kind, success, "createdAt")
       VALUES (gen_random_uuid(), $1, $2, $3::"PinKind", $4, now())`,
      [orderId, courierId, kind, success],
    );
  }

  private async storeAttempts(
    client: PoolClient,
    orderId: string,
    kind: PinKind,
    attempts: number,
  ): Promise<void> {
    if (kind === "PICKUP") {
      await client.query(
        `UPDATE orders SET "pickupPinAttempts" = $2, "updatedAt" = now() WHERE id = $1`,
        [orderId, attempts],
      );
      return;
    }
    await client.query(
      `UPDATE orders SET "deliveryPinAttempts" = $2, "updatedAt" = now() WHERE id = $1`,
      [orderId, attempts],
    );
  }

  private async openLockout(
    client: PoolClient,
    orderId: string,
    row: LockedOrder,
    userId: string,
    kind: PinKind,
  ): Promise<void> {
    const summary =
      kind === "PICKUP"
        ? "Se agotaron los intentos del PIN de recogida"
        : "Se agotaron los intentos del PIN de entrega";
    const created = await client.query<{ id: string }>(
      `INSERT INTO incidents (
         id, "orderId", "restaurantId", "courierId", "reporterId",
         type, severity, status, summary, "createdAt", "updatedAt"
       ) VALUES (
         gen_random_uuid(), $1, $2, $3, $4, 'PIN_LOCKOUT', 'HIGH', 'OPEN', $5, now(), now()
       )
       RETURNING id`,
      [orderId, row.restaurantId, row.courierId, userId, summary],
    );
    const incidentId = created.rows[0]?.id;
    if (incidentId === undefined) {
      throw new Error("No se pudo abrir el incidente");
    }
    await client.query(
      `INSERT INTO incident_events (id, "incidentId", "actorId", kind, payload, "createdAt")
       VALUES (gen_random_uuid(), $1, $2, 'OPENED', '{"type":"PIN_LOCKOUT"}'::jsonb, now())`,
      [incidentId, userId],
    );
    const diff = redactDiff({ type: "PIN_LOCKOUT", kind });
    await client.query(
      `INSERT INTO audit_logs
        (id, "actorId", "actorKind", action, "entityType", "entityId", diff, "createdAt")
       VALUES (gen_random_uuid(), $1, 'COURIER', 'incident.pin_lockout', 'incident', $2, $3::jsonb, now())`,
      [userId, incidentId, JSON.stringify(diff)],
    );
  }

  private async remember(
    client: PoolClient,
    userId: string,
    key: string,
    requestHash: string,
    responseStatus: number,
  ): Promise<void> {
    await client.query(
      `INSERT INTO idempotency_keys (
         id, "userId", key, "requestHash", "responseStatus", "createdAt", "expiresAt"
       ) VALUES (
         gen_random_uuid(), $1, $2, $3, $4, now(), now() + interval '1 day'
       )`,
      [userId, key, requestHash, responseStatus],
    );
  }
}

function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
