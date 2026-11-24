import { Database } from "../database.js";
import { GeoRepository } from "./geo.repository.js";

function mockDatabase(
  courierRow: { id: string; status: string } | null,
  consentId: string | null = "consent-geo-1",
): { db: Database; queries: string[] } {
  const queries: string[] = [];
  const db = {
    pool: {
      query: (sql: string) => {
        queries.push(sql);
        if (sql.includes("FROM couriers")) {
          return Promise.resolve({ rows: courierRow === null ? [] : [courierRow], rowCount: 1 });
        }
        if (sql.includes("FROM consent_records")) {
          return Promise.resolve({
            rows: consentId === null ? [] : [{ id: consentId }],
            rowCount: consentId === null ? 0 : 1,
          });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      },
    },
  } as unknown as Database;
  return { db, queries };
}

describe("GeoRepository disponibilidad según couriers.status (ORDEN 013)", () => {
  it.each(["SUSPENDED", "PENDING_VERIFICATION", "REGISTERING", "NEEDS_CHANGES", "REJECTED"])(
    "rechaza pasar a AVAILABLE cuando el domiciliario está en estado %s sin escribir en courier_availabilities",
    async (status) => {
      const { db, queries } = mockDatabase({ id: "cour-1", status });
      const repo = new GeoRepository(db);

      const res = await repo.setAvailability("user-1", "AVAILABLE");

      expect(res).toBe("not-approved");
      expect(queries.some((q) => q.includes("courier_availabilities"))).toBe(false);
    },
  );

  it.each(["SUSPENDED", "PENDING_VERIFICATION", "APPROVED"])(
    "permite pasar a OFFLINE aunque el domiciliario esté en estado %s",
    async (status) => {
      const { db, queries } = mockDatabase({ id: "cour-1", status }, null);
      const repo = new GeoRepository(db);

      const res = await repo.setAvailability("user-1", "OFFLINE");

      expect(res).toBe("ok");
      expect(queries.some((q) => q.includes("INSERT INTO courier_availabilities"))).toBe(true);
    },
  );

  it("permite pasar a AVAILABLE solo cuando está APPROVED y tiene consentimiento de geolocalización", async () => {
    const { db, queries } = mockDatabase({ id: "cour-1", status: "APPROVED" }, "consent-geo-1");
    const repo = new GeoRepository(db);

    const res = await repo.setAvailability("user-1", "AVAILABLE");

    expect(res).toBe("ok");
    expect(queries.some((q) => q.includes("INSERT INTO courier_availabilities"))).toBe(true);
  });

  it("retorna needs-consent cuando está APPROVED pero sin consentimiento de geolocalización", async () => {
    const { db, queries } = mockDatabase({ id: "cour-1", status: "APPROVED" }, null);
    const repo = new GeoRepository(db);

    const res = await repo.setAvailability("user-1", "AVAILABLE");

    expect(res).toBe("needs-consent");
    expect(queries.some((q) => q.includes("courier_availabilities"))).toBe(false);
  });

  it("no bloquea recordPing por estado de domiciliario", async () => {
    const { db, queries } = mockDatabase({ id: "cour-1", status: "SUSPENDED" }, "consent-geo-1");
    const repo = new GeoRepository(db);

    const res = await repo.recordPing({
      userId: "user-1",
      longitude: -73.9135,
      latitude: 4.9658,
      accuracyM: 10,
    });

    expect(res).toBe("ok");
    expect(queries.some((q) => q.includes("INSERT INTO location_pings"))).toBe(true);
  });
});
