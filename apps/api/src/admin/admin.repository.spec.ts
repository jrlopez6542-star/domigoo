import type { Database } from "../database.js";
import { AdminRepository } from "./admin.repository.js";

type RecordedQuery = {
  sql: string;
  params: unknown[] | undefined;
};

function setupAdminRepo(options?: {
  courierStatus?: string;
  cancelledOffersRowCount?: number;
  failAuditInsert?: boolean;
}) {
  const clientQueries: RecordedQuery[] = [];
  let released = false;

  const client = {
    query: (sql: string, params?: unknown[]) => {
      clientQueries.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql.includes("FROM couriers WHERE id = $1 FOR UPDATE")) {
        return Promise.resolve({
          rows: [{ status: options?.courierStatus ?? "APPROVED" }],
          rowCount: 1,
        });
      }
      if (sql.includes("UPDATE dispatch_offers")) {
        return Promise.resolve({
          rows: [],
          rowCount: options?.cancelledOffersRowCount ?? 0,
        });
      }
      if (sql.includes("INSERT INTO audit_logs") && options?.failAuditInsert === true) {
        return Promise.reject(new Error("fallo simulado al escribir audit_logs"));
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    },
    release: () => {
      released = true;
    },
  };

  const db = {
    pool: {
      connect: () => Promise.resolve(client),
      query: (sql: string) => {
        if (sql.includes("FROM admin_profiles")) {
          return Promise.resolve({ rows: [{ role: "OPERATIONS" }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
    },
  } as unknown as Database;

  return {
    repo: new AdminRepository(db),
    clientQueries,
    isReleased: () => released,
  };
}

describe("AdminRepository.setCourierSuspension (ORDEN 017)", () => {
  it("cancela ofertas PENDING dentro de la misma transacción y registra offersCancelled en audit_logs sin tocar orders", async () => {
    const { repo, clientQueries, isReleased } = setupAdminRepo({
      courierStatus: "APPROVED",
      cancelledOffersRowCount: 2,
    });

    const result = await repo.setCourierSuspension({
      courierId: "cour-1",
      userId: "admin-1",
      suspend: true,
      reason: "Incumplimiento operativo",
    });

    expect(result).toEqual({ id: "cour-1", status: "SUSPENDED" });
    const sqls = clientQueries.map((q) => q.sql);
    const beginIdx = sqls.indexOf("BEGIN");
    const updateCouriersIdx = sqls.findIndex((q) => q.includes("UPDATE couriers"));
    const updateAvailIdx = sqls.findIndex((q) => q.includes("UPDATE courier_availabilities"));
    const updateOffersIdx = sqls.findIndex((q) => q.includes("UPDATE dispatch_offers"));
    const insertAuditIdx = sqls.findIndex((q) => q.includes("INSERT INTO audit_logs"));
    const commitIdx = sqls.indexOf("COMMIT");

    expect(beginIdx).toBe(0);
    expect(updateCouriersIdx).toBeGreaterThan(beginIdx);
    expect(updateAvailIdx).toBeGreaterThan(updateCouriersIdx);
    expect(updateOffersIdx).toBeGreaterThan(updateCouriersIdx);
    expect(insertAuditIdx).toBeGreaterThan(updateOffersIdx);
    expect(commitIdx).toBeGreaterThan(insertAuditIdx);
    expect(sqls).not.toContain("ROLLBACK");

    const offerQuery = clientQueries[updateOffersIdx];
    expect(offerQuery?.sql).toContain("SET status = 'CANCELLED'");
    expect(offerQuery?.sql).toContain(`"respondedAt" = now()`);
    expect(offerQuery?.sql).toContain(`WHERE "courierId" = $1 AND status = 'PENDING'`);
    expect(offerQuery?.params).toEqual(["cour-1"]);

    const auditQuery = clientQueries[insertAuditIdx];
    const rawDiff = auditQuery?.params?.[4];
    expect(typeof rawDiff).toBe("string");
    expect(JSON.parse(rawDiff as string)).toEqual({
      from: "APPROVED",
      to: "SUSPENDED",
      reason: "Incumplimiento operativo",
      offersCancelled: 2,
    });

    expect(sqls.some((q) => q.includes("UPDATE orders"))).toBe(false);
    expect(isReleased()).toBe(true);
  });

  it("hace ROLLBACK y libera la conexión si falla el INSERT en audit_logs", async () => {
    const { repo, clientQueries, isReleased } = setupAdminRepo({
      courierStatus: "APPROVED",
      cancelledOffersRowCount: 1,
      failAuditInsert: true,
    });

    await expect(
      repo.setCourierSuspension({
        courierId: "cour-1",
        userId: "admin-1",
        suspend: true,
        reason: "Fallo auditoría",
      }),
    ).rejects.toThrow("fallo simulado al escribir audit_logs");

    const sqls = clientQueries.map((q) => q.sql);
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls.some((q) => q.includes("UPDATE dispatch_offers"))).toBe(true);
    expect(sqls[sqls.length - 1]).toBe("ROLLBACK");
    expect(sqls).not.toContain("COMMIT");
    expect(isReleased()).toBe(true);
  });

  it("reinstate (suspend=false) no reactiva ni modifica dispatch_offers ni courier_availabilities", async () => {
    const { repo, clientQueries, isReleased } = setupAdminRepo({
      courierStatus: "SUSPENDED",
    });

    const result = await repo.setCourierSuspension({
      courierId: "cour-1",
      userId: "admin-1",
      suspend: false,
      reason: "Rehabilitado tras revisión",
    });

    expect(result).toEqual({ id: "cour-1", status: "APPROVED" });
    const sqls = clientQueries.map((q) => q.sql);
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls[sqls.length - 1]).toBe("COMMIT");
    expect(sqls.some((q) => q.includes("dispatch_offers"))).toBe(false);
    expect(sqls.some((q) => q.includes("courier_availabilities"))).toBe(false);

    const auditQuery = clientQueries.find((q) => q.sql.includes("INSERT INTO audit_logs"));
    const rawDiff = auditQuery?.params?.[4];
    expect(typeof rawDiff).toBe("string");
    expect(JSON.parse(rawDiff as string)).toEqual({
      from: "SUSPENDED",
      to: "APPROVED",
      reason: "Rehabilitado tras revisión",
    });
    expect(isReleased()).toBe(true);
  });
});
