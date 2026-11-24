import { InternalServerErrorException, type ArgumentsHost } from "@nestjs/common";
import type { Database } from "./database.js";
import type { GeoRepository } from "./geo/geo.repository.js";
import { SafeHttpExceptionFilter } from "./http-exception.filter.js";
import { isOpenApiEnabled } from "./openapi.js";
import { JourneyRepository } from "./orders/journey.repository.js";
import { OrderRepository } from "./orders/order.repository.js";
import { PublishRepository } from "./orders/publish.repository.js";
import type { SubscriptionRepository } from "./subscriptions/subscription.repository.js";
import type { TariffRepository } from "./tariffs/tariff.repository.js";
function createMockDb(handler: (text: string, params?: unknown[]) => { rows: unknown[] }) {
  const queries: { text: string; params: unknown[] | undefined }[] = [];
  const run = (text: string, params?: unknown[]) => {
    queries.push({ text, params });
    return Promise.resolve(handler(text, params));
  };
  const client = { query: run, release: () => {} };
  const db = {
    pool: {
      query: run,
      connect: () => Promise.resolve(client),
    },
  } as unknown as Database;
  return { db, queries };
}
describe("ORDEN 008 - Correcciones API", () => {
  describe("1) Restaurante no SUSPENDED/CLOSED requerido en crear, publicar y cancelar", () => {
    it("createDraft exige r.status NOT IN ('SUSPENDED', 'CLOSED') y retorna missing si está suspendido", async () => {
      const { db, queries } = createMockDb(() => ({ rows: [] }));
      const orders = new OrderRepository(db);
      const res = await orders.createDraft({
        userId: "u-1",
        branchId: "b-1",
        foodAmountCop: 20000,
        deliveryFeeCop: 5000,
        paymentMethod: "CASH",
      });
      expect(res).toBe("missing");
      expect(queries[0]?.text).toContain("r.status NOT IN ('SUSPENDED', 'CLOSED')");
    });
    it("publishDirect y publishOpen exigen r.status NOT IN ('SUSPENDED', 'CLOSED') y retornan missing si está suspendido", async () => {
      const { db, queries } = createMockDb(() => ({ rows: [] }));
      const publisher = new PublishRepository(
        db,
        {} as unknown as TariffRepository,
        {} as unknown as GeoRepository,
        {} as unknown as SubscriptionRepository,
      );
      const direct = await publisher.publishDirect({
        orderId: "ord-1",
        userId: "u-1",
        courierId: "c-1",
        customerName: "Ana",
        customerPhone: "+573001112233",
        dropoffAddress: "Calle 1",
        longitude: -73.92,
        latitude: 4.97,
        at: new Date(),
      });
      expect(direct).toBe("missing");
      const open = await publisher.publishOpen({
        orderId: "ord-1",
        userId: "u-1",
        customerName: "Ana",
        customerPhone: "+573001112233",
        dropoffAddress: "Calle 1",
        longitude: -73.92,
        latitude: 4.97,
        at: new Date(),
      });
      expect(open).toBe("missing");
      const orderSelects = queries.filter((q) => q.text.includes("FROM orders o"));
      expect(orderSelects).toHaveLength(2);
      for (const q of orderSelects) {
        expect(q.text).toContain("r.status NOT IN ('SUSPENDED', 'CLOSED')");
      }
    });
    it("cancelOrder exige r.status NOT IN ('SUSPENDED', 'CLOSED') para miembros de restaurante", async () => {
      const { db, queries } = createMockDb((text) => {
        if (text.includes("FROM orders")) {
          return {
            rows: [
              {
                id: "ord-1",
                status: "SEEKING_COURIER",
                restaurantId: "r-1",
                assignedCourierId: null,
              },
            ],
          };
        }
        return { rows: [] };
      });
      const journey = new JourneyRepository(db);
      const res = await journey.cancelOrder({
        orderId: "ord-1",
        userId: "u-1",
        reason: "Cierre",
      });
      expect(res).toBe("missing");
      const memberQ = queries.find((q) => q.text.includes("FROM restaurant_memberships m"));
      expect(memberQ?.text).toContain("r.status NOT IN ('SUSPENDED', 'CLOSED')");
    });
  });
  describe("2) SEC-09: OpenAPI deshabilitado en producción y logs sanitizados", () => {
    it("isOpenApiEnabled retorna false si NODE_ENV o VERCEL_ENV es production", () => {
      expect(isOpenApiEnabled({ NODE_ENV: "production" })).toBe(false);
      expect(isOpenApiEnabled({ NODE_ENV: "test", VERCEL_ENV: "production" })).toBe(false);
      expect(isOpenApiEnabled({ NODE_ENV: "test", VERCEL_ENV: "preview" })).toBe(true);
    });
    it("SafeHttpExceptionFilter registra solo name y message (sin stack ni objeto completo en producción)", () => {
      const prevNodeEnv = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = "production";
      const filter = new SafeHttpExceptionFilter();
      const logged: unknown[][] = [];
      const origError = console.error;
      console.error = (...args: unknown[]) => {
        logged.push(args);
      };
      const res = {
        headersSent: false,
        setHeader: () => {},
        status: () => res,
        json: () => {},
      };
      const host = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: {} }),
          getResponse: () => res,
        }),
      } as unknown as ArgumentsHost;
      try {
        filter.catch(new InternalServerErrorException("fallo interno"), host);
      } finally {
        console.error = origError;
        if (prevNodeEnv === undefined) {
          delete process.env["NODE_ENV"];
        } else {
          process.env["NODE_ENV"] = prevNodeEnv;
        }
      }
      expect(logged).toHaveLength(1);
      const payload = logged[0]?.[1] as Record<string, unknown>;
      expect(payload).toEqual({
        name: "InternalServerErrorException",
        message: "fallo interno",
      });
      expect(payload["stack"]).toBeUndefined();
    });
  });
});
