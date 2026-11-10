import { Injectable } from "@nestjs/common";
import { Database } from "../database.js";

export type SavedVehicle = {
  id: string;
  type: string;
  plate: string;
  status: string;
};

export type SavedDocument = {
  id: string;
  sha256: string;
  mimeType: string;
  byteSize: number;
  type: string;
  status: string;
};

export type OwnedDocument = {
  storageKey: string;
  mimeType: string;
  sha256: string;
};

@Injectable()
export class CourierFilesRepository {
  constructor(private readonly database: Database) {}

  async findCourierId(userId: string): Promise<string | null> {
    const result = await this.database.pool.query<{ id: string }>(
      `SELECT id FROM couriers WHERE "userId" = $1`,
      [userId],
    );
    return result.rows[0]?.id ?? null;
  }

  async saveVehicle(input: {
    courierId: string;
    plate: string;
    soatExpiresOn: string;
    techExpiresOn: string;
  }): Promise<SavedVehicle | "conflict"> {
    const taken = await this.database.pool.query(
      `SELECT 1 FROM vehicles
       WHERE plate = $1 AND status = 'ACTIVE' AND "courierId" <> $2`,
      [input.plate, input.courierId],
    );
    if ((taken.rowCount ?? 0) > 0) {
      return "conflict";
    }
    try {
      const result = await this.database.pool.query<SavedVehicle>(
        `INSERT INTO vehicles (
           id, "courierId", type, plate, "soatExpiresOn", "techExpiresOn", status, "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), $1, 'MOTORCYCLE', $2, $3::date, $4::date, 'ACTIVE', now(), now()
         )
         ON CONFLICT ("courierId") DO UPDATE SET
           plate = EXCLUDED.plate,
           "soatExpiresOn" = EXCLUDED."soatExpiresOn",
           "techExpiresOn" = EXCLUDED."techExpiresOn",
           type = 'MOTORCYCLE',
           status = 'ACTIVE',
           "updatedAt" = now()
         RETURNING id, type::text AS type, plate, status::text AS status`,
        [input.courierId, input.plate, input.soatExpiresOn, input.techExpiresOn],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error("No se pudo guardar el vehículo");
      }
      return row;
    } catch (error) {
      if (pgCode(error) === "23505") {
        return "conflict";
      }
      throw error;
    }
  }

  async addDocument(input: {
    courierId: string;
    type: string;
    storageKey: string;
    sha256: string;
    mimeType: string;
    byteSize: number;
    declaredExpiresOn: string | null;
  }): Promise<SavedDocument> {
    const result = await this.database.pool.query<SavedDocument>(
      `INSERT INTO courier_documents (
         id, "courierId", type, "storageKey", sha256, "mimeType", "byteSize",
         "declaredExpiresOn", status, "createdAt", "updatedAt"
       ) VALUES (
         gen_random_uuid(), $1, $2::"CourierDocumentType", $3, $4, $5, $6,
         $7::date, 'UPLOADED', now(), now()
       )
       RETURNING id, sha256, "mimeType", "byteSize", type::text AS type, status::text AS status`,
      [
        input.courierId,
        input.type,
        input.storageKey,
        input.sha256,
        input.mimeType,
        input.byteSize,
        input.declaredExpiresOn,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("No se pudo guardar el documento");
    }
    return row;
  }

  async findOwnedDocument(id: string, userId: string): Promise<OwnedDocument | null> {
    const result = await this.database.pool.query<OwnedDocument>(
      `SELECT d."storageKey", d."mimeType", d.sha256
       FROM courier_documents d
       JOIN couriers c ON c.id = d."courierId"
       WHERE d.id = $1 AND c."userId" = $2`,
      [id, userId],
    );
    return result.rows[0] ?? null;
  }
}

function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
