import type { Database } from "./database.js";
import { MaintenanceService } from "./maintenance/maintenance.service.js";
import type { ExpirationRepository } from "./orders/expiration.repository.js";
import type { JourneyRepository } from "./orders/journey.repository.js";
import { OffersController } from "./orders/offers.controller.js";
import type { OffersRepository } from "./orders/offers.repository.js";
import type { OrderRepository } from "./orders/order.repository.js";
import { OrdersController } from "./orders/orders.controller.js";
import type { PublishRepository } from "./orders/publish.repository.js";
import type { AuthenticatedRequest } from "./identity/session.guard.js";
describe("ORDEN 011 - Expiracion en mantenimiento y lectura perezosa", () => {
  test("MaintenanceService.runMaintenance invoca ExpirationRepository.expireStale y suma expiredOrders", async () => {
    const queryCalls: string[] = [];
    const mockDb = {
      pool: {
        query: (sql: string) => {
          queryCalls.push(sql);
          return Promise.resolve({ rowCount: 0, rows: [] });
        },
      },
    } as unknown as Database;
    let expireCalledAt: Date | undefined;
    const mockExpiration = {
      expireStale: (at: Date) => {
        expireCalledAt = at;
        return Promise.resolve({ expiredOrders: 3, expiredOffers: 5 });
      },
    } as unknown as ExpirationRepository;
    const service = new MaintenanceService(mockDb, mockExpiration);
    const now = new Date("2026-11-24T12:00:00Z");
    const summary = await service.runMaintenance(now);
    expect(expireCalledAt).toEqual(now);
    expect(summary.expiredOrders).toBe(3);
    expect(summary.expiredOffers).toBe(5);
    expect(queryCalls.length).toBeGreaterThan(0);
  });
  test("OrdersController.mine y getOne ejecutan expireStale antes de consultar", async () => {
    let expireCalls = 0;
    const mockExpiration = {
      expireStale: () => {
        expireCalls += 1;
        return Promise.resolve({ expiredOrders: 1, expiredOffers: 1 });
      },
    } as unknown as ExpirationRepository;
    const mockOrders = {
      listMine: () => Promise.resolve({ role: "RESTAURANT", orders: [] }),
      findOrderView: () => Promise.resolve({ kind: "missing" }),
    } as unknown as OrderRepository;
    const controller = new OrdersController(
      mockOrders,
      {} as PublishRepository,
      {} as JourneyRepository,
      mockExpiration,
    );
    const req = { auth: { userId: "user-1" } } as unknown as AuthenticatedRequest;
    await controller.mine(req);
    await expect(controller.getOne("order-1", req)).rejects.toThrow();
    expect(expireCalls).toBe(2);
  });
  test("OffersController.available ejecuta expireStale antes de listar ofertas", async () => {
    let expireCalls = 0;
    const mockExpiration = {
      expireStale: () => {
        expireCalls += 1;
        return Promise.resolve({ expiredOrders: 1, expiredOffers: 2 });
      },
    } as unknown as ExpirationRepository;
    const mockOffers = {
      listAvailableForUser: () => Promise.resolve([]),
    } as unknown as OffersRepository;
    const controller = new OffersController(mockOffers, mockExpiration);
    const req = { auth: { userId: "user-2" } } as unknown as AuthenticatedRequest;
    const result = await controller.available(req);
    expect(result).toEqual({ offers: [] });
    expect(expireCalls).toBe(1);
  });

  test("si expireStale rechaza, mine, getOne y available no fallan", async () => {
    const mockExpiration = {
      expireStale: () => Promise.reject(new Error("DB timeout")),
    } as unknown as ExpirationRepository;

    const mockOrders = {
      listMine: () => Promise.resolve({ role: "RESTAURANT", orders: [{ id: "o-1" }] }),
      findOrderView: () =>
        Promise.resolve({ kind: "ok", order: { id: "o-1", status: "SEEKING_COURIER" } }),
    } as unknown as OrderRepository;

    const mockOffers = {
      listAvailableForUser: () => Promise.resolve([{ offerId: "off-1", orderId: "o-1" }]),
    } as unknown as OffersRepository;

    const ordersController = new OrdersController(
      mockOrders,
      {} as PublishRepository,
      {} as JourneyRepository,
      mockExpiration,
    );
    const offersController = new OffersController(mockOffers, mockExpiration);

    const req = { auth: { userId: "user-1" } } as unknown as AuthenticatedRequest;
    const mineRes = await ordersController.mine(req);
    expect(mineRes).toEqual({ role: "RESTAURANT", orders: [{ id: "o-1" }] });

    const oneRes = await ordersController.getOne("o-1", req);
    expect(oneRes).toEqual({ id: "o-1", status: "SEEKING_COURIER" });

    const availRes = await offersController.available(req);
    expect(availRes).toEqual({ offers: [{ offerId: "off-1", orderId: "o-1" }] });
  });
});
