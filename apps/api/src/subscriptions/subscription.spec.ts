import { HttpException } from "@nestjs/common";
import type { AuditEntry, AuditRecorder } from "../audit/audit.service.js";
import type { Database } from "../database.js";
import type { AdminRequest } from "../identity/admin.guard.js";
import { readEnv } from "../config/env.js";
import { SubscriptionRepository } from "./subscription.repository.js";
import { SubscriptionAdminController, readAcknowledgeNote } from "./subscriptions.controller.js";

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

describe("readAcknowledgeNote y SubscriptionAdminController.acknowledge (ORDEN 015)", () => {
  it("acepta cuerpo ausente, nulo o sin note", () => {
    expect(readAcknowledgeNote(undefined)).toEqual({ ok: true });
    expect(readAcknowledgeNote(null)).toEqual({ ok: true });
    expect(readAcknowledgeNote({})).toEqual({ ok: true });
    expect(readAcknowledgeNote({ note: undefined })).toEqual({ ok: true });
  });

  it("hace trim a note válida entre 1 y 200 caracteres", () => {
    expect(readAcknowledgeNote({ note: "  Revision soporte #9021 verificada  " })).toEqual({
      ok: true,
      note: "Revision soporte #9021 verificada",
    });
    const max200 = "A".repeat(200);
    expect(readAcknowledgeNote({ note: max200 })).toEqual({ ok: true, note: max200 });
  });

  it("rechaza note que no es string, vacía/espacios o mayor a 200 caracteres", () => {
    expect(readAcknowledgeNote({ note: 12345 })).toEqual({ ok: false });
    expect(readAcknowledgeNote({ note: null })).toEqual({ ok: false });
    expect(readAcknowledgeNote({ note: "" })).toEqual({ ok: false });
    expect(readAcknowledgeNote({ note: "   " })).toEqual({ ok: false });
    expect(readAcknowledgeNote({ note: "B".repeat(201) })).toEqual({ ok: false });
    expect(readAcknowledgeNote("texto-suelto")).toEqual({ ok: false });
  });

  it("pasa reason a audit.record cuando viene note, lo omite sin body y lanza 422 con note inválida", async () => {
    const recorded: AuditEntry[] = [];
    const subscriptions = {
      acknowledge: () => Promise.resolve(true),
    } as unknown as SubscriptionRepository;
    const audit = {
      record: (entry: AuditEntry) => {
        recorded.push(entry);
        return Promise.resolve();
      },
    } as unknown as AuditRecorder;
    const controller = new SubscriptionAdminController(subscriptions, audit);
    const req = { auth: { userId: "admin-1", sessionId: "sess-1" } } as unknown as AdminRequest;

    const withNote = await controller.acknowledge("decl-1", req, {
      note: "  Comprobante COMP-015  ",
    });
    expect(withNote).toEqual({ acknowledged: true });
    expect(recorded[0]).toEqual({
      actorId: "admin-1",
      actorKind: "ADMIN",
      action: "subscription.payment_acknowledged",
      entityType: "subscription_payment_declaration",
      entityId: "decl-1",
      reason: "Comprobante COMP-015",
    });

    const withoutBody = await controller.acknowledge("decl-2", req, undefined);
    expect(withoutBody).toEqual({ acknowledged: true });
    expect(recorded[1]).toEqual({
      actorId: "admin-1",
      actorKind: "ADMIN",
      action: "subscription.payment_acknowledged",
      entityType: "subscription_payment_declaration",
      entityId: "decl-2",
    });

    await expect(controller.acknowledge("decl-3", req, { note: 999 })).rejects.toMatchObject({
      status: 422,
    });
    await expect(
      controller.acknowledge("decl-3", req, { note: "X".repeat(201) }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(recorded).toHaveLength(2);
  });
});
