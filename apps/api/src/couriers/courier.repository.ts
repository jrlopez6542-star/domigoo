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

export type CourierProfile = {
  id: string;
  status: string;
  firstName: string;
  lastName: string;
};

@Injectable()
export class CourierRepository {
  constructor(private readonly database: Database) {}

  async findProfileByUserId(userId: string): Promise<CourierProfile | null> {
    const result = await this.database.pool.query<CourierProfile>(
      `SELECT id, status::text AS status, "firstName", "lastName"
       FROM couriers
       WHERE "userId" = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

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
}

function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
