import { Injectable } from "@nestjs/common";
import { GeoRepository } from "../geo/geo.repository.js";
import { SubscriptionRepository } from "../subscriptions/subscription.repository.js";
import { TariffRepository } from "../tariffs/tariff.repository.js";
import { Database } from "../database.js";
import { redactDiff } from "../audit/redact-diff.js";
import { canTransition } from "./order-machine.js";

export type PublishedOrder = {
  id: string;
  status: "SEEKING_COURIER";
  deliveryFeeCop: number;
  offer: { id: string; status: "PENDING"; wave: 1 };
};

export type OpenWave = {
  id: string;
  status: "SEEKING_COURIER";
  deliveryFeeCop: number;
  offers: { id: string; status: "PENDING"; wave: number }[];
};

@Injectable()
export class PublishRepository {
  constructor(
    private readonly database: Database,
    private readonly tariffs: TariffRepository,
    private readonly geo: GeoRepository,
    private readonly subscriptions: SubscriptionRepository,
  ) {}

  async publishDirect(input: {
    orderId: string;
    userId: string;
    courierId: string;
    customerName: string;
    customerPhone: string;
    dropoffAddress: string;
    longitude: number;
    latitude: number;
    at: Date;
  }): Promise<PublishedOrder | "missing" | "blocked" | "quote" | "ineligible" | "unpriced"> {
    if (!canTransition("DRAFT", "SEEKING_COURIER")) {
      return "missing";
    }
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const order = await client.query<{
        restaurantId: string;
        branchId: string;
        deliveryFeeCop: number;
        paymentMethod: string | null;
        longitude: number;
        latitude: number;
      }>(
        `SELECT o."restaurantId", o."branchId", o."deliveryFeeCop", o."paymentMethod"::text AS "paymentMethod",
                ST_X(b.location::geometry)::float8 AS longitude,
                ST_Y(b.location::geometry)::float8 AS latitude
         FROM orders o
         JOIN branches b ON b.id = o."branchId"
         JOIN restaurant_memberships m ON m."restaurantId" = o."restaurantId"
         WHERE o.id = $1 AND o.status = 'DRAFT' AND m."userId" = $2 AND m.status = 'ACTIVE'
           AND m.role IN ('OWNER', 'MANAGER', 'OPERATOR')
         FOR UPDATE OF o`,
        [input.orderId, input.userId],
      );
      const current = order.rows[0];
      if (current === undefined || current.paymentMethod === null) {
        await client.query("ROLLBACK");
        return "missing";
      }
      const allowed = await this.subscriptions.canDispatch(current.restaurantId, input.at);
      if (!allowed) {
        await client.query("ROLLBACK");
        return "blocked";
      }
      const policy = await client.query<{
        id: string;
        radius: number;
        seeking: number;
        directTtl: number;
      }>(
        `SELECT id, "offerRadiusMeters" AS radius, "seekingTtlSeconds" AS seeking,
                "directOfferTtlSeconds" AS "directTtl"
         FROM operations_policies WHERE status = 'PUBLISHED' LIMIT 1`,
      );
      const published = policy.rows[0];
      if (published === undefined) {
        await client.query("ROLLBACK");
        return "unpriced";
      }
      const quote = await this.tariffs.quote({
        origin: { longitude: current.longitude, latitude: current.latitude },
        destination: { longitude: input.longitude, latitude: input.latitude },
        at: input.at,
      });
      if (quote === null) {
        await client.query("ROLLBACK");
        return "unpriced";
      }
      if (quote.deliveryFeeCop !== current.deliveryFeeCop) {
        await client.query("ROLLBACK");
        return "quote";
      }
      const eligible = await this.geo.isEligible(
        current.branchId,
        input.courierId,
        published.radius,
      );
      if (!eligible) {
        await client.query("ROLLBACK");
        return "ineligible";
      }
      const courier = await client.query<{ userId: string }>(
        `SELECT "userId" FROM couriers WHERE id = $1`,
        [input.courierId],
      );
      const courierUserId = courier.rows[0]?.userId;
      if (courierUserId === undefined) {
        await client.query("ROLLBACK");
        return "ineligible";
      }
      await client.query(
        `UPDATE orders SET
           status = 'SEEKING_COURIER',
           "dispatchMode" = 'DIRECT',
           "customerName" = $2,
           "customerPhoneE164" = $3,
           "dropoffAddress" = $4,
           "dropoffLocation" = ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
           "pickupLocation" = (SELECT location FROM branches WHERE id = orders."branchId"),
           "operationsPolicyId" = $7,
           "seekingExpiresAt" = now() + ($8::int * interval '1 second'),
           "updatedAt" = now()
         WHERE id = $1`,
        [
          input.orderId,
          input.customerName,
          input.customerPhone,
          input.dropoffAddress,
          input.longitude,
          input.latitude,
          published.id,
          published.seeking,
        ],
      );
      await client.query(
        `INSERT INTO tariff_quotes (
           id, "orderId", "tariffVersionId", "zoneCode", "distanceMeters", "deliveryFeeCop", breakdown, "createdAt"
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb, now()
         )`,
        [
          input.orderId,
          quote.versionId,
          quote.zoneCode,
          quote.distanceMeters,
          quote.deliveryFeeCop,
          JSON.stringify({
            distanceMeters: quote.distanceMeters,
            deliveryFeeCop: quote.deliveryFeeCop,
          }),
        ],
      );
      const offer = await client.query<{ id: string }>(
        `INSERT INTO dispatch_offers (
           id, "orderId", "courierId", wave, status, "expiresAt", "createdAt"
         ) VALUES (
           gen_random_uuid(), $1, $2, 1, 'PENDING', now() + ($3::int * interval '1 second'), now()
         ) RETURNING id`,
        [input.orderId, input.courierId, published.directTtl],
      );
      const offerId = offer.rows[0]?.id;
      if (offerId === undefined) {
        throw new Error("No se pudo crear la oferta");
      }
      await client.query(
        `INSERT INTO notification_outbox (
           id, "userId", template, payload, status, "attemptCount", "availableAt", "createdAt"
         ) VALUES (
           gen_random_uuid(), $1, 'direct_offer', $2::jsonb, 'PENDING', 0, now(), now()
         )`,
        [
          courierUserId,
          JSON.stringify({
            offerId,
            orderId: input.orderId,
            deliveryFeeCop: quote.deliveryFeeCop,
          }),
        ],
      );
      await client.query(
        `INSERT INTO order_events (
           id, "orderId", "fromStatus", "toStatus", "actorKind", "actorId", "createdAt"
         ) VALUES (
           gen_random_uuid(), $1, 'DRAFT', 'SEEKING_COURIER', 'RESTAURANT', $2, now()
         )`,
        [input.orderId, input.userId],
      );
      const diff = redactDiff({ from: "DRAFT", to: "SEEKING_COURIER", offerId });
      await client.query(
        `INSERT INTO audit_logs
          (id, "actorId", "actorKind", action, "entityType", "entityId", diff, "createdAt")
         VALUES (gen_random_uuid(), $1, 'RESTAURANT', 'order.published', 'order', $2, $3::jsonb, now())`,
        [input.userId, input.orderId, JSON.stringify(diff)],
      );
      await client.query(
        `INSERT INTO notification_outbox (
           id, "userId", template, payload, status, "attemptCount", "availableAt", "createdAt"
         ) VALUES (
           gen_random_uuid(), $1, 'direct_offer', $2::jsonb, 'PENDING', 0, now(), now()
         )`,
        [courierUserId, JSON.stringify({ offerId, orderId: input.orderId })],
      );
      await client.query("COMMIT");
      return {
        id: input.orderId,
        status: "SEEKING_COURIER",
        deliveryFeeCop: quote.deliveryFeeCop,
        offer: { id: offerId, status: "PENDING", wave: 1 },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async publishOpen(input: {
    orderId: string;
    userId: string;
    customerName: string;
    customerPhone: string;
    dropoffAddress: string;
    longitude: number;
    latitude: number;
    at: Date;
  }): Promise<OpenWave | "missing" | "blocked" | "quote" | "ineligible" | "unpriced"> {
    if (!canTransition("DRAFT", "SEEKING_COURIER")) {
      return "missing";
    }
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const order = await client.query<{
        restaurantId: string;
        branchId: string;
        deliveryFeeCop: number;
        paymentMethod: string | null;
        longitude: number;
        latitude: number;
      }>(
        `SELECT o."restaurantId", o."branchId", o."deliveryFeeCop", o."paymentMethod"::text AS "paymentMethod",
                ST_X(b.location::geometry)::float8 AS longitude,
                ST_Y(b.location::geometry)::float8 AS latitude
         FROM orders o
         JOIN branches b ON b.id = o."branchId"
         JOIN restaurant_memberships m ON m."restaurantId" = o."restaurantId"
         WHERE o.id = $1 AND o.status = 'DRAFT' AND m."userId" = $2 AND m.status = 'ACTIVE'
           AND m.role IN ('OWNER', 'MANAGER', 'OPERATOR')
         FOR UPDATE OF o`,
        [input.orderId, input.userId],
      );
      const current = order.rows[0];
      if (current === undefined || current.paymentMethod === null) {
        await client.query("ROLLBACK");
        return "missing";
      }
      const allowed = await this.subscriptions.canDispatch(current.restaurantId, input.at);
      if (!allowed) {
        await client.query("ROLLBACK");
        return "blocked";
      }
      const policy = await client.query<{
        id: string;
        radius: number;
        seeking: number;
        openTtl: number;
        waveCap: number;
      }>(
        `SELECT id, "offerRadiusMeters" AS radius, "seekingTtlSeconds" AS seeking,
                "openOfferTtlSeconds" AS "openTtl", "maxOffersPerWave" AS "waveCap"
         FROM operations_policies WHERE status = 'PUBLISHED' LIMIT 1`,
      );
      const published = policy.rows[0];
      if (published === undefined || published.waveCap < 1) {
        await client.query("ROLLBACK");
        return "unpriced";
      }
      const quote = await this.tariffs.quote({
        origin: { longitude: current.longitude, latitude: current.latitude },
        destination: { longitude: input.longitude, latitude: input.latitude },
        at: input.at,
      });
      if (quote === null) {
        await client.query("ROLLBACK");
        return "unpriced";
      }
      if (quote.deliveryFeeCop !== current.deliveryFeeCop) {
        await client.query("ROLLBACK");
        return "quote";
      }
      const courierIds = await this.geo.listEligible(
        current.branchId,
        published.radius,
        published.waveCap,
      );
      if (courierIds.length === 0) {
        await client.query("ROLLBACK");
        return "ineligible";
      }
      await client.query(
        `UPDATE orders SET
           status = 'SEEKING_COURIER',
           "dispatchMode" = 'OPEN',
           "customerName" = $2,
           "customerPhoneE164" = $3,
           "dropoffAddress" = $4,
           "dropoffLocation" = ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
           "pickupLocation" = (SELECT location FROM branches WHERE id = orders."branchId"),
           "operationsPolicyId" = $7,
           "seekingExpiresAt" = now() + ($8::int * interval '1 second'),
           "updatedAt" = now()
         WHERE id = $1`,
        [
          input.orderId,
          input.customerName,
          input.customerPhone,
          input.dropoffAddress,
          input.longitude,
          input.latitude,
          published.id,
          published.seeking,
        ],
      );
      await client.query(
        `INSERT INTO tariff_quotes (
           id, "orderId", "tariffVersionId", "zoneCode", "distanceMeters", "deliveryFeeCop", breakdown, "createdAt"
         ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb, now())`,
        [
          input.orderId,
          quote.versionId,
          quote.zoneCode,
          quote.distanceMeters,
          quote.deliveryFeeCop,
          JSON.stringify({
            distanceMeters: quote.distanceMeters,
            deliveryFeeCop: quote.deliveryFeeCop,
          }),
        ],
      );
      const offers: { id: string; status: "PENDING"; wave: number }[] = [];
      for (const courierId of courierIds) {
        const courier = await client.query<{ userId: string }>(
          `SELECT "userId" FROM couriers WHERE id = $1`,
          [courierId],
        );
        const courierUserId = courier.rows[0]?.userId;
        if (courierUserId === undefined) {
          continue;
        }
        const offer = await client.query<{ id: string }>(
          `INSERT INTO dispatch_offers (
             id, "orderId", "courierId", wave, status, "expiresAt", "createdAt"
           ) VALUES (
             gen_random_uuid(), $1, $2, 1, 'PENDING', now() + ($3::int * interval '1 second'), now()
           ) RETURNING id`,
          [input.orderId, courierId, published.openTtl],
        );
        const offerId = offer.rows[0]?.id;
        if (offerId === undefined) {
          throw new Error("No se pudo crear la oferta");
        }
        offers.push({ id: offerId, status: "PENDING", wave: 1 });
        await client.query(
          `INSERT INTO notification_outbox (
             id, "userId", template, payload, status, "attemptCount", "availableAt", "createdAt"
           ) VALUES (
             gen_random_uuid(), $1, 'open_offer', $2::jsonb, 'PENDING', 0, now(), now()
           )`,
          [courierUserId, JSON.stringify({ offerId, orderId: input.orderId, wave: 1 })],
        );
      }
      if (offers.length === 0) {
        await client.query("ROLLBACK");
        return "ineligible";
      }
      await client.query(
        `INSERT INTO order_events (
           id, "orderId", "fromStatus", "toStatus", "actorKind", "actorId", "createdAt"
         ) VALUES (gen_random_uuid(), $1, 'DRAFT', 'SEEKING_COURIER', 'RESTAURANT', $2, now())`,
        [input.orderId, input.userId],
      );
      const diff = redactDiff({ from: "DRAFT", to: "SEEKING_COURIER", offers: offers.length });
      await client.query(
        `INSERT INTO audit_logs
          (id, "actorId", "actorKind", action, "entityType", "entityId", diff, "createdAt")
         VALUES (gen_random_uuid(), $1, 'RESTAURANT', 'order.published', 'order', $2, $3::jsonb, now())`,
        [input.userId, input.orderId, JSON.stringify(diff)],
      );
      await client.query("COMMIT");
      return {
        id: input.orderId,
        status: "SEEKING_COURIER",
        deliveryFeeCop: quote.deliveryFeeCop,
        offers,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
