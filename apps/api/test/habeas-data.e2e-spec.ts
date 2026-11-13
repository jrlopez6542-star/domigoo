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

describe("solicitudes de habeas data (M37)", () => {
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

  it("revoca geolocalización impidiendo nuevos pings y anonimiza pedidos cerrados sin borrar montos ni auditoría", async () => {
    const secRes = await request(server())
      .post("/v1/auth/register")
      .send({ email: "sec-m37@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const secToken = String(record(secRes.body)["token"]);

    const ownerRes = await request(server())
      .post("/v1/auth/register")
      .send({ email: "owner-m37@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const ownerToken = String(record(ownerRes.body)["token"]);

    const courierRes = await request(server())
      .post("/v1/auth/register")
      .send({ email: "courier-m37@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const courierToken = String(record(courierRes.body)["token"]);

    const site = await request(server())
      .post("/v1/restaurants")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        legalName: "Razon M37",
        tradeName: "Local M37",
        nit: "900000370",
        email: "local-m37@example.invalid",
        phoneE164: "+573001110370",
        establishmentName: "Establecimiento M37",
        branchName: "Principal",
        addressLine: "Calle M37",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(201);

    const draft = await request(server())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId: record(site.body)["branchId"],
        foodAmountCop: 42000,
        deliveryFeeCop: 7000,
        paymentMethod: "CASH",
      })
      .expect(201);
    const orderId = String(record(draft.body)["id"]);

    const db = new Pool({ connectionString: databaseUrl });
    try {
      await db.query(
        `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
         SELECT id, 'Seguridad M37', 'SECURITY', now(), now()
         FROM users WHERE email = 'sec-m37@example.invalid'`,
      );
      await db.query(
        `INSERT INTO couriers (
           id, "userId", "documentType", "documentNumber", "firstName", "lastName",
           status, "registrationSource", "createdAt", "updatedAt"
         )
         SELECT gen_random_uuid(), id, 'CC', '80037001', 'Domiciliario', 'M37',
                'APPROVED', 'OPEN', now(), now()
         FROM users WHERE email = 'courier-m37@example.invalid'`,
      );
      await db.query(
        `UPDATE orders
         SET status = 'DELIVERED',
             "customerName" = 'Cliente Real M37',
             "customerPhoneE164" = '+573005551234',
             "deliveredAt" = now()
         WHERE id = $1`,
        [orderId],
      );

      // Consentimiento de geolocalización para el domiciliario
      const legalDoc = await request(server())
        .post("/v1/legal-documents")
        .set("Authorization", `Bearer ${secToken}`)
        .send({
          kind: "GEOLOCATION_CONSENT",
          version: "2026-m37-gps",
          content: "Autorización de geolocalización M37",
        })
        .expect(201);
      await request(server())
        .post("/v1/consents")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({
          legalDocumentId: record(legalDoc.body)["id"],
          purpose: "GEOLOCATION",
          channel: "MOBILE",
        })
        .expect(201);

      // Ping funciona antes de revocar
      await request(server())
        .post("/v1/couriers/me/location")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ longitude: -73.92, latitude: 4.97, accuracyM: 10 })
        .expect(201);

      // 1. Solicitud REVOCATION -> revoca geolocalización e impide nuevos pings
      const revReq = await request(server())
        .post("/v1/data-subject-requests")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ type: "REVOCATION", note: "Revocar GPS" })
        .expect(201);
      await request(server())
        .post(`/v1/data-subject-requests/${String(record(revReq.body)["id"])}/process`)
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ action: "COMPLETE" })
        .expect(201);

      await request(server())
        .post("/v1/couriers/me/location")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ longitude: -73.92, latitude: 4.97, accuracyM: 10 })
        .expect(422);

      // 2. Solicitud DELETION -> anonimiza pedido cerrado sin borrar montos ni auditoría
      const delReq = await request(server())
        .post("/v1/data-subject-requests")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "DELETION", note: "Suprimir contacto de pedidos cerrados" })
        .expect(201);
      const processed = await request(server())
        .post(`/v1/data-subject-requests/${String(record(delReq.body)["id"])}/process`)
        .set("Authorization", `Bearer ${secToken}`)
        .send({ action: "COMPLETE" })
        .expect(201);
      expect(record(processed.body)["anonymizedOrders"]).toBe(1);

      const ordRow = await db.query<{
        customerName: string;
        customerPhoneE164: string | null;
        foodAmountCop: number;
        deliveryFeeCop: number;
      }>(
        `SELECT "customerName", "customerPhoneE164", "foodAmountCop", "deliveryFeeCop"
         FROM orders WHERE id = $1`,
        [orderId],
      );
      expect(ordRow.rows[0]?.customerName).toBe("ANONIMIZADO");
      expect(ordRow.rows[0]?.customerPhoneE164).toBeNull();
      expect(ordRow.rows[0]?.foodAmountCop).toBe(42000);
      expect(ordRow.rows[0]?.deliveryFeeCop).toBe(7000);
    } finally {
      await db.end();
    }
  });
});
