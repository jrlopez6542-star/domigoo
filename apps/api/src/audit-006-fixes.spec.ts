import { NotFoundException, type ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { AdminRepository } from "./admin/admin.repository.js";
import type { AuditRecorder } from "./audit/audit.service.js";
import type { Database } from "./database.js";
import type { GeoRepository } from "./geo/geo.repository.js";
import { IdentityService } from "./identity/identity.service.js";
import type { IdentityRepository, StoredSession } from "./identity/identity.repository.js";
import { IncidentsRepository } from "./incidents/incidents.repository.js";
import { OffersRepository } from "./orders/offers.repository.js";
import { OrderRepository } from "./orders/order.repository.js";
import { PublishRepository } from "./orders/publish.repository.js";
import { PrivacyRepository } from "./privacy/privacy.repository.js";
import {
  ALLOW_ONBOARDING_RESTAURANT_KEY,
  RestaurantMemberGuard,
} from "./restaurants/restaurant.guard.js";
import { RestaurantRepository } from "./restaurants/restaurant.repository.js";
import type { SubscriptionRepository } from "./subscriptions/subscription.repository.js";
import type { TariffRepository } from "./tariffs/tariff.repository.js";
import { TrackingController } from "./tracking/tracking.controller.js";
import type { TrackingRepository } from "./tracking/tracking.repository.js";
type QueryRecord = { text: string; params: unknown[] | undefined };
function createMockDb(
  handler: (text: string, params?: unknown[]) => { rows: unknown[]; rowCount?: number },
) {
  const queries: QueryRecord[] = [];
  const run = (text: string, params?: unknown[]) => {
    queries.push({ text, params });
    return Promise.resolve(handler(text, params));
  };
  const client = {
    query: run,
    release: () => {},
  };
  const db = {
    pool: {
      query: run,
      connect: () => Promise.resolve(client),
    },
  } as unknown as Database;
  return { db, queries };
}
describe("ORDEN 007 - Correcciones API auditoría 006", () => {
  describe("SEC-01: authenticate rechaza usuarios no ACTIVE; suspender la entidad no revoca sesiones", () => {
    it("rechaza sesión si userStatus !== ACTIVE y la acepta si es ACTIVE", async () => {
      let currentStatus = "SUSPENDED";
      const fakeRepo = {
        findSession: (): Promise<StoredSession> =>
          Promise.resolve({
            id: "sess-1",
            userId: "user-1",
            client: "WEB",
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
            userStatus: currentStatus,
          }),
      } as unknown as IdentityRepository;
      const service = new IdentityService(fakeRepo, {} as unknown as AuditRecorder);
      await expect(service.authenticate({ authorization: "Bearer tok-1" })).resolves.toBeNull();
      currentStatus = "ACTIVE";
      await expect(service.authenticate({ authorization: "Bearer tok-1" })).resolves.toEqual({
        userId: "user-1",
        sessionId: "sess-1",
      });
    });
    it("suspender domiciliario o restaurante no revoca sesiones (la suspensión es de la entidad)", async () => {
      const courierMock = createMockDb((text) => {
        if (text.includes("FROM admin_profiles")) return { rows: [{ role: "SUPERADMIN" }] };
        if (text.includes("FROM couriers"))
          return { rows: [{ status: "APPROVED", userId: "u-c1" }] };
        return { rows: [] };
      });
      const adminCourier = new AdminRepository(courierMock.db);
      const resCourier = await adminCourier.setCourierSuspension({
        courierId: "c-1",
        userId: "admin-1",
        suspend: true,
        reason: "Incumplimiento",
      });
      expect(resCourier).toEqual({ id: "c-1", status: "SUSPENDED" });
      expect(courierMock.queries.some((q) => q.text.includes("UPDATE sessions"))).toBe(false);
      expect(
        courierMock.queries.some(
          (q) => q.text.includes("UPDATE couriers SET status") && q.params?.[1] === "SUSPENDED",
        ),
      ).toBe(true);
      const restMock = createMockDb((text) => {
        if (text.includes("FROM admin_profiles")) return { rows: [{ role: "OPERATIONS" }] };
        if (text.includes("FROM restaurants")) return { rows: [{ status: "ACTIVE" }] };
        return { rows: [] };
      });
      const adminRest = new AdminRepository(restMock.db);
      const resRest = await adminRest.setRestaurantSuspension({
        restaurantId: "r-1",
        userId: "admin-1",
        suspend: true,
        reason: "Cierre temporal",
      });
      expect(resRest).toEqual({ id: "r-1", status: "SUSPENDED" });
      expect(restMock.queries.some((q) => q.text.includes("UPDATE sessions"))).toBe(false);
      expect(
        restMock.queries.some(
          (q) => q.text.includes("UPDATE restaurants SET status") && q.params?.[1] === "SUSPENDED",
        ),
      ).toBe(true);
    });
  });
  describe("SEC-06: createIncident sin orderId restringido a admin", () => {
    it("retorna forbidden para usuario no admin cuando falta orderId", async () => {
      const { db } = createMockDb((text) => {
        if (text.includes("FROM admin_profiles")) return { rows: [] };
        return { rows: [] };
      });
      const repo = new IncidentsRepository(db);
      const res = await repo.createIncident({
        userId: "customer-1",
        type: "OTHER",
        severity: "LOW",
        summary: "Sin pedido",
      });
      expect(res).toBe("forbidden");
    });
    it("permite crear incidente sin orderId a un administrador", async () => {
      const { db } = createMockDb((text) => {
        if (text.includes("FROM admin_profiles")) return { rows: [{ role: "OPERATIONS" }] };
        if (text.includes("INSERT INTO incidents")) return { rows: [{ id: "inc-1" }] };
        return { rows: [] };
      });
      const repo = new IncidentsRepository(db);
      const res = await repo.createIncident({
        userId: "admin-1",
        type: "OTHER",
        severity: "LOW",
        summary: "Incidencia operativa",
      });
      expect(res).toEqual({ id: "inc-1", status: "OPEN", severity: "LOW", type: "OTHER" });
    });
  });
  describe("SEC-07: Cache-Control tracking y DSR REVOCATION / DELETION", () => {
    it("GET /v1/tracking/:token responde con Cache-Control: no-store, private", async () => {
      const headers: Record<string, string> = {};
      const fakeTracking = {
        resolvePublic: () =>
          Promise.resolve({ referenceCode: "REF1", status: "ACCEPTED", events: [] }),
      } as unknown as TrackingRepository;
      const controller = new TrackingController(fakeTracking);
      const req = { headers: {}, ip: "127.0.0.1" } as unknown as Request;
      const res = {
        setHeader: (name: string, value: string) => {
          headers[name.toLowerCase()] = value;
        },
      } as unknown as Response;
      await controller.getPublic("tok-1", req, res);
      expect(headers["cache-control"]).toBe("no-store, private");
    });
    it("REVOCATION pone courier_availabilities OFFLINE y DELETION anonimiza dropoffAddress/dropoffLocation", async () => {
      const revMock = createMockDb((text) => {
        if (text.includes("FROM admin_profiles")) return { rows: [] };
        if (text.includes("FROM data_subject_requests")) {
          return { rows: [{ id: "dsr-1", userId: "u-1", type: "REVOCATION", status: "OPEN" }] };
        }
        return { rows: [] };
      });
      const revRepo = new PrivacyRepository(revMock.db);
      await revRepo.processDataSubjectRequest({
        id: "dsr-1",
        actorUserId: "u-1",
        action: "COMPLETE",
      });
      expect(
        revMock.queries.some(
          (q) => q.text.includes("UPDATE courier_availabilities") && q.text.includes("OFFLINE"),
        ),
      ).toBe(true);
      const delMock = createMockDb((text) => {
        if (text.includes("FROM admin_profiles")) return { rows: [{ role: "SECURITY" }] };
        if (text.includes("FROM data_subject_requests")) {
          return { rows: [{ id: "dsr-2", userId: "u-2", type: "DELETION", status: "OPEN" }] };
        }
        if (text.includes("UPDATE orders")) return { rows: [], rowCount: 1 };
        return { rows: [] };
      });
      const delRepo = new PrivacyRepository(delMock.db);
      const delRes = await delRepo.processDataSubjectRequest({
        id: "dsr-2",
        actorUserId: "sec-1",
        action: "COMPLETE",
      });
      expect(delRes).toEqual({ id: "dsr-2", status: "COMPLETED", anonymizedOrders: 1 });
      const updateOrderSql =
        delMock.queries.find((q) => q.text.includes("UPDATE orders"))?.text ?? "";
      expect(updateOrderSql).toContain('"dropoffAddress" = NULL');
      expect(updateOrderSql).toContain('"dropoffLocation" = NULL');
    });
  });
  describe("BUG-04: accept() exige APPROVED y reinstate valida SUSPENDED", () => {
    it("offers.accept retorna conflict si el domiciliario no está APPROVED", async () => {
      const { db } = createMockDb((text) => {
        if (text.includes("FROM idempotency_keys")) return { rows: [] };
        if (text.includes("FROM couriers c")) {
          return {
            rows: [
              { courierId: "c-1", courierStatus: "SUSPENDED", availabilityState: "AVAILABLE" },
            ],
          };
        }
        return { rows: [] };
      });
      const offers = new OffersRepository(db);
      const res = await offers.accept("off-1", "u-1", "idem-1", {});
      expect(res).toBe("conflict");
    });
    it("reinstateCourier y reinstateRestaurant retornan conflict si el estado previo no es SUSPENDED", async () => {
      const courierMock = createMockDb((text) => {
        if (text.includes("FROM admin_profiles")) return { rows: [{ role: "SUPERADMIN" }] };
        if (text.includes("FROM couriers"))
          return { rows: [{ status: "REGISTERING", userId: "u-1" }] };
        return { rows: [] };
      });
      const admin = new AdminRepository(courierMock.db);
      expect(
        await admin.setCourierSuspension({
          courierId: "c-1",
          userId: "admin-1",
          suspend: false,
          reason: "Rehabilitar",
        }),
      ).toBe("conflict");
      const restMock = createMockDb((text) => {
        if (text.includes("FROM admin_profiles")) return { rows: [{ role: "SUPERADMIN" }] };
        if (text.includes("FROM restaurants")) return { rows: [{ status: "PENDING_REVIEW" }] };
        return { rows: [] };
      });
      const admin2 = new AdminRepository(restMock.db);
      expect(
        await admin2.setRestaurantSuspension({
          restaurantId: "r-1",
          userId: "admin-1",
          suspend: false,
          reason: "Reactivar",
        }),
      ).toBe("conflict");
    });
  });
  describe("BUG-05: listMine sin foodAmountCop, findForMember status real, publishDirect sin duplicado", () => {
    it("listMine para COURIER omite foodAmountCop y findForMember devuelve status real", async () => {
      const { db, queries } = createMockDb((text) => {
        if (text.includes("JOIN restaurant_memberships m")) {
          return {
            rows: [
              {
                id: "ord-1",
                status: "SEEKING_COURIER",
                foodAmountCop: 25000,
                deliveryFeeCop: 5000,
                paymentMethod: "CASH",
              },
            ],
          };
        }
        if (text.includes("FROM restaurant_memberships")) return { rows: [] };
        if (text.includes("SELECT id FROM couriers")) return { rows: [{ id: "c-1" }] };
        if (text.includes("FROM orders o")) {
          return {
            rows: [
              {
                id: "ord-1",
                referenceCode: "REF1",
                status: "ACCEPTED",
                branchName: "Centro",
                deliveryFeeCop: 5000,
                paymentMethod: "CASH",
                customerName: "Ana",
                dropoffAddress: "Calle 1",
                createdAt: new Date("2026-11-23T00:00:00.000Z"),
              },
            ],
          };
        }
        return { rows: [] };
      });
      const orders = new OrderRepository(db);
      const mine = await orders.listMine("u-courier");
      expect(mine).not.toBe("forbidden");
      if (mine !== "forbidden") {
        expect(mine.role).toBe("COURIER");
        expect("foodAmountCop" in (mine.orders[0] ?? {})).toBe(false);
      }
      const courierSelect =
        queries.find((q) => q.text.includes('WHERE o."assignedCourierId" = $1'))?.text ?? "";
      expect(courierSelect).not.toContain("foodAmountCop");
      const memberOrder = await orders.findForMember("ord-1", "u-rest");
      expect(memberOrder?.status).toBe("SEEKING_COURIER");
    });
    it("publishDirect inserta una sola notificación direct_offer en notification_outbox", async () => {
      const { db, queries } = createMockDb((text) => {
        if (text.includes("FROM orders o")) {
          return {
            rows: [
              {
                restaurantId: "r-1",
                branchId: "b-1",
                deliveryFeeCop: 6000,
                paymentMethod: "CASH",
                longitude: -73.92,
                latitude: 4.97,
              },
            ],
          };
        }
        if (text.includes("FROM operations_policies")) {
          return { rows: [{ id: "pol-1", radius: 5000, seeking: 180, directTtl: 90 }] };
        }
        if (text.includes("FROM couriers WHERE id")) {
          return { rows: [{ userId: "u-courier" }] };
        }
        if (text.includes("INSERT INTO dispatch_offers")) {
          return { rows: [{ id: "off-1" }] };
        }
        return { rows: [] };
      });
      const fakeTariffs = {
        quote: () =>
          Promise.resolve({
            versionId: "tv-1",
            zoneCode: "Z1",
            distanceMeters: 1200,
            deliveryFeeCop: 6000,
          }),
      } as unknown as TariffRepository;
      const fakeGeo = {
        isEligible: () => Promise.resolve(true),
      } as unknown as GeoRepository;
      const fakeSubs = {
        canDispatch: () => Promise.resolve(true),
      } as unknown as SubscriptionRepository;
      const publisher = new PublishRepository(db, fakeTariffs, fakeGeo, fakeSubs);
      await publisher.publishDirect({
        orderId: "ord-1",
        userId: "u-rest",
        courierId: "c-1",
        customerName: "Cliente",
        customerPhone: "+573001234567",
        dropoffAddress: "Cra 5 # 10",
        longitude: -73.92,
        latitude: 4.97,
        at: new Date(),
      });
      const outboxInserts = queries.filter((q) =>
        q.text.includes("INSERT INTO notification_outbox"),
      );
      expect(outboxInserts).toHaveLength(1);
    });
  });
  describe("007c: RestaurantMemberGuard / findForMember por estado de restaurante", () => {
    it("findForMember exige ACTIVE por defecto y rechaza SUSPENDED", async () => {
      const { db, queries } = createMockDb((_text, params) => {
        const allowed = params?.[2] as string[] | undefined;
        if (allowed?.includes("ACTIVE") && !allowed.includes("PENDING_REVIEW")) {
          return { rows: [] };
        }
        return { rows: [{ id: "11111111-1111-4111-8111-111111111111", tradeName: "Mi Local" }] };
      });
      const repo = new RestaurantRepository(db);
      await expect(
        repo.findForMember("11111111-1111-4111-8111-111111111111", "u-1"),
      ).resolves.toBeNull();
      expect(queries[0]?.params?.[2]).toEqual(["ACTIVE"]);
      await expect(
        repo.findForMember("11111111-1111-4111-8111-111111111111", "u-1", {
          allowOnboarding: true,
        }),
      ).resolves.toEqual({
        id: "11111111-1111-4111-8111-111111111111",
        tradeName: "Mi Local",
      });
      expect(queries[1]?.params?.[2]).toEqual(["ACTIVE", "DRAFT", "PENDING_REVIEW"]);
      expect(queries[1]?.params?.[2]).not.toContain("SUSPENDED");
    });
    it("RestaurantMemberGuard rechaza restaurante SUSPENDED y permite ruta de onboarding PENDING_REVIEW", async () => {
      const identity = {
        authenticate: () => Promise.resolve({ userId: "u-1", sessionId: "s-1" }),
      } as unknown as IdentityService;
      const makeContext = (id: string) =>
        ({
          switchToHttp: () => ({
            getRequest: () => ({ headers: { authorization: "Bearer tok" }, params: { id } }),
          }),
          getHandler: () => () => {},
          getClass: () => Object,
        }) as unknown as ExecutionContext;
      const suspendedRepo = {
        findForMember: () => Promise.resolve(null),
      } as unknown as RestaurantRepository;
      const onboardingReflector = {
        getAllAndOverride: (key: string) => key === ALLOW_ONBOARDING_RESTAURANT_KEY,
      } as unknown as Reflector;
      const guardSuspended = new RestaurantMemberGuard(
        identity,
        suspendedRepo,
        onboardingReflector,
      );
      await expect(
        guardSuspended.canActivate(makeContext("11111111-1111-4111-8111-111111111111")),
      ).rejects.toThrow(NotFoundException);
      let receivedOptions: { allowOnboarding?: boolean } | undefined;
      const pendingRepo = {
        findForMember: (id: string, _userId: string, options?: { allowOnboarding?: boolean }) => {
          receivedOptions = options;
          return Promise.resolve({ id, tradeName: "Pendiente" });
        },
      } as unknown as RestaurantRepository;
      const guardPending = new RestaurantMemberGuard(identity, pendingRepo, onboardingReflector);
      await expect(
        guardPending.canActivate(makeContext("11111111-1111-4111-8111-111111111111")),
      ).resolves.toBe(true);
      expect(receivedOptions).toEqual({ allowOnboarding: true });
    });
  });
});
