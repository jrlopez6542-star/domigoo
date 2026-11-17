import { createHash } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { APP_ENV, defaultPinEnv, type AppEnv } from "../config/env.js";
import { Database } from "../database.js";
import { redactDiff } from "../audit/redact-diff.js";
import { canTransition } from "./order-machine.js";
import { encryptPin, generatePin, hashPin } from "./pin-crypto.js";

export type AcceptResult = {
  offerId: string;
  orderId: string;
  offerStatus: "ACCEPTED";
  orderStatus: "ACCEPTED";
};

export type AvailableOfferItem = {
  offerId: string;
  orderId: string;
  referenceCode: string;
  restaurantName: string;
  branchName: string;
  pickupAddress: string;
  dropoffAddress: string;
  deliveryFeeCop: number;
  expiresAt: string;
};

export function computeOfferAcceptHash(offerId: string, body: unknown): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        method: "POST",
        action: "accept_offer",
        offerId,
        body: body ?? {},
      }),
    )
    .digest("hex");
}

@Injectable()
export class OffersRepository {
  private readonly pinEnv: Pick<AppEnv, "pinPepper" | "appEncryptionKey">;

  constructor(
    private readonly database: Database,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.pinEnv = env ?? defaultPinEnv();
  }

  async accept(
    offerId: string,
    userId: string,
    idempotencyKey: string,
    body: unknown,
  ): Promise<AcceptResult | "missing" | "conflict" | "mismatch"> {
    const requestHash = computeOfferAcceptHash(offerId, body);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ requestHash: string }>(
        `SELECT "requestHash" FROM idempotency_keys WHERE "userId" = $1 AND key = $2 FOR UPDATE`,
        [userId, idempotencyKey],
      );
      let prior = existing.rows[0];
      if (prior !== undefined && prior.requestHash !== requestHash) {
        await client.query("ROLLBACK");
        return "mismatch";
      }

      const courierRow = await client.query<{
        courierId: string;
        availabilityState: string;
      }>(
        `SELECT c.id AS "courierId", a.state::text AS "availabilityState"
         FROM couriers c
         JOIN courier_availabilities a ON a."courierId" = c.id
         WHERE c."userId" = $1
         FOR UPDATE OF a`,
        [userId],
      );
      const courier = courierRow.rows[0];
      if (courier === undefined) {
        await client.query("ROLLBACK");
        return "missing";
      }

      // Si no encontramos la clave al inicio, re-consultamos idempotency_keys
      // tras adquirir el cerrojo de disponibilidad para capturar carreras concurrentes
      if (prior === undefined) {
        const recheck = await client.query<{ requestHash: string }>(
          `SELECT "requestHash" FROM idempotency_keys WHERE "userId" = $1 AND key = $2 FOR UPDATE`,
          [userId, idempotencyKey],
        );
        prior = recheck.rows[0];
        if (prior !== undefined && prior.requestHash !== requestHash) {
          await client.query("ROLLBACK");
          return "mismatch";
        }
      }

      if (prior !== undefined) {
        const offerQuery = await client.query<{
          orderId: string;
          orderStatus: string;
          offerStatus: string;
        }>(
          `SELECT d."orderId", o.status::text AS "orderStatus", d.status::text AS "offerStatus"
           FROM dispatch_offers d
           JOIN orders o ON o.id = d."orderId"
           WHERE d.id = $1 AND d."courierId" = $2`,
          [offerId, courier.courierId],
        );
        const offer = offerQuery.rows[0];
        if (offer === undefined) {
          await client.query("ROLLBACK");
          return "missing";
        }
        if (offer.offerStatus !== "ACCEPTED") {
          await client.query("ROLLBACK");
          return "conflict";
        }
        await client.query("COMMIT");
        return {
          offerId,
          orderId: offer.orderId,
          offerStatus: "ACCEPTED",
          orderStatus: "ACCEPTED",
        };
      }

      if (courier.availabilityState !== "AVAILABLE") {
        await client.query("ROLLBACK");
        return "conflict";
      }

      const locked = await client.query<{
        orderId: string;
        orderStatus: string;
        offerStatus: string;
        expiresAt: Date | string;
      }>(
        `SELECT o.id AS "orderId", o.status::text AS "orderStatus", d.status::text AS "offerStatus",
                d."expiresAt"
         FROM dispatch_offers d
         JOIN orders o ON o.id = d."orderId"
         WHERE d.id = $1 AND d."courierId" = $2
         FOR UPDATE OF o, d`,
        [offerId, courier.courierId],
      );
      const row = locked.rows[0];
      if (row === undefined) {
        await client.query("ROLLBACK");
        return "missing";
      }

