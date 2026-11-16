import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { APP_ENV, type AppEnv } from "../config/env.js";
import { Database } from "../database.js";
import { openPin, showsPickupPin } from "./pin.js";

const METHODS = new Set(["CASH", "NEQUI", "DAVIPLATA", "TRANSFER"]);

export type DraftOrder = {
  id: string;
  status: "DRAFT";
  foodAmountCop: number;
  deliveryFeeCop: number;
  paymentMethod: string;
};

export type RestaurantOrder = {
  id: string;
  status: string;
  foodAmountCop: number;
  deliveryFeeCop: number;
  paymentMethod: string;
  pickupPin?: string;
};

@Injectable()
export class OrderRepository {
  constructor(
    private readonly database: Database,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

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

  async findForMember(id: string, userId: string): Promise<RestaurantOrder | null> {
    const result = await this.database.pool.query<{
      id: string;
      status: string;
      foodAmountCop: number;
      deliveryFeeCop: number;
      paymentMethod: string | null;
      pickupPinCiphertext: string | null;
    }>(
      `SELECT o.id, o.status::text AS status, o."foodAmountCop", o."deliveryFeeCop",
              o."paymentMethod"::text AS "paymentMethod", o."pickupPinCiphertext"
       FROM orders o
       JOIN restaurant_memberships m ON m."restaurantId" = o."restaurantId"
       WHERE o.id = $1 AND m."userId" = $2 AND m.status = 'ACTIVE'`,
      [id, userId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }
    const order: RestaurantOrder = {
      id: row.id,
      status: row.status,
      foodAmountCop: row.foodAmountCop,
      deliveryFeeCop: row.deliveryFeeCop,
      paymentMethod: row.paymentMethod ?? "",
    };
    if (!showsPickupPin(row.status) || row.pickupPinCiphertext === null) {
      return order;
    }
    const pickupPin = openPin(
      this.env.dataEncryptionKey,
      row.id,
      "PICKUP",
      row.pickupPinCiphertext,
    );
    if (pickupPin === null) {
      return order;
    }
    return { ...order, pickupPin };
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
