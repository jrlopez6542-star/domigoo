import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, readEnv, type AppEnv } from "../src/config/env.js";
import { applyHttpSecurity } from "../src/http.js";
import { resetLoginThrottle } from "../src/identity/login-throttle.js";
import { setupOpenApi } from "../src/openapi.js";
import { migrateDatabase } from "./migrate.js";
import { resetDatabase } from "./reset-db.js";

const databaseUrl =
  process.env["DATABASE_URL"] ?? "postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo";
const password = "clave-de-prueba-12";

type HttpServer = Parameters<typeof request>[0];
let currentApp: INestApplication | undefined;

function server(): HttpServer {
  if (currentApp === undefined) {
    throw new Error("La aplicación no arrancó");
  }
  return currentApp.getHttpServer() as HttpServer;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("La respuesta no es un objeto");
  }
  return value as Record<string, unknown>;
}

async function createApp(env: AppEnv): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_ENV)
    .useValue(env)
    .compile();
  const app = moduleRef.createNestApplication();
  applyHttpSecurity(app);
  setupOpenApi(app, env.appName);
  await app.init();
  return app;
}

describe("incidentes operativos (M34)", () => {
  const env = readEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO" });

  beforeAll(() => {
    migrateDatabase(databaseUrl);
  });

  beforeEach(async () => {
    resetLoginThrottle();
    await resetDatabase(databaseUrl);
    currentApp = await createApp(env);
  });

  afterEach(async () => {
    await currentApp?.close();
    currentApp = undefined;
  });

  it("autor ve incidente, otro restaurante recibe 404, conserva historial al resolver y fail exige incidente CRITICAL", async () => {
    const owner1Res = await request(server())
      .post("/v1/auth/register")
      .send({
        email: "owner1-m34@example.invalid",
        password,
        client: "MOBILE",
        consents: { termsAccepted: true, privacyAccepted: true },
      })
      .expect(201);
    const owner1Token = String(record(owner1Res.body)["token"]);

    const owner2Res = await request(server())
      .post("/v1/auth/register")
      .send({
        email: "owner2-m34@example.invalid",
        password,
        client: "MOBILE",
        consents: { termsAccepted: true, privacyAccepted: true },
      })
      .expect(201);
    const owner2Token = String(record(owner2Res.body)["token"]);

    const opsRes = await request(server())
      .post("/v1/auth/register")
      .send({
        email: "ops-m34@example.invalid",
        password,
        client: "MOBILE",
        consents: { termsAccepted: true, privacyAccepted: true },
      })
      .expect(201);
    const opsToken = String(record(opsRes.body)["token"]);

    const site = await request(server())
      .post("/v1/restaurants")
      .set("Authorization", `Bearer ${owner1Token}`)
      .send({
        legalName: "Razon M34",
        tradeName: "Local M34",
        nit: "900000340",
        email: "local-m34@example.invalid",
        phoneE164: "+573001110340",
        establishmentName: "Establecimiento M34",
        branchName: "Principal",
        addressLine: "Calle M34",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(201);

    const draft = await request(server())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${owner1Token}`)
      .send({
        branchId: record(site.body)["branchId"],
        foodAmountCop: 25000,
        deliveryFeeCop: 5000,
        paymentMethod: "CASH",
      })
      .expect(201);
    const orderId = String(record(draft.body)["id"]);

    const db = new Pool({ connectionString: databaseUrl });
    try {
      await db.query(
        `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
         SELECT id, 'Operaciones M34', 'OPERATIONS', now(), now()
         FROM users WHERE email = 'ops-m34@example.invalid'`,
      );
      await db.query(`UPDATE orders SET status = 'PICKED_UP' WHERE id = $1`, [orderId]);

      // Sin incidente CRITICAL, pasar a FAILED responde 422
      await request(server())
        .post(`/v1/orders/${orderId}/fail`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ reason: "Sin incidente critico" })
        .expect(422);

      // Crear incidente CRITICAL por restaurante
      const created = await request(server())
        .post("/v1/incidents")
        .set("Authorization", `Bearer ${owner1Token}`)
        .send({
          orderId,
          type: "ACCIDENT",
          severity: "CRITICAL",
          summary: "Accidente reportado en ruta",
        })
        .expect(201);
      const incidentId = String(record(created.body)["id"]);

      // Autor ve su caso; otro restaurante recibe 404
      await request(server())
        .get(`/v1/incidents/${incidentId}`)
        .set("Authorization", `Bearer ${owner1Token}`)
        .expect(200);
      await request(server())
        .get(`/v1/incidents/${incidentId}`)
        .set("Authorization", `Bearer ${owner2Token}`)
        .expect(404);

      // Comentar y resolver mantiene historial
      await request(server())
        .post(`/v1/incidents/${incidentId}/comments`)
        .set("Authorization", `Bearer ${owner1Token}`)
        .send({ comment: "Pedido no pudo entregarse" })
        .expect(201);
      await request(server())
        .post(`/v1/incidents/${incidentId}/status`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ status: "RESOLVED", reason: "Verificado por operaciones" })
        .expect(201);

      const view = await request(server())
        .get(`/v1/incidents/${incidentId}`)
        .set("Authorization", `Bearer ${owner1Token}`)
        .expect(200);
      expect(record(view.body)["status"]).toBe("RESOLVED");
      expect(Array.isArray(record(view.body)["events"])).toBe(true);
      expect((record(view.body)["events"] as unknown[]).length).toBe(3);

      // Ahora sí operaciones puede pasar el pedido a FAILED y escribe ambas bitácoras
      const failed = await request(server())
        .post(`/v1/orders/${orderId}/fail`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ reason: "Incidente critico confirmado" })
        .expect(201);
      expect(record(failed.body)["status"]).toBe("FAILED");

      const orderEvents = await db.query<{ toStatus: string }>(
        `SELECT "toStatus"::text AS "toStatus" FROM order_events WHERE "orderId" = $1`,
        [orderId],
      );
      expect(orderEvents.rows.some((e) => e.toStatus === "FAILED")).toBe(true);

      const audits = await db.query<{ action: string }>(
        `SELECT action FROM audit_logs WHERE "entityId" = $1`,
        [orderId],
      );
      expect(audits.rows.some((a) => a.action === "order.failed")).toBe(true);
    } finally {
      await db.end();
    }
  });
});
