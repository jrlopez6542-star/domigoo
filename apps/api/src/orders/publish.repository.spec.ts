import type { Database } from "../database.js";
import { GeoRepository } from "../geo/geo.repository.js";
import { SubscriptionRepository } from "../subscriptions/subscription.repository.js";
import { TariffRepository } from "../tariffs/tariff.repository.js";
import { PublishRepository } from "./publish.repository.js";

function setupTransactionalPublish() {
  const clientQueries: string[] = [];
  const poolQueries: string[] = [];
  let released = false;

  const client = {
    query: (sql: string) => {
      clientQueries.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql.includes("FROM orders o") && sql.includes("FOR UPDATE OF o")) {
        return Promise.resolve({
          rows: [
            {
              restaurantId: "rest-1",
              branchId: "branch-1",
              deliveryFeeCop: 5500,
              paymentMethod: "CASH",
              longitude: -73.9132,
              latitude: 4.9655,
            },
          ],
          rowCount: 1,
        });
      }
      if (sql.includes("FROM restaurant_subscriptions")) {
        return Promise.resolve({ rows: [{ status: "TRIAL" }], rowCount: 1 });
      }
      if (sql.includes("FROM operations_policies") && sql.includes("offerRadiusMeters")) {
        return Promise.resolve({
          rows: [
            { id: "pol-1", radius: 3000, seeking: 600, directTtl: 120, openTtl: 120, waveCap: 4 },
          ],
          rowCount: 1,
        });
      }
      if (sql.includes("FROM operations_policies") && sql.includes("locationFreshnessSeconds")) {
        return Promise.resolve({ rows: [{ seconds: 120 }], rowCount: 1 });
      }
      if (sql.includes("FROM tariff_versions")) {
        return Promise.resolve({ rows: [{ id: "tv-1" }], rowCount: 1 });
      }
      if (sql.includes("ST_Distance") && sql.includes("AS meters")) {
        return Promise.resolve({ rows: [{ meters: 800 }], rowCount: 1 });
      }
      if (sql.includes("FROM tariff_zones")) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql.includes("FROM tariff_rules")) {
        return Promise.resolve({
          rows: [
            {
              baseFeeCop: 5500,
              perKmCop: 0,
              minimumFeeCop: 0,
              nightMultiplierBps: 10000,
              nightStartsMinute: 0,
              nightEndsMinute: 0,
            },
          ],
          rowCount: 1,
        });
      }
      if (sql.includes("FROM courier_availabilities")) {
        return Promise.resolve({ rows: [{ id: "cour-1" }], rowCount: 1 });
      }
      if (sql.includes(`SELECT "userId" FROM couriers`)) {
        return Promise.resolve({ rows: [{ userId: "user-cour-1" }], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO dispatch_offers")) {
        return Promise.resolve({ rows: [{ id: "offer-1" }], rowCount: 1 });
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
        poolQueries.push(sql);
        return Promise.reject(new Error(`pool.query no debe llamarse dentro de tx: ${sql}`));
      },
    },
  } as unknown as Database;

  const subscriptions = new SubscriptionRepository(db);
  const tariffs = new TariffRepository(db);
  const geo = new GeoRepository(db);
  const publish = new PublishRepository(db, tariffs, geo, subscriptions);

  return { publish, clientQueries, poolQueries, getReleased: () => released };
}

describe("PublishRepository transacción sin segunda conexión de pool (ORDEN 016)", () => {
  it("publishDirect ejecuta canDispatch, quote e isEligible usando client sin llamar pool.query entre BEGIN y COMMIT", async () => {
    const { publish, clientQueries, poolQueries, getReleased } = setupTransactionalPublish();

    const result = await publish.publishDirect({
      orderId: "ord-1",
      userId: "user-owner-1",
      courierId: "cour-1",
      customerName: "Cliente Prueba",
      customerPhone: "+573001110160",
      dropoffAddress: "Carrera 5 # 12-30",
      longitude: -73.92,
      latitude: 4.97,
      at: new Date("2026-11-24T15:00:00Z"),
    });

    expect(result).toEqual({
      id: "ord-1",
      status: "SEEKING_COURIER",
      deliveryFeeCop: 5500,
      offer: { id: "offer-1", status: "PENDING", wave: 1 },
    });
    expect(poolQueries).toEqual([]);
    expect(clientQueries[0]).toBe("BEGIN");
    expect(clientQueries[clientQueries.length - 1]).toBe("COMMIT");
    expect(clientQueries.some((q) => q.includes("FROM restaurant_subscriptions"))).toBe(true);
    expect(clientQueries.some((q) => q.includes("FROM tariff_versions"))).toBe(true);
    expect(clientQueries.some((q) => q.includes("FROM courier_availabilities"))).toBe(true);
    expect(getReleased()).toBe(true);
  });

  it("publishOpen ejecuta canDispatch, quote y listEligible usando client sin llamar pool.query entre BEGIN y COMMIT", async () => {
    const { publish, clientQueries, poolQueries, getReleased } = setupTransactionalPublish();

    const result = await publish.publishOpen({
      orderId: "ord-2",
      userId: "user-owner-1",
      customerName: "Cliente Prueba",
      customerPhone: "+573001110161",
      dropoffAddress: "Carrera 6 # 10-15",
      longitude: -73.92,
      latitude: 4.97,
      at: new Date("2026-11-24T15:00:00Z"),
    });

    expect(result).toEqual({
      id: "ord-2",
      status: "SEEKING_COURIER",
      deliveryFeeCop: 5500,
      offers: [{ id: "offer-1", status: "PENDING", wave: 1 }],
    });
    expect(poolQueries).toEqual([]);
    expect(clientQueries[0]).toBe("BEGIN");
    expect(clientQueries[clientQueries.length - 1]).toBe("COMMIT");
    expect(clientQueries.some((q) => q.includes("FROM restaurant_subscriptions"))).toBe(true);
    expect(clientQueries.some((q) => q.includes("FROM tariff_versions"))).toBe(true);
    expect(clientQueries.some((q) => q.includes("FROM courier_availabilities"))).toBe(true);
    expect(getReleased()).toBe(true);
  });
});
