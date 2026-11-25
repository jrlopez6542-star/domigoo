import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Database } from "../database.js";
import {
  CURRENT_LEGAL_DOCUMENT_ORDER_BY,
  SELECT_ALL_CURRENT_LEGAL_DOCUMENTS_SQL,
  expectedLegalDocumentKindForPurpose,
} from "./legal-documents.js";

export type LegalDocument = {
  id: string;
  kind: string;
  version: string;
  contentHash: string;
};

export type InsertConsentResult =
  | { id: string; legalDocumentId: string }
  | "missing"
  | "invalid"
  | "wrong_kind"
  | { kind: "outdated"; currentLegalDocumentId: string };

@Injectable()
export class PrivacyRepository {
  constructor(private readonly database: Database) {}

  async insertDocument(input: {
    kind: string;
    version: string;
    content: string;
  }): Promise<LegalDocument | "conflict"> {
    const contentHash = createHash("sha256").update(input.content).digest("hex");
    try {
      const result = await this.database.pool.query<LegalDocument>(
        `INSERT INTO legal_documents (id, kind, version, "contentHash", content, "publishedAt")
         VALUES (gen_random_uuid(), $1::"LegalDocumentKind", $2, $3, $4, now())
         RETURNING id, kind::text AS kind, version, "contentHash"`,
        [input.kind, input.version, contentHash, input.content],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error("No se pudo publicar el documento");
      }
      return row;
    } catch (error) {
      if (pgCode(error) === "23505") {
        return "conflict";
      }
      throw error;
    }
  }

  async listCurrentDocuments(): Promise<LegalDocument[]> {
    const result = await this.database.pool.query<LegalDocument>(
      SELECT_ALL_CURRENT_LEGAL_DOCUMENTS_SQL,
    );
    return result.rows;
  }

  async insertConsent(input: {
    userId: string;
    legalDocumentId: string;
    purpose: string;
    channel: string;
    ip?: string;
    userAgent?: string;
  }): Promise<InsertConsentResult> {
    const expectedKind = expectedLegalDocumentKindForPurpose(input.purpose);
    try {
      if (expectedKind === null) {
        const result = await this.database.pool.query<{ id: string; legalDocumentId: string }>(
          `INSERT INTO consent_records (
             id, "userId", "legalDocumentId", purpose, channel, "grantedAt", ip, "userAgent"
           )
           VALUES (gen_random_uuid(), $1, $2, $3::"ConsentPurpose", $4::"ConsentChannel", now(), $5, $6)
           RETURNING id, "legalDocumentId"`,
          [
            input.userId,
            input.legalDocumentId,
            input.purpose,
            input.channel,
            input.ip ?? null,
            input.userAgent ?? null,
          ],
        );
        const row = result.rows[0];
        if (row === undefined) {
          throw new Error("No se pudo registrar el consentimiento");
        }
        return row;
      }

      const result = await this.database.pool.query<{
        targetId: string | null;
        targetKind: string | null;
        currentId: string | null;
        consentId: string | null;
        legalDocumentId: string | null;
      }>(
        `WITH target AS (
           SELECT id, kind
           FROM legal_documents
           WHERE id = $2
         ),
         current_doc AS (
           SELECT id
           FROM legal_documents
           WHERE kind = $7::"LegalDocumentKind"
           ORDER BY ${CURRENT_LEGAL_DOCUMENT_ORDER_BY}
           LIMIT 1
         ),
         inserted AS (
           INSERT INTO consent_records (
             id, "userId", "legalDocumentId", purpose, channel, "grantedAt", ip, "userAgent"
           )
           SELECT gen_random_uuid(), $1, target.id, $3::"ConsentPurpose", $4::"ConsentChannel", now(), $5, $6
           FROM target
           JOIN current_doc ON current_doc.id = target.id
           WHERE target.kind = $7::"LegalDocumentKind"
           RETURNING id, "legalDocumentId"
         )
         SELECT
           (SELECT id FROM target) AS "targetId",
           (SELECT kind::text FROM target) AS "targetKind",
           (SELECT id FROM current_doc) AS "currentId",
           (SELECT id FROM inserted) AS "consentId",
           (SELECT "legalDocumentId" FROM inserted) AS "legalDocumentId"`,
        [
          input.userId,
          input.legalDocumentId,
          input.purpose,
          input.channel,
          input.ip ?? null,
          input.userAgent ?? null,
          expectedKind,
        ],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error("No se pudo registrar el consentimiento");
      }
      if (row.targetId === null) {
        return "missing";
      }
      if (row.targetKind !== expectedKind) {
        return "wrong_kind";
      }
      if (row.consentId === null || row.legalDocumentId === null) {
        if (row.currentId === null) {
          throw new Error("No se pudo resolver la versión vigente del documento legal");
        }
        return { kind: "outdated", currentLegalDocumentId: row.currentId };
      }
      return { id: row.consentId, legalDocumentId: row.legalDocumentId };
    } catch (error) {
      const code = pgCode(error);
      if (code === "22P02") {
        return "invalid";
      }
      if (code === "23503") {
        return "missing";
      }
      throw error;
    }
  }

