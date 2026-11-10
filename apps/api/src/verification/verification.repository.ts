import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { Database } from "../database.js";
import {
  decideCase,
  evaluateRules,
  todayInBogota,
  type RuleCheck,
  type RuleDocument,
  type RuleVehicle,
} from "./rules.js";

export type VerificationResult = {
  id: string;
  status: "NEEDS_CHANGES" | "PENDING_HUMAN";
  courierStatus: "NEEDS_CHANGES" | "PENDING_VERIFICATION";
};

@Injectable()
export class VerificationRepository {
  constructor(private readonly database: Database) {}

  async submit(userId: string, at: Date): Promise<VerificationResult | null> {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const courier = await client.query<{
        id: string;
        documentType: string;
        documentNumber: string;
      }>(
        `SELECT id, "documentType"::text AS "documentType", "documentNumber"
         FROM couriers WHERE "userId" = $1 FOR UPDATE`,
        [userId],
      );
      const owner = courier.rows[0];
      if (owner === undefined) {
        await client.query("ROLLBACK");
        return null;
      }
      const documents = await client.query<RuleDocument>(
        `SELECT type::text AS type, "mimeType", "byteSize", status::text AS status
         FROM courier_documents
         WHERE "courierId" = $1 AND status IN ('UPLOADED', 'ACCEPTED')`,
        [owner.id],
      );
      const vehicles = await client.query<RuleVehicle>(
        `SELECT type::text AS type, plate, status::text AS status,
                to_char("soatExpiresOn", 'YYYY-MM-DD') AS "soatExpiresOn",
                to_char("techExpiresOn", 'YYYY-MM-DD') AS "techExpiresOn"
         FROM vehicles WHERE "courierId" = $1`,
        [owner.id],
      );
      const vehicle = vehicles.rows[0] ?? null;
      const otherPlate =
        vehicle === null
          ? { rowCount: 0 }
          : await client.query(
              `SELECT 1 FROM vehicles
               WHERE plate = $1 AND status = 'ACTIVE' AND "courierId" <> $2`,
              [vehicle.plate, owner.id],
            );
      const otherIdentity = await client.query(
        `SELECT 1 FROM couriers
         WHERE "documentType" = $1::"IdentityDocumentType" AND "documentNumber" = $2 AND id <> $3`,
        [owner.documentType, owner.documentNumber, owner.id],
      );
      const checks = evaluateRules({
        documents: documents.rows,
        vehicle,
        otherActivePlate: (otherPlate.rowCount ?? 0) > 0,
        otherIdentity: (otherIdentity.rowCount ?? 0) > 0,
        today: todayInBogota(at),
      });
      const status = decideCase(checks);
      const courierStatus = status === "PENDING_HUMAN" ? "PENDING_VERIFICATION" : "NEEDS_CHANGES";
      const created = await client.query<{ id: string }>(
        `INSERT INTO verification_cases (
           id, "courierId", status, "submittedAt", "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), $1, $2::"VerificationStatus", now(), now(), now()
         ) RETURNING id`,
        [owner.id, status],
      );
      const caseId = created.rows[0]?.id;
      if (caseId === undefined) {
        throw new Error("No se pudo abrir el caso");
      }
      for (const item of checks) {
        await insertCheck(client, caseId, item);
      }
      await client.query(
        `UPDATE couriers SET status = $2::"CourierStatus", "updatedAt" = now() WHERE id = $1`,
        [owner.id, courierStatus],
      );
      await client.query("COMMIT");
      return { id: caseId, status, courierStatus };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function insertCheck(client: PoolClient, caseId: string, item: RuleCheck): Promise<void> {
  await client.query(
    `INSERT INTO verification_checks (id, "caseId", code, outcome, detail, "createdAt")
     VALUES (gen_random_uuid(), $1, $2, $3::"CheckOutcome", $4::jsonb, now())`,
    [caseId, item.code, item.outcome, JSON.stringify(item.detail)],
  );
}
