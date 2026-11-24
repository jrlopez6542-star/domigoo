import type { Database } from "../database.js";
import { GeoRepository } from "../geo/geo.repository.js";
import { SubscriptionRepository } from "../subscriptions/subscription.repository.js";
import { TariffRepository } from "../tariffs/tariff.repository.js";
import { OrderRepository } from "./order.repository.js";
import { PublishRepository } from "./publish.repository.js";

const RESTAURANT_STATUSES = ["DRAFT", "PENDING_REVIEW", "ACTIVE", "SUSPENDED", "CLOSED"] as const;
const BRANCH_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "CLOSED"] as const;

type RestaurantStatus = (typeof RESTAURANT_STATUSES)[number];
type BranchStatus = (typeof BRANCH_STATUSES)[number];

const COMBINATIONS: Array<[RestaurantStatus, BranchStatus]> = RESTAURANT_STATUSES.flatMap(
  (restaurantStatus) =>
    BRANCH_STATUSES.map((branchStatus): [RestaurantStatus, BranchStatus] => [
      restaurantStatus,
      branchStatus,
    ]),
);

function sqlEnforcesActiveStatuses(sql: string): boolean {
  return (
    sql.includes("JOIN restaurants r") &&
    sql.includes("r.status = 'ACTIVE'") &&
    sql.includes("b.status = 'ACTIVE'")
  );
}

function setupPublishForStatuses(restaurantStatus: RestaurantStatus, branchStatus: BranchStatus) {
  const clientQueries: string[] = [];
  let released = false;

  const client = {
    query: (sql: string) => {
      clientQueries.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql.includes("FROM orders o") && sql.includes("FOR UPDATE OF o")) {
        const matches = sqlEnforcesActiveStatuses(sql)
          ? restaurantStatus === "ACTIVE" && branchStatus === "ACTIVE"
          : true;
        if (!matches) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
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
      query: () => Promise.reject(new Error("pool.query no debe llamarse dentro de tx")),
    },
  } as unknown as Database;

  const publish = new PublishRepository(
    db,
    new TariffRepository(db),
    new GeoRepository(db),
    new SubscriptionRepository(db),
  );

  return { publish, clientQueries, isReleased: () => released };
}

