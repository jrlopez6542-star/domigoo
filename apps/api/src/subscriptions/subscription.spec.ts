import type { Database } from "../database.js";
import { readEnv } from "../config/env.js";
import { SubscriptionRepository } from "./subscription.repository.js";

describe("SubscriptionRepository (prueba gratuita de 15 días y BILLING_ENABLED)", () => {
  const databaseUrl = "postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo";

  it("por defecto (BILLING_ENABLED=false) mantiene el servicio gratis al vencer los 15 días sin bloquear ni suspender", async () => {
    const queries: string[] = [];
    const mockDb = {
      pool: {
        query: (sql: string) => {
          queries.push(sql);
          return Promise.resolve({ rows: [{ status: "TRIAL" }], rowCount: 1 });
        },
        connect: () =>
          Promise.reject(
            new Error("advance() no debe abrir transacción cuando BILLING_ENABLED=false"),
          ),
      },
    } as unknown as Database;

    const env = readEnv({ DATABASE_URL: databaseUrl });
    expect(env.billingEnabled).toBe(false);
    expect(env.subscriptionTrialDays).toBe(15);
    expect(env.subscriptionPlaceholderPriceCop).toBe(0);

    const repo = new SubscriptionRepository(mockDb, env);
    expect(repo.isBillingEnabled()).toBe(false);

    const expiredDate = new Date("2026-12-31T23:59:59Z");
    const allowed = await repo.canDispatch("rest-1", expiredDate);
    expect(allowed).toBe(true);
    expect(queries[0]).not.toContain("periodEndsAt");

    const advanced = await repo.advance(expiredDate);
    expect(advanced).toBe(0);
  });

  it("cuando BILLING_ENABLED=true evalúa el vencimiento periodEndsAt y avanza estados vencidos", async () => {
    const queries: string[] = [];
    const mockDb = {
      pool: {
        query: (sql: string) => {
          queries.push(sql);
          return Promise.resolve({ rows: [], rowCount: 0 });
        },
        connect: () =>
          Promise.resolve({
            query: (sql: string) => {
              queries.push(sql);
              if (sql.includes("SELECT id, status::text AS status")) {
                return Promise.resolve({ rows: [{ id: "sub-1", status: "TRIAL" }], rowCount: 1 });
              }
              return Promise.resolve({ rows: [], rowCount: 1 });
            },
            release: () => undefined,
          }),
      },
    } as unknown as Database;

    const env = readEnv({ DATABASE_URL: databaseUrl, BILLING_ENABLED: "true" });
    expect(env.billingEnabled).toBe(true);

    const repo = new SubscriptionRepository(mockDb, env);
    expect(repo.isBillingEnabled()).toBe(true);

    const at = new Date("2026-12-31T23:59:59Z");
    const allowed = await repo.canDispatch("rest-1", at);
    expect(allowed).toBe(false);
    expect(queries[0]).toContain("periodEndsAt");

    const advanced = await repo.advance(at);
    expect(advanced).toBe(1);
  });
});
