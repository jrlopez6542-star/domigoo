import { Injectable } from "@nestjs/common";
import { Database } from "../database.js";
import { createSessionToken, hashSessionToken } from "../identity/session-token.js";

export type CourierDraft = {
  userId: string;
  documentType: "CC" | "CE";
  documentNumber: string;
  firstName: string;
  lastName: string;
};

export type RegisteredCourier = {
  id: string;
  status: string;
};

@Injectable()
export class CourierRepository {
  constructor(private readonly database: Database) {}

  async registerOpen(input: CourierDraft): Promise<RegisteredCourier | "conflict"> {
    try {
      const result = await this.database.pool.query<RegisteredCourier>(
        `INSERT INTO couriers (
           id, "userId", "documentType", "documentNumber", "firstName", "lastName",
           status, "registrationSource", "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), $1, $2::"IdentityDocumentType", $3, $4, $5,
           'REGISTERING', 'OPEN', now(), now()
         )
         RETURNING id, status::text AS status`,
        [input.userId, input.documentType, input.documentNumber, input.firstName, input.lastName],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error("No se pudo registrar el domiciliario");
      }
      return row;
    } catch (error) {
      if (pgCode(error) === "23505") {
        return "conflict";
      }
      throw error;
    }
  }

  async canInvite(userId: string, restaurantId: string | null): Promise<boolean> {
    const admin = await this.database.pool.query(
      `SELECT 1 FROM admin_profiles WHERE "userId" = $1`,
      [userId],
    );
    if (restaurantId === null) {
      return (admin.rowCount ?? 0) > 0;
    }
    if ((admin.rowCount ?? 0) > 0) {
      return true;
    }
    const member = await this.database.pool.query(
      `SELECT 1 FROM restaurant_memberships
       WHERE "restaurantId" = $1 AND "userId" = $2 AND status = 'ACTIVE'`,
      [restaurantId, userId],
    );
    return (member.rowCount ?? 0) > 0;
  }

  async createInvitation(input: {
    createdById: string;
    restaurantId: string | null;
  }): Promise<{ id: string; token: string; expiresAt: string } | null> {
    const token = createSessionToken();
    try {
      const result = await this.database.pool.query<{ id: string; expiresAt: Date }>(
        `INSERT INTO courier_invitations (
           id, "restaurantId", "createdById", "tokenHash", status, "expiresAt", "createdAt"
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, 'PENDING', now() + interval '7 days', now()
         )
         RETURNING id, "expiresAt"`,
        [input.restaurantId, input.createdById, token.hash],
      );
      const row = result.rows[0];
      if (row === undefined) {
        return null;
      }
      return { id: row.id, token: token.raw, expiresAt: new Date(row.expiresAt).toISOString() };
    } catch (error) {
      if (pgCode(error) === "23503") {
        return null;
      }
      throw error;
    }
  }

  async acceptInvitation(
    rawToken: string,
    input: CourierDraft,
  ): Promise<RegisteredCourier | "missing" | "conflict"> {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{ id: string; status: string; expiresAt: Date | string }>(
        `SELECT id, status::text AS status, "expiresAt"
         FROM courier_invitations
         WHERE "tokenHash" = $1
         FOR UPDATE`,
        [hashSessionToken(rawToken)],
      );
      const invitation = found.rows[0];
      if (invitation === undefined) {
        await client.query("ROLLBACK");
        return "missing";
      }
      const expiresAt = new Date(invitation.expiresAt);
      if (invitation.status !== "PENDING" || expiresAt.getTime() <= Date.now()) {
        if (invitation.status === "PENDING") {
          await client.query(`UPDATE courier_invitations SET status = 'EXPIRED' WHERE id = $1`, [
            invitation.id,
          ]);
          await client.query("COMMIT");
        } else {
          await client.query("ROLLBACK");
        }
        return "missing";
      }
      const created = await client.query<RegisteredCourier>(
        `INSERT INTO couriers (
           id, "userId", "documentType", "documentNumber", "firstName", "lastName",
           status, "registrationSource", "invitationId", "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), $1, $2::"IdentityDocumentType", $3, $4, $5,
           'REGISTERING', 'INVITATION', $6, now(), now()
         )
         RETURNING id, status::text AS status`,
        [
          input.userId,
          input.documentType,
          input.documentNumber,
          input.firstName,
          input.lastName,
          invitation.id,
        ],
      );
      const row = created.rows[0];
      if (row === undefined) {
        throw new Error("No se pudo aceptar la invitación");
      }
      await client.query(
        `UPDATE courier_invitations SET status = 'CONSUMED', "consumedAt" = now() WHERE id = $1`,
        [invitation.id],
      );
      await client.query("COMMIT");
      return row;
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

  async getEarningsForUser(userId: string): Promise<{
    deliveredCount: number;
    totalDeliveryFeeCop: number;
    note: string;
    recentDeliveries: Array<{
      id: string;
      referenceCode: string;
      restaurantName: string;
      deliveryFeeCop: number;
      deliveredAt: string | null;
    }>;
  } | null> {
    const courierRow = await this.database.pool.query<{ id: string }>(
      `SELECT id FROM couriers WHERE "userId" = $1 LIMIT 1`,
      [userId],
    );
    const courier = courierRow.rows[0];
    if (courier === undefined) {
      return null;
    }
    const agg = await this.database.pool.query<{
      deliveredCount: number;
      totalDeliveryFeeCop: number;
    }>(
      `SELECT COUNT(*)::int AS "deliveredCount",
              COALESCE(SUM("deliveryFeeCop"), 0)::int AS "totalDeliveryFeeCop"
       FROM orders
       WHERE "assignedCourierId" = $1 AND status = 'DELIVERED'`,
      [courier.id],
    );
    const recent = await this.database.pool.query<{
      id: string;
      referenceCode: string;
      restaurantName: string;
      deliveryFeeCop: number;
      deliveredAt: Date | string | null;
    }>(
      `SELECT o.id, o."referenceCode", r."tradeName" AS "restaurantName",
              o."deliveryFeeCop", o."deliveredAt"
       FROM orders o
       JOIN restaurants r ON r.id = o."restaurantId"
       WHERE o."assignedCourierId" = $1 AND o.status = 'DELIVERED'
       ORDER BY o."deliveredAt" DESC NULLS LAST, o."createdAt" DESC
       LIMIT 20`,
      [courier.id],
    );
    return {
      deliveredCount: agg.rows[0]?.deliveredCount ?? 0,
      totalDeliveryFeeCop: agg.rows[0]?.totalDeliveryFeeCop ?? 0,
      note: "Pago directo del cliente, DOMIGOO no recauda",
      recentDeliveries: recent.rows.map((r) => ({
        id: r.id,
        referenceCode: r.referenceCode,
        restaurantName: r.restaurantName,
        deliveryFeeCop: r.deliveryFeeCop,
        deliveredAt:
          r.deliveredAt === null
            ? null
            : r.deliveredAt instanceof Date
              ? r.deliveredAt.toISOString()
              : r.deliveredAt,
      })),
    };
  }
}

function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
