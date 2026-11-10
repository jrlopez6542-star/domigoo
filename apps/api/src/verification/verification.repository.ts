import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { redactDiff } from "../audit/redact-diff.js";
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

  async platformRole(userId: string): Promise<string | null> {
    const result = await this.database.pool.query<{ role: string }>(
      `SELECT role::text AS role FROM admin_profiles WHERE "userId" = $1`,
      [userId],
    );
    return result.rows[0]?.role ?? null;
  }

  async listPending(): Promise<{ id: string; courierId: string; status: "PENDING_HUMAN" }[]> {
    const result = await this.database.pool.query<{ id: string; courierId: string }>(
      `SELECT id, "courierId"
       FROM verification_cases
       WHERE status = 'PENDING_HUMAN'
       ORDER BY "submittedAt" ASC NULLS LAST`,
    );
    return result.rows.map((row) => ({ ...row, status: "PENDING_HUMAN" }));
  }

  async decide(input: {
    caseId: string;
    reviewerId: string;
    outcome: "APPROVED" | "REJECTED" | "NEEDS_CHANGES";
    reasonCode: string;
    comment: string;
  }): Promise<boolean> {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{ courierId: string; status: string }>(
        `SELECT "courierId", status::text AS status
         FROM verification_cases WHERE id = $1 FOR UPDATE`,
        [input.caseId],
      );
      const current = found.rows[0];
      if (current === undefined || current.status !== "PENDING_HUMAN") {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `INSERT INTO verification_decisions (
           id, "caseId", "reviewerId", outcome, "reasonCode", comment, "createdAt"
         ) VALUES (
           gen_random_uuid(), $1, $2, $3::"DecisionOutcome", $4, $5, now()
         )`,
        [input.caseId, input.reviewerId, input.outcome, input.reasonCode, input.comment],
      );
      const courierStatus =
        input.outcome === "APPROVED"
          ? "APPROVED"
          : input.outcome === "REJECTED"
            ? "REJECTED"
            : "NEEDS_CHANGES";
      if (input.outcome === "NEEDS_CHANGES") {
        await client.query(
          `UPDATE verification_cases
           SET status = 'NEEDS_CHANGES', "updatedAt" = now()
           WHERE id = $1`,
          [input.caseId],
        );
      } else {
        await client.query(
          `UPDATE verification_cases
           SET status = $2::"VerificationStatus", "resolvedAt" = now(), "updatedAt" = now()
           WHERE id = $1`,
          [input.caseId, input.outcome],
        );
      }
      await client.query(
        `UPDATE couriers SET status = $2::"CourierStatus", "updatedAt" = now() WHERE id = $1`,
        [current.courierId, courierStatus],
      );
      const diff = redactDiff({ from: "PENDING_HUMAN", to: input.outcome });
      await client.query(
        `INSERT INTO audit_logs
          (id, "actorId", "actorKind", action, "entityType", "entityId", reason, diff, "createdAt")
         VALUES (gen_random_uuid(), $1, 'ADMIN', 'verification.decided', 'verification_case', $2, $3, $4::jsonb, now())`,
        [input.reviewerId, input.caseId, input.reasonCode, JSON.stringify(diff)],
      );
      await client.query("COMMIT");
      return true;
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
