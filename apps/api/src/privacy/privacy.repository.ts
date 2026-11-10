import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Database } from "../database.js";

export type LegalDocument = {
  id: string;
  kind: string;
  version: string;
  contentHash: string;
};

@Injectable()
export class PrivacyRepository {
  constructor(private readonly database: Database) {}

  async insertDocument(input: {
    kind: string;
    version: string;
    content: string;
  }): Promise<LegalDocument> {
    const contentHash = createHash("sha256").update(input.content).digest("hex");
    const result = await this.database.pool.query<LegalDocument>(
      `INSERT INTO legal_documents (id, kind, version, "contentHash", "publishedAt")
       VALUES (gen_random_uuid(), $1::"LegalDocumentKind", $2, $3, now())
       RETURNING id, kind::text AS kind, version, "contentHash"`,
      [input.kind, input.version, contentHash],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("No se pudo publicar el documento");
    }
    return row;
  }

  async insertConsent(input: {
    userId: string;
    legalDocumentId: string;
    purpose: string;
    channel: string;
  }): Promise<{ id: string; legalDocumentId: string }> {
    const result = await this.database.pool.query<{ id: string; legalDocumentId: string }>(
      `INSERT INTO consent_records (id, "userId", "legalDocumentId", purpose, channel, "grantedAt")
       VALUES (gen_random_uuid(), $1, $2, $3::"ConsentPurpose", $4::"ConsentChannel", now())
       RETURNING id, "legalDocumentId"`,
      [input.userId, input.legalDocumentId, input.purpose, input.channel],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("No se pudo registrar el consentimiento");
    }
    return row;
  }

  async revoke(id: string, userId: string): Promise<boolean> {
    const result = await this.database.pool.query(
      `UPDATE consent_records SET "revokedAt" = now()
       WHERE id = $1 AND "userId" = $2 AND "revokedAt" IS NULL`,
      [id, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async isCurrent(userId: string, purpose: string): Promise<boolean> {
    const result = await this.database.pool.query(
      `SELECT 1 FROM consent_records
       WHERE "userId" = $1 AND purpose = $2::"ConsentPurpose" AND "revokedAt" IS NULL
       LIMIT 1`,
      [userId, purpose],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
