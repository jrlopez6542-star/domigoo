import { Injectable } from "@nestjs/common";
import { Database } from "../database.js";
import { redactDiff } from "../audit/redact-diff.js";

const INCIDENT_TYPES = new Set([
  "COURIER_NO_SHOW",
  "RESTAURANT_NO_SHOW",
  "CUSTOMER_ABSENT",
  "PIN_LOCKOUT",
  "ACCIDENT",
  "HARASSMENT",
  "DOCUMENT_FRAUD_SUSPICION",
  "THEFT_SUSPICION",
  "OTHER",
]);
const INCIDENT_SEVERITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const INCIDENT_STATUSES = new Set([
  "OPEN",
  "ACKNOWLEDGED",
  "INVESTIGATING",
  "RESOLVED",
  "DISMISSED",
]);

export type IncidentEventView = {
  id: string;
  actorId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type IncidentView = {
  id: string;
  orderId: string | null;
  restaurantId: string | null;
  courierId: string | null;
  reporterId: string;
  type: string;
  severity: string;
  status: string;
  summary: string;
  createdAt: string;
  events: IncidentEventView[];
};

@Injectable()
export class IncidentsRepository {
  constructor(private readonly database: Database) {}

  async createIncident(input: {
    userId: string;
    orderId?: string;
    type: string;
    severity: string;
    summary: string;
  }): Promise<
    | { id: string; status: "OPEN"; severity: string; type: string }
    | "missing"
    | "forbidden"
    | "invalid"
  > {
    if (!INCIDENT_TYPES.has(input.type) || !INCIDENT_SEVERITIES.has(input.severity)) {
      return "invalid";
    }

    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      let restaurantId: string | null = null;
      let courierId: string | null = null;

      if (input.orderId !== undefined) {
        const orderQ = await client.query<{
          id: string;
          restaurantId: string;
          assignedCourierId: string | null;
        }>(`SELECT id, "restaurantId", "assignedCourierId" FROM orders WHERE id = $1`, [
          input.orderId,
        ]);
        const order = orderQ.rows[0];
        if (order === undefined) {
          await client.query("ROLLBACK");
          return "missing";
        }
        restaurantId = order.restaurantId;
        courierId = order.assignedCourierId;

        const access = await this.checkOrderActorAccess(client, order, input.userId);
        if (access === "missing") {
          await client.query("ROLLBACK");
          return "missing";
        }
        if (access === "forbidden") {
          await client.query("ROLLBACK");
          return "forbidden";
        }
      } else {
        const adminQ = await client.query<{ role: string }>(
          `SELECT role::text AS role FROM admin_profiles WHERE "userId" = $1`,
          [input.userId],
        );
        if (adminQ.rows[0] === undefined) {
          await client.query("ROLLBACK");
          return "forbidden";
        }
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO incidents (
           id, "orderId", "restaurantId", "courierId", "reporterId",
           type, severity, status, summary, "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, $4,
           $5::"IncidentType", $6::"IncidentSeverity", 'OPEN', $7, now(), now()
         ) RETURNING id`,
        [
          input.orderId ?? null,
          restaurantId,
          courierId,
          input.userId,
          input.type,
          input.severity,
          input.summary,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (id === undefined) {
        throw new Error("No se pudo crear el incidente");
      }

      await client.query(
        `INSERT INTO incident_events (id, "incidentId", "actorId", kind, payload, "createdAt")
         VALUES (gen_random_uuid(), $1, $2, 'CREATED', $3::jsonb, now())`,
        [id, input.userId, JSON.stringify({ type: input.type, severity: input.severity })],
      );

      const diff = redactDiff({
        orderId: input.orderId ?? null,
        type: input.type,
        severity: input.severity,
      });
      await client.query(
        `INSERT INTO audit_logs
          (id, "actorId", "actorKind", action, "entityType", "entityId", diff, "createdAt")
         VALUES (gen_random_uuid(), $1, 'SYSTEM', 'incident.created', 'incident', $2, $3::jsonb, now())`,
        [input.userId, id, JSON.stringify(diff)],
      );

      await client.query("COMMIT");
      return { id, status: "OPEN", severity: input.severity, type: input.type };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getIncident(id: string, userId: string): Promise<IncidentView | "missing"> {
    const res = await this.database.pool.query<{
      id: string;
      orderId: string | null;
      restaurantId: string | null;
      courierId: string | null;
      reporterId: string;
      type: string;
      severity: string;
      status: string;
      summary: string;
      createdAt: Date | string;
    }>(
      `SELECT id, "orderId", "restaurantId", "courierId", "reporterId",
              type::text AS type, severity::text AS severity, status::text AS status,
              summary, "createdAt"
       FROM incidents
       WHERE id = $1`,
      [id],
    );
    const inc = res.rows[0];
    if (inc === undefined) {
      return "missing";
    }

    const canSee = await this.canViewIncident(inc, userId);
    if (!canSee) {
      return "missing";
    }

    const evRes = await this.database.pool.query<{
      id: string;
      actorId: string | null;
      kind: string;
      payload: Record<string, unknown>;
      createdAt: Date | string;
    }>(
      `SELECT id, "actorId", kind, payload, "createdAt"
       FROM incident_events
       WHERE "incidentId" = $1
       ORDER BY "createdAt" ASC, id ASC`,
      [id],
    );

    return {
      id: inc.id,
      orderId: inc.orderId,
      restaurantId: inc.restaurantId,
      courierId: inc.courierId,
      reporterId: inc.reporterId,
      type: inc.type,
      severity: inc.severity,
      status: inc.status,
      summary: inc.summary,
      createdAt: inc.createdAt instanceof Date ? inc.createdAt.toISOString() : inc.createdAt,
      events: evRes.rows.map((e) => ({
        id: e.id,
        actorId: e.actorId,
        kind: e.kind,
        payload: e.payload,
        createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
      })),
    };
  }

  async addComment(
    id: string,
    userId: string,
    comment: string,
  ): Promise<{ id: string; incidentId: string } | "missing"> {
    const inc = await this.getIncident(id, userId);
    if (inc === "missing") {
      return "missing";
    }
    const inserted = await this.database.pool.query<{ id: string }>(
      `INSERT INTO incident_events (id, "incidentId", "actorId", kind, payload, "createdAt")
       VALUES (gen_random_uuid(), $1, $2, 'COMMENT', $3::jsonb, now())
       RETURNING id`,
      [id, userId, JSON.stringify({ comment })],
    );
    const eventId = inserted.rows[0]?.id;
    if (eventId === undefined) {
      throw new Error("No se pudo agregar el comentario");
    }
    return { id: eventId, incidentId: id };
  }

  async changeStatus(
    id: string,
    userId: string,
    nextStatus: string,
    reason: string,
  ): Promise<{ id: string; status: string } | "missing" | "forbidden" | "invalid"> {
    if (!INCIDENT_STATUSES.has(nextStatus)) {
      return "invalid";
    }
    const adminQ = await this.database.pool.query<{ role: string }>(
      `SELECT role::text AS role FROM admin_profiles WHERE "userId" = $1`,
      [userId],
    );
    const role = adminQ.rows[0]?.role;
    if (role !== "SUPERADMIN" && role !== "OPERATIONS") {
      return "forbidden";
    }

    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const currentQ = await client.query<{ status: string }>(
        `SELECT status::text AS status FROM incidents WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const current = currentQ.rows[0];
      if (current === undefined) {
        await client.query("ROLLBACK");
        return "missing";
      }

      await client.query(
        `UPDATE incidents SET status = $2::"IncidentStatus", "updatedAt" = now() WHERE id = $1`,
        [id, nextStatus],
      );
      await client.query(
        `INSERT INTO incident_events (id, "incidentId", "actorId", kind, payload, "createdAt")
         VALUES (gen_random_uuid(), $1, $2, 'STATUS_CHANGED', $3::jsonb, now())`,
        [id, userId, JSON.stringify({ from: current.status, to: nextStatus, reason })],
      );
      const diff = redactDiff({ from: current.status, to: nextStatus, reason });
      await client.query(
        `INSERT INTO audit_logs
          (id, "actorId", "actorKind", action, "entityType", "entityId", reason, diff, "createdAt")
         VALUES (gen_random_uuid(), $1, 'ADMIN', 'incident.status_changed', 'incident', $2, $3, $4::jsonb, now())`,
        [userId, id, reason, JSON.stringify(diff)],
      );

      await client.query("COMMIT");
      return { id, status: nextStatus };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async checkOrderActorAccess(
    client: import("pg").PoolClient,
    order: { restaurantId: string; assignedCourierId: string | null },
    userId: string,
  ): Promise<"ok" | "missing" | "forbidden"> {
    const memberQ = await client.query<{ id: string }>(
      `SELECT id FROM restaurant_memberships
       WHERE "restaurantId" = $1 AND "userId" = $2 AND status = 'ACTIVE'`,
      [order.restaurantId, userId],
    );
    if (memberQ.rows[0] !== undefined) {
      return "ok";
    }
    const courierQ = await client.query<{ id: string }>(
      `SELECT id FROM couriers WHERE "userId" = $1`,
      [userId],
    );
    const courier = courierQ.rows[0];
    if (courier !== undefined) {
      return order.assignedCourierId === courier.id ? "ok" : "forbidden";
    }
    const adminQ = await client.query<{ role: string }>(
      `SELECT role::text AS role FROM admin_profiles WHERE "userId" = $1`,
      [userId],
    );
    const role = adminQ.rows[0]?.role;
    if (role === "SUPERADMIN" || role === "OPERATIONS") {
      return "ok";
    }
    return "missing";
  }

  private async canViewIncident(
    inc: { reporterId: string; restaurantId: string | null; courierId: string | null },
    userId: string,
  ): Promise<boolean> {
    if (inc.reporterId === userId) {
      return true;
    }
    if (inc.restaurantId !== null) {
      const m = await this.database.pool.query<{ id: string }>(
        `SELECT id FROM restaurant_memberships
         WHERE "restaurantId" = $1 AND "userId" = $2 AND status = 'ACTIVE'`,
        [inc.restaurantId, userId],
      );
      if (m.rows[0] !== undefined) {
        return true;
      }
    }
    if (inc.courierId !== null) {
      const c = await this.database.pool.query<{ id: string }>(
        `SELECT id FROM couriers WHERE id = $1 AND "userId" = $2`,
        [inc.courierId, userId],
      );
      if (c.rows[0] !== undefined) {
        return true;
      }
    }
    const a = await this.database.pool.query<{ role: string }>(
      `SELECT role::text AS role FROM admin_profiles WHERE "userId" = $1`,
      [userId],
    );
    return a.rows[0] !== undefined;
  }
}
