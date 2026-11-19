import { Database } from "../database.js";
import { JourneyRepository } from "./journey.repository.js";
import { OrderRepository } from "./order.repository.js";

describe("JourneyRepository y proyecciones de OrderRepository (M24)", () => {
  it("transiciona de ACCEPTED a ARRIVING_PICKUP y registra order_events y audit_logs", async () => {
    const executedSql: string[] = [];
    const client = {
      query: (sql: string) => {
        executedSql.push(sql);
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes("FROM orders")) {
          return Promise.resolve({
            rows: [
              {
                id: "ord-1",
                status: "ACCEPTED",
                assignedCourierId: "cour-1",
              },
            ],
          });
        }
        if (sql.includes("FROM couriers")) {
          return Promise.resolve({ rows: [{ id: "cour-1" }] });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      },
      release: () => {},
    };
    const db = {
      pool: { connect: () => Promise.resolve(client) },
    } as unknown as Database;

    const repo = new JourneyRepository(db);
    const res = await repo.transitionByCourier({
      orderId: "ord-1",
      userId: "user-1",
      targetStatus: "ARRIVING_PICKUP",
    });

    expect(res).toEqual({
      id: "ord-1",
      fromStatus: "ACCEPTED",
      toStatus: "ARRIVING_PICKUP",
      status: "ARRIVING_PICKUP",
    });
    expect(executedSql.some((s) => s.includes("INSERT INTO order_events"))).toBe(true);
    expect(executedSql.some((s) => s.includes("INSERT INTO audit_logs"))).toBe(true);
  });

  it("retorna forbidden cuando otro domiciliario intenta avanzar el pedido", async () => {
    const client = {
      query: (sql: string) => {
        if (sql.includes("FROM orders")) {
          return Promise.resolve({
            rows: [{ id: "ord-1", status: "ACCEPTED", assignedCourierId: "cour-1" }],
          });
        }
        if (sql.includes("FROM couriers")) {
          return Promise.resolve({ rows: [{ id: "cour-2" }] });
        }
        return Promise.resolve({ rows: [] });
      },
      release: () => {},
    };
    const db = {
      pool: { connect: () => Promise.resolve(client) },
    } as unknown as Database;

    const repo = new JourneyRepository(db);
    const res = await repo.transitionByCourier({
      orderId: "ord-1",
      userId: "user-2",
      targetStatus: "ARRIVING_PICKUP",
    });

    expect(res).toBe("forbidden");
  });

  it("retorna invalid_transition cuando la máquina no permite el salto", async () => {
    const client = {
      query: (sql: string) => {
        if (sql.includes("FROM orders")) {
          return Promise.resolve({
            rows: [{ id: "ord-1", status: "ACCEPTED", assignedCourierId: "cour-1" }],
          });
        }
        if (sql.includes("FROM couriers")) {
          return Promise.resolve({ rows: [{ id: "cour-1" }] });
        }
        return Promise.resolve({ rows: [] });
      },
      release: () => {},
    };
    const db = {
      pool: { connect: () => Promise.resolve(client) },
    } as unknown as Database;

    const repo = new JourneyRepository(db);
    const res = await repo.transitionByCourier({
      orderId: "ord-1",
      userId: "user-1",
      targetStatus: "AT_DROPOFF",
    });

    expect(res).toBe("invalid_transition");
  });

  it("oculta foodAmountCop e incluye customerPhone para el domiciliario asignado desde ACCEPTED", async () => {
    const db = {
      pool: {
        query: (sql: string) => {
          if (sql.includes("FROM orders")) {
            return Promise.resolve({
              rows: [
                {
                  id: "ord-1",
                  referenceCode: "REF123",
                  restaurantId: "rest-1",
                  status: "ACCEPTED",
                  foodAmountCop: 25000,
                  deliveryFeeCop: 6000,
                  paymentMethod: "CASH",
                  assignedCourierId: "cour-1",
                  customerName: "Ana",
                  customerPhoneE164: "+573001234567",
                  dropoffAddress: "Calle 10",
                },
              ],
            });
          }
          if (sql.includes("FROM restaurant_memberships")) {
            return Promise.resolve({ rows: [] });
          }
          if (sql.includes("FROM couriers")) {
            return Promise.resolve({ rows: [{ id: "cour-1" }] });
          }
          if (sql.includes("FROM order_events")) {
            return Promise.resolve({
              rows: [
                {
                  id: "ev-1",
                  fromStatus: "SEEKING_COURIER",
                  toStatus: "ACCEPTED",
                  actorKind: "COURIER",
                  createdAt: new Date("2026-11-12T12:00:00Z"),
                },
              ],
            });
          }
          return Promise.resolve({ rows: [] });
        },
      },
    } as unknown as Database;

    const repo = new OrderRepository(db);
    const view = await repo.findOrderView("ord-1", "user-courier-1");
    expect(view.kind).toBe("ok");
    if (view.kind === "ok") {
      expect("foodAmountCop" in view.order).toBe(false);
      expect(view.order.customerPhone).toBe("+573001234567");
      expect(view.order.deliveryFeeCop).toBe(6000);
      expect(view.order.events).toHaveLength(1);
    }
  });

  it("limpia pickupPinCiphertext y deliveryPinCiphertext al cancelar un pedido", async () => {
    const executedSql: string[] = [];
    const client = {
      query: (sql: string) => {
        executedSql.push(sql);
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes("FROM orders")) {
          return Promise.resolve({
            rows: [
              {
                id: "ord-1",
                restaurantId: "rest-1",
                status: "ACCEPTED",
                assignedCourierId: "cour-1",
              },
            ],
          });
        }
        if (sql.includes("FROM restaurant_memberships")) {
          return Promise.resolve({ rows: [{ id: "mem-1" }] });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      },
      release: () => {},
    };
    const db = {
      pool: { connect: () => Promise.resolve(client) },
    } as unknown as Database;

    const repo = new JourneyRepository(db);
    const res = await repo.cancelOrder({
      orderId: "ord-1",
      userId: "user-1",
      reason: "Cliente canceló",
    });

    expect(res).toEqual({
      id: "ord-1",
      fromStatus: "ACCEPTED",
      toStatus: "CANCELLED_RESTAURANT",
      status: "CANCELLED_RESTAURANT",
    });
    const updateSql = executedSql.find((s) => s.includes("UPDATE orders"));
    expect(updateSql).toContain('"pickupPinCiphertext" = NULL');
    expect(updateSql).toContain('"deliveryPinCiphertext" = NULL');
  });
});
