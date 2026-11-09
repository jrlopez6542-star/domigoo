import { Injectable } from "@nestjs/common";
import { Database } from "../database.js";
import { redactDiff } from "./redact-diff.js";

export type AuditEntry = {
  actorId: string | null;
  actorKind: "RESTAURANT" | "COURIER" | "ADMIN" | "SYSTEM";
  action: string;
  entityType: string;
  entityId: string;
  reason?: string;
  diff?: Record<string, unknown>;
};

@Injectable()
export class AuditRecorder {
  constructor(private readonly database: Database) {}

  async record(entry: AuditEntry): Promise<void> {
    const diff = entry.diff === undefined ? null : redactDiff(entry.diff);
    await this.database.pool.query(
      `INSERT INTO audit_logs
        (id, "actorId", "actorKind", action, "entityType", "entityId", reason, diff, "createdAt")
       VALUES (gen_random_uuid(), $1, $2::"ActorKind", $3, $4, $5, $6, $7::jsonb, now())`,
      [
        entry.actorId,
        entry.actorKind,
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.reason ?? null,
        diff === null ? null : JSON.stringify(diff),
      ],
    );
  }
}