  async revoke(id: string, userId: string): Promise<boolean> {
    const result = await this.database.pool.query(
      `UPDATE consent_records SET "revokedAt" = now()
       WHERE id = $1 AND "userId" = $2 AND "revokedAt" IS NULL`,
      [id, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findCurrentConsentId(userId: string, purpose: string): Promise<string | null> {
    const result = await this.database.pool.query<{ id: string }>(
      `SELECT id FROM consent_records
       WHERE "userId" = $1 AND purpose = $2::"ConsentPurpose" AND "revokedAt" IS NULL
       ORDER BY "grantedAt" DESC
       LIMIT 1`,
      [userId, purpose],
    );
    return result.rows[0]?.id ?? null;
  }

  async isCurrent(userId: string, purpose: string): Promise<boolean> {
    return (await this.findCurrentConsentId(userId, purpose)) !== null;
  }

  async createDataSubjectRequest(input: {
    userId: string;
    type: string;
    note?: string;
  }): Promise<{ id: string; type: string; status: "OPEN" }> {
    const res = await this.database.pool.query<{ id: string; type: string }>(
      `INSERT INTO data_subject_requests (id, "userId", type, status, note, "openedAt")
       VALUES (gen_random_uuid(), $1, $2::"DataSubjectRequestType", 'OPEN', $3, now())
       RETURNING id, type::text AS type`,
      [input.userId, input.type, input.note ?? null],
    );
    const row = res.rows[0];
    if (row === undefined) {
      throw new Error("No se pudo crear la solicitud de habeas data");
    }
    await this.database.pool.query(
      `INSERT INTO audit_logs
        (id, "actorId", "actorKind", action, "entityType", "entityId", diff, "createdAt")
       VALUES (gen_random_uuid(), $1, 'SYSTEM', 'privacy.dsr_created', 'data_subject_request', $2, $3::jsonb, now())`,
      [input.userId, row.id, JSON.stringify({ type: row.type })],
    );
    return { id: row.id, type: row.type, status: "OPEN" };
  }

  async processDataSubjectRequest(input: {
    id: string;
    actorUserId: string;
    action: "COMPLETE" | "DENY";
  }): Promise<{ id: string; status: string; anonymizedOrders: number } | "missing" | "forbidden"> {
    const adminQ = await this.database.pool.query<{ role: string }>(
      `SELECT role::text AS role FROM admin_profiles WHERE "userId" = $1`,
      [input.actorUserId],
    );
    const role = adminQ.rows[0]?.role;
    const isPrivacyAdmin = role === "SUPERADMIN" || role === "SECURITY";

    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const reqQ = await client.query<{
        id: string;
        userId: string;
        type: string;
        status: string;
      }>(
        `SELECT id, "userId", type::text AS type, status::text AS status
         FROM data_subject_requests
         WHERE id = $1 FOR UPDATE`,
        [input.id],
      );
      const dsr = reqQ.rows[0];
      if (dsr === undefined) {
        await client.query("ROLLBACK");
        return "missing";
      }

      const canSelfRevoke = dsr.type === "REVOCATION" && dsr.userId === input.actorUserId;
      if (!isPrivacyAdmin && !canSelfRevoke) {
        await client.query("ROLLBACK");
        return "forbidden";
      }

      const nextStatus = input.action === "COMPLETE" ? "COMPLETED" : "DENIED";
      let anonymizedOrders = 0;

      if (input.action === "COMPLETE") {
        if (dsr.type === "REVOCATION") {
          await client.query(
            `UPDATE consent_records
             SET "revokedAt" = now()
             WHERE "userId" = $1 AND purpose = 'GEOLOCATION' AND "revokedAt" IS NULL`,
            [dsr.userId],
          );
          await client.query(
            `UPDATE courier_availabilities
             SET state = 'OFFLINE', "updatedAt" = now()
             WHERE "courierId" IN (SELECT id FROM couriers WHERE "userId" = $1)
               AND state <> 'OFFLINE'`,
            [dsr.userId],
          );
        } else if (dsr.type === "DELETION") {
          const anon = await client.query(
            `UPDATE orders
             SET "customerName" = 'ANONIMIZADO',
                 "customerPhoneE164" = NULL,
                 "dropoffAddress" = NULL,
                 "dropoffLocation" = NULL,
                 "updatedAt" = now()
             WHERE "createdById" = $1
               AND status IN (
                 'DELIVERED', 'EXPIRED', 'CANCELLED_RESTAURANT',
                 'CANCELLED_COURIER', 'CANCELLED_ADMIN', 'FAILED'
               )`,
            [dsr.userId],
          );
          anonymizedOrders = anon.rowCount ?? 0;
        }
      }

      await client.query(
        `UPDATE data_subject_requests
         SET status = $2::"DataSubjectRequestStatus", "closedAt" = now()
         WHERE id = $1`,
        [dsr.id, nextStatus],
      );

      await client.query(
        `INSERT INTO audit_logs
          (id, "actorId", "actorKind", action, "entityType", "entityId", diff, "createdAt")
         VALUES (gen_random_uuid(), $1, $2::"ActorKind", 'privacy.dsr_processed', 'data_subject_request', $3, $4::jsonb, now())`,
        [
          input.actorUserId,
          isPrivacyAdmin ? "ADMIN" : "SYSTEM",
          dsr.id,
          JSON.stringify({ type: dsr.type, status: nextStatus, anonymizedOrders }),
        ],
      );

      await client.query("COMMIT");
      return { id: dsr.id, status: nextStatus, anonymizedOrders };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function pgCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
