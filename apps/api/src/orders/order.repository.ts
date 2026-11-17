import { randomBytes } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { APP_ENV, defaultPinEnv, type AppEnv } from "../config/env.js";
import { Database } from "../database.js";
import { decryptPin } from "./pin-crypto.js";

const METHODS = new Set(["CASH", "NEQUI", "DAVIPLATA", "TRANSFER"]);
const RESTAURANT_PICKUP_PIN_STATUSES = new Set(["ACCEPTED", "ARRIVING_PICKUP", "AT_PICKUP"]);

export type DraftOrder = {
  id: string;
  status: "DRAFT";
  foodAmountCop: number;
  deliveryFeeCop: number;
  paymentMethod: string;
};

const TERMINAL_STATUSES = new Set([
  "DELIVERED",
  "EXPIRED",
  "CANCELLED_RESTAURANT",
  "CANCELLED_COURIER",
  "CANCELLED_ADMIN",
  "FAILED",
]);

export type OrderEventItem = {
  id: string;
  fromStatus: string;
  toStatus: string;
  actorKind: string;
  createdAt: string;
};

export type RestaurantOrderView = {
  id: string;
  referenceCode: string;
  status: string;
  foodAmountCop: number;
  deliveryFeeCop: number;
  paymentMethod: string | null;
  customerName: string | null;
  customerPhone: string | null;
  dropoffAddress: string | null;
  pickupPin?: string;
  events: OrderEventItem[];
};

export type CourierOrderView = {
  id: string;
  referenceCode: string;
  status: string;
  deliveryFeeCop: number;
  paymentMethod: string | null;
  customerName: string | null;
  customerPhone?: string;
  dropoffAddress: string | null;
  events: OrderEventItem[];
};

export type MyOrderSummary = {
  id: string;
  referenceCode: string;
  status: string;
  branchName: string;
  foodAmountCop: number;
  deliveryFeeCop: number;
  paymentMethod: string | null;
  customerName: string | null;
  dropoffAddress: string | null;
  pickupPin?: string;
  createdAt: string;
};

export type OrderViewResult =
  | { kind: "ok"; order: RestaurantOrderView | CourierOrderView }
  | { kind: "forbidden" }
  | { kind: "missing" };

@Injectable()
export class OrderRepository {
  private readonly pinEnv: Pick<AppEnv, "pinPepper" | "appEncryptionKey">;

  constructor(
    private readonly database: Database,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.pinEnv = env ?? defaultPinEnv();
  }

