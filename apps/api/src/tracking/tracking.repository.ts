import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { APP_ENV, defaultPinEnv, type AppEnv } from "../config/env.js";
import { Database } from "../database.js";
import { decryptPin } from "../orders/pin-crypto.js";

const DELIVERY_PIN_TRACKING_STATUSES = new Set(["PICKED_UP", "AT_DROPOFF"]);

export type TrackingLinkIssued = {
  orderId: string;
  token: string;
  path: string;
  expiresAt: string;
};

export type PublicTrackingEvent = {
  fromStatus: string | null;
  toStatus: string;
  createdAt: string;
};

export type PublicTrackingView = {
  referenceCode: string;
  status: string;
  restaurantName: string;
  courierFirstName: string | null;
  deliveryPin?: string;
  events: PublicTrackingEvent[];
};

@Injectable()
export class TrackingRepository {
  private readonly pinEnv: Pick<AppEnv, "pinPepper" | "appEncryptionKey">;

  constructor(
    private readonly database: Database,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.pinEnv = env ?? defaultPinEnv();
  }

  async issueOrGetLink(orderId: string, userId: string): Promise<TrackingLinkIssued | "missing"> {
    const orderQuery = await this.database.pool.query<{
      id: string;
      operationsPolicyId: string | null;
    }>(
      `SELECT o.id, o."operationsPolicyId"
       FROM orders o
       JOIN restaurant_memberships m ON m."restaurantId" = o."restaurantId"
       WHERE o.id = $1 AND m."userId" = $2 AND m.status = 'ACTIVE'
         AND m.role IN ('OWNER', 'MANAGER', 'OPERATOR')`,
      [orderId, userId],
    );
    const order = orderQuery.rows[0];
    if (order === undefined) {
      return "missing";
    }

    const existing = await this.database.pool.query<{
      tokenCiphertext: string;
      expiresAt: Date | string;
    }>(
      `SELECT "tokenCiphertext", "expiresAt"
       FROM tracking_links
       WHERE "orderId" = $1 AND "revokedAt" IS NULL AND "expiresAt" > now()
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [orderId],
    );
    const active = existing.rows[0];
    if (active !== undefined) {
      const token = decryptTrackingToken(
        active.tokenCiphertext,
        orderId,
        this.pinEnv.appEncryptionKey,
      );
      return {
        orderId,
        token,
        path: `/v1/tracking/${token}`,
        expiresAt:
          active.expiresAt instanceof Date ? active.expiresAt.toISOString() : active.expiresAt,
      };
    }

    let hours = 24;
    if (order.operationsPolicyId !== null) {
      const pol = await this.database.pool.query<{ trackingHoursAfterTerminal: number }>(
        `SELECT "trackingHoursAfterTerminal" FROM operations_policies WHERE id = $1`,
        [order.operationsPolicyId],
      );
      const val = pol.rows[0]?.trackingHoursAfterTerminal;
      if (val !== undefined && val > 0) {
        hours = val;
      }
    }

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = hashTrackingToken(rawToken);
    const tokenCiphertext = encryptTrackingToken(rawToken, orderId, this.pinEnv.appEncryptionKey);
    const expiresAt = new Date(Date.now() + hours * 3600 * 1000);

    await this.database.pool.query(
      `INSERT INTO tracking_links (
         id, "orderId", "tokenHash", "tokenCiphertext", "expiresAt", "createdAt"
       ) VALUES (gen_random_uuid(), $1, $2, $3, $4, now())
       ON CONFLICT ("orderId") DO UPDATE SET
         "tokenHash" = EXCLUDED."tokenHash",
         "tokenCiphertext" = EXCLUDED."tokenCiphertext",
         "expiresAt" = EXCLUDED."expiresAt",
         "revokedAt" = NULL,
         "createdAt" = now()`,
      [orderId, tokenHash, tokenCiphertext, expiresAt],
    );

    return {
      orderId,
      token: rawToken,
      path: `/v1/tracking/${rawToken}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async revokeLinks(orderId: string, userId: string): Promise<"ok" | "missing"> {
    const orderQuery = await this.database.pool.query<{ id: string }>(
      `SELECT o.id
       FROM orders o
       JOIN restaurant_memberships m ON m."restaurantId" = o."restaurantId"
       WHERE o.id = $1 AND m."userId" = $2 AND m.status = 'ACTIVE'
         AND m.role IN ('OWNER', 'MANAGER', 'OPERATOR')`,
      [orderId, userId],
    );
    if (orderQuery.rows[0] === undefined) {
      return "missing";
    }
    await this.database.pool.query(
      `UPDATE tracking_links
       SET "revokedAt" = now()
       WHERE "orderId" = $1 AND "revokedAt" IS NULL`,
      [orderId],
    );
    return "ok";
  }

  async resolvePublic(
    rawToken: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<PublicTrackingView | "missing"> {
    if (rawToken.trim() === "") {
      return "missing";
    }
    const tokenHash = hashTrackingToken(rawToken);
    const linkQuery = await this.database.pool.query<{
      id: string;
      orderId: string;
      expiresAt: Date | string;
      revokedAt: Date | string | null;
    }>(
      `SELECT id, "orderId", "expiresAt", "revokedAt"
       FROM tracking_links
       WHERE "tokenHash" = $1`,
      [tokenHash],
    );
    const link = linkQuery.rows[0];
    if (link === undefined || link.revokedAt !== null) {
      return "missing";
    }
    if (new Date(link.expiresAt).getTime() <= Date.now()) {
      return "missing";
    }

    await this.database.pool.query(
      `INSERT INTO tracking_accesses (id, "trackingLinkId", ip, "userAgent", "accessedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, now())`,
      [link.id, meta.ip?.slice(0, 45) ?? null, meta.userAgent?.slice(0, 255) ?? null],
    );

    const orderQuery = await this.database.pool.query<{
      id: string;
      referenceCode: string;
      status: string;
      restaurantName: string;
      courierFirstName: string | null;
      deliveryPinCiphertext: string | null;
    }>(
      `SELECT o.id, o."referenceCode", o.status::text AS status,
              r."tradeName" AS "restaurantName",
              c."firstName" AS "courierFirstName",
              o."deliveryPinCiphertext"
       FROM orders o
       JOIN restaurants r ON r.id = o."restaurantId"
       LEFT JOIN couriers c ON c.id = o."assignedCourierId"
       WHERE o.id = $1`,
      [link.orderId],
    );
    const order = orderQuery.rows[0];
    if (order === undefined) {
      return "missing";
    }

    const eventsQuery = await this.database.pool.query<{
      fromStatus: string | null;
      toStatus: string;
      createdAt: Date | string;
    }>(
      `SELECT "fromStatus"::text AS "fromStatus", "toStatus"::text AS "toStatus", "createdAt"
       FROM order_events
       WHERE "orderId" = $1
       ORDER BY "createdAt" ASC, id ASC`,
      [order.id],
    );

    const deliveryPin =
      DELIVERY_PIN_TRACKING_STATUSES.has(order.status) && order.deliveryPinCiphertext !== null
        ? decryptPin(
            order.deliveryPinCiphertext,
            order.id,
            "DELIVERY",
            this.pinEnv.appEncryptionKey,
          )
        : undefined;

    return {
      referenceCode: order.referenceCode,
      status: order.status,
      restaurantName: order.restaurantName,
      courierFirstName: order.courierFirstName,
      ...(deliveryPin !== undefined ? { deliveryPin } : {}),
      events: eventsQuery.rows.map((ev) => ({
        fromStatus: ev.fromStatus,
        toStatus: ev.toStatus,
        createdAt: ev.createdAt instanceof Date ? ev.createdAt.toISOString() : ev.createdAt,
      })),
    };
  }
}

export function hashTrackingToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function encryptTrackingToken(rawToken: string, orderId: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${orderId}:tracking`, "utf8"));
  const encrypted = Buffer.concat([cipher.update(rawToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptTrackingToken(ciphertext: string, orderId: string, key: Buffer): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Formato de token de tracking cifrado inválido");
  }
  const iv = Buffer.from(parts[1] ?? "", "hex");
  const tag = Buffer.from(parts[2] ?? "", "hex");
  const data = Buffer.from(parts[3] ?? "", "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(`${orderId}:tracking`, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
