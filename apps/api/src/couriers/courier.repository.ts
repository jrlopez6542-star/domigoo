import { Injectable } from "@nestjs/common";
import { Database } from "../database.js";

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
}

function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