  async createDraft(input: {
    userId: string;
    branchId: string;
    foodAmountCop: number;
    deliveryFeeCop: number;
    paymentMethod: string;
  }): Promise<DraftOrder | "missing" | "invalid"> {
    if (!METHODS.has(input.paymentMethod) || input.foodAmountCop < 0 || input.deliveryFeeCop < 0) {
      return "invalid";
    }
    const branch = await this.database.pool.query<{ restaurantId: string }>(
      `SELECT e."restaurantId"
       FROM branches b
       JOIN establishments e ON e.id = b."establishmentId"
       JOIN restaurant_memberships m ON m."restaurantId" = e."restaurantId"
       WHERE b.id = $1 AND m."userId" = $2 AND m.status = 'ACTIVE'
         AND m.role IN ('OWNER', 'MANAGER', 'OPERATOR')`,
      [input.branchId, input.userId],
    );
    const restaurantId = branch.rows[0]?.restaurantId;
    if (restaurantId === undefined) {
      return "missing";
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const created = await this.database.pool.query<DraftOrder>(
          `INSERT INTO orders (
             id, "referenceCode", "restaurantId", "branchId", "createdById", status,
             "foodAmountCop", "deliveryFeeCop", "paymentMethod", "createdAt", "updatedAt"
           ) VALUES (
             gen_random_uuid(), $1, $2, $3, $4, 'DRAFT', $5, $6, $7::"PaymentMethod", now(), now()
           )
           RETURNING id, status::text AS status, "foodAmountCop", "deliveryFeeCop", "paymentMethod"::text AS "paymentMethod"`,
          [
            referenceCode(),
            restaurantId,
            input.branchId,
            input.userId,
            input.foodAmountCop,
            input.deliveryFeeCop,
            input.paymentMethod,
          ],
        );
        const row = created.rows[0];
        if (row === undefined) {
          throw new Error("No se pudo crear el borrador");
        }
        return { ...row, status: "DRAFT" };
      } catch (error) {
        if (pgCode(error) !== "23505") {
          throw error;
        }
      }
    }
    throw new Error("No se pudo asignar un código de pedido");
  }

  async findForMember(id: string, userId: string): Promise<DraftOrder | null> {
    const result = await this.database.pool.query<DraftOrder>(
      `SELECT o.id, o.status::text AS status, o."foodAmountCop", o."deliveryFeeCop",
              o."paymentMethod"::text AS "paymentMethod"
       FROM orders o
       JOIN restaurant_memberships m ON m."restaurantId" = o."restaurantId"
       WHERE o.id = $1 AND m."userId" = $2 AND m.status = 'ACTIVE'`,
      [id, userId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }
    return { ...row, status: "DRAFT" };
  }

  async findOrderView(id: string, userId: string): Promise<OrderViewResult> {
    const orderResult = await this.database.pool.query<{
      id: string;
      referenceCode: string;
      restaurantId: string;
      status: string;
      foodAmountCop: number;
      deliveryFeeCop: number;
      paymentMethod: string | null;
      assignedCourierId: string | null;
      customerName: string | null;
      customerPhoneE164: string | null;
      dropoffAddress: string | null;
      pickupPinCiphertext: string | null;
    }>(
      `SELECT id, "referenceCode", "restaurantId", status::text AS status,
              "foodAmountCop", "deliveryFeeCop", "paymentMethod"::text AS "paymentMethod",
              "assignedCourierId", "customerName", "customerPhoneE164", "dropoffAddress",
              "pickupPinCiphertext"
       FROM orders
       WHERE id = $1`,
      [id],
    );
    const order = orderResult.rows[0];
    if (order === undefined) {
      return { kind: "missing" };
    }

    const memberResult = await this.database.pool.query<{ id: string }>(
      `SELECT id FROM restaurant_memberships
       WHERE "restaurantId" = $1 AND "userId" = $2 AND status = 'ACTIVE'`,
      [order.restaurantId, userId],
    );
    const isRestaurantMember = memberResult.rows[0] !== undefined;

    if (isRestaurantMember) {
      const events = await this.listEvents(id);
      const pickupPin =
        RESTAURANT_PICKUP_PIN_STATUSES.has(order.status) && order.pickupPinCiphertext !== null
          ? decryptPin(order.pickupPinCiphertext, order.id, "PICKUP", this.pinEnv.appEncryptionKey)
          : undefined;
      return {
        kind: "ok",
        order: {
          id: order.id,
          referenceCode: order.referenceCode,
          status: order.status,
          foodAmountCop: order.foodAmountCop,
          deliveryFeeCop: order.deliveryFeeCop,
          paymentMethod: order.paymentMethod,
          customerName: order.customerName,
          customerPhone: order.customerPhoneE164,
          dropoffAddress: order.dropoffAddress,
          ...(pickupPin !== undefined ? { pickupPin } : {}),
          events,
        },
      };
    }

    const courierResult = await this.database.pool.query<{ id: string }>(
      `SELECT id FROM couriers WHERE "userId" = $1`,
      [userId],
    );
    const courier = courierResult.rows[0];
    if (courier !== undefined) {
      if (order.assignedCourierId !== courier.id) {
        return { kind: "forbidden" };
      }
      const events = await this.listEvents(id);
      const isNonTerminal =
        !TERMINAL_STATUSES.has(order.status) &&
        order.status !== "DRAFT" &&
        order.status !== "SEEKING_COURIER";
      const courierView: CourierOrderView = {
        id: order.id,
        referenceCode: order.referenceCode,
        status: order.status,
        deliveryFeeCop: order.deliveryFeeCop,
        paymentMethod: order.paymentMethod,
        customerName: order.customerName,
        ...(isNonTerminal && order.customerPhoneE164 !== null
          ? { customerPhone: order.customerPhoneE164 }
          : {}),
        dropoffAddress: order.dropoffAddress,
        events,
      };
      return { kind: "ok", order: courierView };
    }

    return { kind: "missing" };
  }

  async listEvents(orderId: string): Promise<OrderEventItem[]> {
    const result = await this.database.pool.query<{
      id: string;
      fromStatus: string;
      toStatus: string;
      actorKind: string;
      createdAt: Date | string;
    }>(
      `SELECT id, "fromStatus"::text AS "fromStatus", "toStatus"::text AS "toStatus",
              "actorKind"::text AS "actorKind", "createdAt"
       FROM order_events
       WHERE "orderId" = $1
       ORDER BY "createdAt" ASC, id ASC`,
      [orderId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      actorKind: row.actorKind,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    }));
  }

  async listMine(
    userId: string,
  ): Promise<{ role: "RESTAURANT" | "COURIER"; orders: MyOrderSummary[] } | "forbidden"> {
    const memberCheck = await this.database.pool.query<{ id: string }>(
      `SELECT id FROM restaurant_memberships WHERE "userId" = $1 AND status = 'ACTIVE' LIMIT 1`,
      [userId],
    );
    if (memberCheck.rows.length > 0) {
      const result = await this.database.pool.query<{
        id: string;
        referenceCode: string;
        status: string;
        branchName: string;
        foodAmountCop: number;
        deliveryFeeCop: number;
        paymentMethod: string | null;
        customerName: string | null;
        dropoffAddress: string | null;
        pickupPinCiphertext: string | null;
        createdAt: Date | string;
      }>(
        `SELECT DISTINCT ON (o."createdAt", o.id)
           o.id,
           o."referenceCode",
           o.status::text AS status,
           b.name AS "branchName",
           o."foodAmountCop",
           o."deliveryFeeCop",
           o."paymentMethod"::text AS "paymentMethod",
           o."customerName",
           o."dropoffAddress",
           o."pickupPinCiphertext",
           o."createdAt"
         FROM orders o
         JOIN branches b ON b.id = o."branchId"
         JOIN restaurant_memberships m ON m."restaurantId" = o."restaurantId"
         WHERE m."userId" = $1 AND m.status = 'ACTIVE'
         ORDER BY o."createdAt" DESC, o.id DESC
         LIMIT 30`,
        [userId],
      );
      return {
        role: "RESTAURANT",
        orders: result.rows.map((row) => {
          const pickupPin =
            RESTAURANT_PICKUP_PIN_STATUSES.has(row.status) && row.pickupPinCiphertext !== null
              ? decryptPin(row.pickupPinCiphertext, row.id, "PICKUP", this.pinEnv.appEncryptionKey)
              : undefined;
          return {
            id: row.id,
            referenceCode: row.referenceCode,
            status: row.status,
            branchName: row.branchName,
            foodAmountCop: row.foodAmountCop,
            deliveryFeeCop: row.deliveryFeeCop,
            paymentMethod: row.paymentMethod,
            customerName: row.customerName,
            dropoffAddress: row.dropoffAddress,
            ...(pickupPin !== undefined ? { pickupPin } : {}),
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
          };
        }),
      };
    }

    const courierCheck = await this.database.pool.query<{ id: string }>(
      `SELECT id FROM couriers WHERE "userId" = $1 LIMIT 1`,
      [userId],
    );
    const courierId = courierCheck.rows[0]?.id;
    if (courierId !== undefined) {
      const result = await this.database.pool.query<{
        id: string;
        referenceCode: string;
        status: string;
        branchName: string;
        foodAmountCop: number;
        deliveryFeeCop: number;
        paymentMethod: string | null;
        customerName: string | null;
        dropoffAddress: string | null;
        createdAt: Date | string;
      }>(
        `SELECT
           o.id,
           o."referenceCode",
           o.status::text AS status,
           b.name AS "branchName",
           o."foodAmountCop",
           o."deliveryFeeCop",
           o."paymentMethod"::text AS "paymentMethod",
           o."customerName",
           o."dropoffAddress",
           o."createdAt"
         FROM orders o
         JOIN branches b ON b.id = o."branchId"
         WHERE o."assignedCourierId" = $1
         ORDER BY o."createdAt" DESC, o.id DESC
         LIMIT 20`,
        [courierId],
      );
      return {
        role: "COURIER",
        orders: result.rows.map((row) => ({
          id: row.id,
          referenceCode: row.referenceCode,
          status: row.status,
          branchName: row.branchName,
          foodAmountCop: row.foodAmountCop,
          deliveryFeeCop: row.deliveryFeeCop,
          paymentMethod: row.paymentMethod,
          customerName: row.customerName,
          dropoffAddress: row.dropoffAddress,
          createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        })),
      };
    }

    return "forbidden";
  }
}

function referenceCode(): string {
  return randomBytes(9)
    .toString("base64url")
    .replaceAll(/[^A-Za-z0-9]/g, "X")
    .slice(0, 12)
    .toUpperCase();
}

function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