      if (
        !canTransition("SEEKING_COURIER", "ACCEPTED") ||
        row.orderStatus !== "SEEKING_COURIER" ||
        row.offerStatus !== "PENDING" ||
        new Date(row.expiresAt).getTime() <= Date.now()
      ) {
        await client.query("ROLLBACK");
        return "conflict";
      }
      await client.query(
        `UPDATE dispatch_offers SET status = 'ACCEPTED', "respondedAt" = now() WHERE id = $1`,
        [offerId],
      );
      await client.query(
        `UPDATE dispatch_offers
         SET status = 'SUPERSEDED', "respondedAt" = now()
         WHERE "orderId" = $1 AND id <> $2 AND status = 'PENDING'`,
        [row.orderId, offerId],
      );
      const pickupPin = generatePin(6);
      const deliveryPin = generatePin(6);
      const pickupPinHash = hashPin(pickupPin, row.orderId, "PICKUP", this.pinEnv.pinPepper);
      const pickupPinCiphertext = encryptPin(
        pickupPin,
        row.orderId,
        "PICKUP",
        this.pinEnv.appEncryptionKey,
      );
      const deliveryPinHash = hashPin(deliveryPin, row.orderId, "DELIVERY", this.pinEnv.pinPepper);
      const deliveryPinCiphertext = encryptPin(
        deliveryPin,
        row.orderId,
        "DELIVERY",
        this.pinEnv.appEncryptionKey,
      );

      await client.query(
        `UPDATE orders
         SET status = 'ACCEPTED',
             "assignedCourierId" = $2,
             "pickupPinHash" = $3,
             "pickupPinCiphertext" = $4,
             "deliveryPinHash" = $5,
             "deliveryPinCiphertext" = $6,
             "acceptedAt" = now(),
             "updatedAt" = now()
         WHERE id = $1`,
        [
          row.orderId,
          courier.courierId,
          pickupPinHash,
          pickupPinCiphertext,
          deliveryPinHash,
          deliveryPinCiphertext,
        ],
      );
      const availabilityUpdate = await client.query(
        `UPDATE courier_availabilities
         SET state = 'ON_SERVICE', "updatedAt" = now()
         WHERE "courierId" = $1 AND state = 'AVAILABLE'`,
        [courier.courierId],
      );
      if (availabilityUpdate.rowCount !== 1) {
        await client.query("ROLLBACK");
        return "conflict";
      }
      await client.query(
        `INSERT INTO order_events (
           id, "orderId", "fromStatus", "toStatus", "actorKind", "actorId", "createdAt"
         ) VALUES (gen_random_uuid(), $1, 'SEEKING_COURIER', 'ACCEPTED', 'COURIER', $2, now())`,
        [row.orderId, userId],
      );
      const diff = redactDiff({ from: "SEEKING_COURIER", to: "ACCEPTED", offerId });
      await client.query(
        `INSERT INTO audit_logs
          (id, "actorId", "actorKind", action, "entityType", "entityId", diff, "createdAt")
         VALUES (gen_random_uuid(), $1, 'COURIER', 'offer.accepted', 'dispatch_offer', $2, $3::jsonb, now())`,
        [userId, offerId, JSON.stringify(diff)],
      );
      await client.query(
        `INSERT INTO idempotency_keys (
           id, "userId", key, "requestHash", "responseStatus", "createdAt", "expiresAt"
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, 201, now(), now() + interval '1 day'
         )`,
        [userId, idempotencyKey, requestHash],
      );
      await client.query("COMMIT");
      return {
        offerId,
        orderId: row.orderId,
        offerStatus: "ACCEPTED",
        orderStatus: "ACCEPTED",
      };
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

  async decline(
    offerId: string,
    userId: string,
  ): Promise<{ offerId: string; status: "DECLINED" } | "missing" | "conflict"> {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ status: string }>(
        `SELECT d.status::text AS status
         FROM dispatch_offers d
         JOIN couriers c ON c.id = d."courierId"
         WHERE d.id = $1 AND c."userId" = $2
         FOR UPDATE OF d`,
        [offerId, userId],
      );
      const row = locked.rows[0];
      if (row === undefined) {
        await client.query("ROLLBACK");
        return "missing";
      }
      if (row.status !== "PENDING") {
        await client.query("ROLLBACK");
        return "conflict";
      }
      await client.query(
        `UPDATE dispatch_offers SET status = 'DECLINED', "respondedAt" = now() WHERE id = $1`,
        [offerId],
      );
      await client.query("COMMIT");
      return { offerId, status: "DECLINED" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listAvailableForUser(userId: string): Promise<AvailableOfferItem[]> {
    const result = await this.database.pool.query<AvailableOfferItem>(
      `SELECT
         d.id AS "offerId",
         o.id AS "orderId",
         o."referenceCode",
         r."tradeName" AS "restaurantName",
         b.name AS "branchName",
         b."addressLine" AS "pickupAddress",
         COALESCE(o."dropoffAddress", '') AS "dropoffAddress",
         o."deliveryFeeCop",
         d."expiresAt"::text AS "expiresAt"
       FROM dispatch_offers d
       JOIN couriers c ON c.id = d."courierId"
       JOIN orders o ON o.id = d."orderId"
       JOIN branches b ON b.id = o."branchId"
       JOIN restaurants r ON r.id = o."restaurantId"
       WHERE c."userId" = $1
         AND d.status = 'PENDING'
         AND d."expiresAt" > now()
         AND o.status = 'PUBLISHED'
       ORDER BY d."createdAt" DESC`,
      [userId],
    );
    return result.rows;
  }
}

function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
