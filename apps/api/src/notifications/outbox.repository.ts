import { Inject, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { Database } from "../database.js";
import { PUSH_SENDER, type PushSender } from "./push-sender.port.js";

export type NotificationTemplate =
  | {
      template: "OFFER_NEW";
      payload: { offerId: string; orderId: string; deliveryFeeCop: number };
    }
  | {
      template: "OFFER_WITHDRAWN";
      payload: { offerId: string; orderId: string; reason: string };
    }
  | {
      template: "ORDER_CANCELLED";
      payload: { orderId: string; status: string; reason: string };
    }
  | {
      template: "VERIFICATION_DECISION";
      payload: { caseId: string; outcome: string; reasonCode: string };
    };

const MAX_ATTEMPTS = 5;

@Injectable()
export class OutboxRepository {
  constructor(
    private readonly database: Database,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  async registerPushToken(
    userId: string,
    token: string,
  ): Promise<{ id: string; platform: "ANDROID" }> {
    const inserted = await this.database.pool.query<{ id: string }>(
      `INSERT INTO device_push_tokens (id, "userId", token, platform, "lastSeenAt")
       VALUES (gen_random_uuid(), $1, $2, 'ANDROID', now())
       ON CONFLICT (token) DO UPDATE
         SET "userId" = EXCLUDED."userId",
             "revokedAt" = NULL,
             "lastSeenAt" = now()
       RETURNING id`,
      [userId, token],
    );
    const id = inserted.rows[0]?.id;
    if (id === undefined) {
      throw new Error("No se pudo registrar el token push");
    }
    return { id, platform: "ANDROID" };
  }

  async enqueue(userId: string, msg: NotificationTemplate, client?: PoolClient): Promise<void> {
    const executor = client ?? this.database.pool;
    await executor.query(
      `INSERT INTO notification_outbox (
         id, "userId", template, payload, status, "attemptCount", "availableAt", "createdAt"
       ) VALUES (gen_random_uuid(), $1, $2, $3::jsonb, 'PENDING', 0, now(), now())`,
      [userId, msg.template, JSON.stringify(msg.payload)],
    );
  }

  async drain(at?: Date): Promise<{ sent: number; failed: number }> {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await client.query<{
        id: string;
        userId: string;
        template: string;
        payload: Record<string, unknown>;
        attemptCount: number;
      }>(
        `SELECT id, "userId", template, payload, "attemptCount"
         FROM notification_outbox
         WHERE status = 'PENDING' AND "availableAt" <= COALESCE($1::timestamptz, now())
         ORDER BY "createdAt" ASC
         LIMIT 50
         FOR UPDATE SKIP LOCKED`,
        [at ?? null],
      );

      let sent = 0;
      let failed = 0;

      for (const item of rows.rows) {
        const tokensRes = await client.query<{ token: string }>(
          `SELECT token
           FROM device_push_tokens
           WHERE "userId" = $1 AND "revokedAt" IS NULL`,
          [item.userId],
        );

        try {
          for (const t of tokensRes.rows) {
            await this.sender.send({
              token: t.token,
              template: item.template,
              payload: item.payload,
            });
          }
          await client.query(
            `UPDATE notification_outbox
             SET status = 'SENT', "sentAt" = now()
             WHERE id = $1`,
            [item.id],
          );
          sent += 1;
        } catch (err) {
          const nextAttempts = item.attemptCount + 1;
          const nextStatus = nextAttempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING";
          const rawMsg = err instanceof Error ? err.message : "Error de envío push";
          const safeError = rawMsg.slice(0, 300);

          await client.query(
            `UPDATE notification_outbox
             SET "attemptCount" = $2,
                 status = $3::"OutboxStatus",
                 "lastError" = $4,
                 "availableAt" = now()
             WHERE id = $1`,
            [item.id, nextAttempts, nextStatus, safeError],
          );
          if (nextStatus === "FAILED") {
            failed += 1;
          }
        }
      }

      await client.query("COMMIT");
      return { sent, failed };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