describe("Compuerta de estado ACTIVE en restaurante y sucursal (ORDEN 017)", () => {
  describe("OrderRepository.createDraft", () => {
    it.each(COMBINATIONS)(
      "restaurante=%s y sucursal=%s solo permite crear borrador en ACTIVE+ACTIVE",
      async (restaurantStatus, branchStatus) => {
        const queries: string[] = [];
        const db = {
          pool: {
            query: (sql: string) => {
              queries.push(sql);
              if (sql.includes("FROM branches b")) {
                const matches = sqlEnforcesActiveStatuses(sql)
                  ? restaurantStatus === "ACTIVE" && branchStatus === "ACTIVE"
                  : true;
                return Promise.resolve({
                  rows: matches ? [{ restaurantId: "rest-1" }] : [],
                  rowCount: matches ? 1 : 0,
                });
              }
              if (sql.includes("INSERT INTO orders")) {
                return Promise.resolve({
                  rows: [
                    {
                      id: "ord-1",
                      status: "DRAFT",
                      foodAmountCop: 25000,
                      deliveryFeeCop: 5500,
                      paymentMethod: "CASH",
                    },
                  ],
                  rowCount: 1,
                });
              }
              return Promise.resolve({ rows: [], rowCount: 0 });
            },
          },
        } as unknown as Database;

        const repo = new OrderRepository(db);
        const result = await repo.createDraft({
          userId: "user-owner-1",
          branchId: "branch-1",
          foodAmountCop: 25000,
          deliveryFeeCop: 5500,
          paymentMethod: "CASH",
        });

        expect(queries[0]).toContain("JOIN restaurants r");
        expect(queries[0]).toContain("r.status = 'ACTIVE'");
        expect(queries[0]).toContain("b.status = 'ACTIVE'");

        if (restaurantStatus === "ACTIVE" && branchStatus === "ACTIVE") {
          expect(result).toEqual({
            id: "ord-1",
            status: "DRAFT",
            foodAmountCop: 25000,
            deliveryFeeCop: 5500,
            paymentMethod: "CASH",
          });
          expect(queries.filter((q) => q.includes("INSERT INTO orders"))).toHaveLength(1);
        } else {
          expect(result).toBe("missing");
          expect(queries.some((q) => q.includes("INSERT INTO orders"))).toBe(false);
          expect(queries.some((q) => q.includes("UPDATE orders"))).toBe(false);
        }
      },
    );
  });

  describe("PublishRepository.publishDirect", () => {
    it.each(COMBINATIONS)(
      "restaurante=%s y sucursal=%s solo permite publicar DIRECT en ACTIVE+ACTIVE",
      async (restaurantStatus, branchStatus) => {
        const { publish, clientQueries, isReleased } = setupPublishForStatuses(
          restaurantStatus,
          branchStatus,
        );

        const result = await publish.publishDirect({
          orderId: "ord-1",
          userId: "user-owner-1",
          courierId: "cour-1",
          customerName: "Cliente 017",
          customerPhone: "+573001110170",
          dropoffAddress: "Carrera 5 # 10-20",
          longitude: -73.92,
          latitude: 4.97,
          at: new Date("2026-11-24T15:00:00Z"),
        });

        const lockQuery = clientQueries.find(
          (q) => q.includes("FROM orders o") && q.includes("FOR UPDATE OF o"),
        );
        expect(lockQuery).toBeDefined();
        expect(lockQuery).toContain("JOIN restaurants r");
        expect(lockQuery).toContain("r.status = 'ACTIVE'");
        expect(lockQuery).toContain("b.status = 'ACTIVE'");

        if (restaurantStatus === "ACTIVE" && branchStatus === "ACTIVE") {
          expect(result).toEqual({
            id: "ord-1",
            status: "SEEKING_COURIER",
            deliveryFeeCop: 5500,
            offer: { id: "offer-1", status: "PENDING", wave: 1 },
          });
          expect(clientQueries.filter((q) => q.includes("UPDATE orders"))).toHaveLength(1);
          expect(clientQueries[clientQueries.length - 1]).toBe("COMMIT");
        } else {
          expect(result).toBe("missing");
          expect(clientQueries.some((q) => q.includes("INSERT INTO orders"))).toBe(false);
          expect(clientQueries.some((q) => q.includes("UPDATE orders"))).toBe(false);
          expect(clientQueries).toContain("ROLLBACK");
          expect(clientQueries).not.toContain("COMMIT");
        }
        expect(isReleased()).toBe(true);
      },
    );
  });

  describe("PublishRepository.publishOpen", () => {
    it.each(COMBINATIONS)(
      "restaurante=%s y sucursal=%s solo permite publicar OPEN en ACTIVE+ACTIVE",
      async (restaurantStatus, branchStatus) => {
        const { publish, clientQueries, isReleased } = setupPublishForStatuses(
          restaurantStatus,
          branchStatus,
        );

        const result = await publish.publishOpen({
          orderId: "ord-2",
          userId: "user-owner-1",
          customerName: "Cliente 017",
          customerPhone: "+573001110171",
          dropoffAddress: "Carrera 5 # 10-21",
          longitude: -73.92,
          latitude: 4.97,
          at: new Date("2026-11-24T15:00:00Z"),
        });

        const lockQuery = clientQueries.find(
          (q) => q.includes("FROM orders o") && q.includes("FOR UPDATE OF o"),
        );
        expect(lockQuery).toBeDefined();
        expect(lockQuery).toContain("JOIN restaurants r");
        expect(lockQuery).toContain("r.status = 'ACTIVE'");
        expect(lockQuery).toContain("b.status = 'ACTIVE'");

        if (restaurantStatus === "ACTIVE" && branchStatus === "ACTIVE") {
          expect(result).toEqual({
            id: "ord-2",
            status: "SEEKING_COURIER",
            deliveryFeeCop: 5500,
            offers: [{ id: "offer-1", status: "PENDING", wave: 1 }],
          });
          expect(clientQueries.filter((q) => q.includes("UPDATE orders"))).toHaveLength(1);
          expect(clientQueries[clientQueries.length - 1]).toBe("COMMIT");
        } else {
          expect(result).toBe("missing");
          expect(clientQueries.some((q) => q.includes("INSERT INTO orders"))).toBe(false);
          expect(clientQueries.some((q) => q.includes("UPDATE orders"))).toBe(false);
          expect(clientQueries).toContain("ROLLBACK");
          expect(clientQueries).not.toContain("COMMIT");
        }
        expect(isReleased()).toBe(true);
      },
    );
  });
});
