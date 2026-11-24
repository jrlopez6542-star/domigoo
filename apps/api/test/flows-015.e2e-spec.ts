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
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const documentTypes = [
  "NATIONAL_ID",
  "DRIVER_LICENSE",
  "SOAT",
  "TECH_INSPECTION",
  "VEHICLE_PHOTO",
  "PROFILE_PHOTO",
] as const;

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

function sessionCookie(headers: Record<string, unknown>): string {
  const raw = headers["set-cookie"];
  const first = Array.isArray(raw) ? String(raw[0] ?? "") : "";
  expect(first).toContain("domigoo_session=");
  return first;
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

async function registerSuperadmin(pool: Pool, email: string): Promise<string> {
  const res = await request(server())
    .post("/v1/auth/register")
    .send({
      email,
      password,
      client: "ADMIN",
      consents: { termsAccepted: true, privacyAccepted: true },
    })
    .expect(201);
  const cookie = sessionCookie(res.headers);
  await pool.query(
    `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
     SELECT id, 'Admin 015', 'SUPERADMIN', now(), now()
     FROM users WHERE email = $1`,
    [email],
  );
  return cookie;
}

async function seedTariffAndPolicy(pool: Pool): Promise<void> {
  await pool.query(`UPDATE tariff_versions SET status = 'RETIRED' WHERE status = 'PUBLISHED'`);
  const tv = await pool.query<{ id: string }>(
    `INSERT INTO tariff_versions (id, name, status, "publishedAt", "createdAt")
     VALUES (gen_random_uuid(), 'Tarifa 015', 'PUBLISHED', now(), now())
     RETURNING id`,
  );
  await pool.query(
    `INSERT INTO tariff_rules (
       id, "versionId", "zoneId", "baseFeeCop", "perKmCop", "minimumFeeCop",
       "nightMultiplierBps", "nightStartsMinute", "nightEndsMinute"
     ) VALUES (gen_random_uuid(), $1, NULL, 5500, 0, 0, 10000, 0, 0)`,
    [tv.rows[0]?.id],
  );
  await pool.query(`UPDATE operations_policies SET status = 'RETIRED' WHERE status = 'PUBLISHED'`);
  await pool.query(
    `INSERT INTO operations_policies (
       id, name, status, "offerRadiusMeters", "directOfferTtlSeconds", "openOfferTtlSeconds",
       "seekingTtlSeconds", "maxOffersPerWave", "locationFreshnessSeconds", "publishedAt", "createdAt"
     ) VALUES (
       gen_random_uuid(), 'Politica 015', 'PUBLISHED', 3000, 120, 120, 600, 4, 120, now(), now()
     )`,
  );
}

describe("ofertas de domiciliario suspendido y nota en acknowledge (ORDEN 015)", () => {
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

  it("oculta ofertas PENDING en GET /v1/offers/available cuando un admin suspende al domiciliario tras publicación DIRECT", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await seedTariffAndPolicy(pool);
      const adminCookie = await registerSuperadmin(pool, "admin-offers-015@example.invalid");

      const docLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "DOCUMENT_PROCESSING", version: "2026-015-doc", content: "Doc 015" })
        .expect(201);
      const gpsLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "GEOLOCATION_CONSENT", version: "2026-015-gps", content: "GPS 015" })
        .expect(201);

      const ownerRes = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "owner-offers-015@example.invalid",
          password,
          client: "WEB",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const ownerCookie = sessionCookie(ownerRes.headers);

      const site = await request(server())
        .post("/v1/restaurants")
        .set("Cookie", ownerCookie)
        .send({
          legalName: "Razon 015",
          tradeName: "Comercio 015",
          nit: "900000150",
          email: "local-015@example.invalid",
          phoneE164: "+573001110150",
          establishmentName: "Sede 015",
          branchName: "Principal",
          addressLine: "Calle 15 # 4-20",
          longitude: -73.9132,
          latitude: 4.9655,
        })
        .expect(201);
      const restaurantId = String(record(site.body)["id"]);
      const branchId = String(record(site.body)["branchId"]);

      await request(server())
        .put(`/v1/branches/${branchId}/hours`)
        .set("Cookie", ownerCookie)
        .send({ slots: [{ weekday: 1, opensMinute: 480, closesMinute: 1200 }] })
        .expect(200);
      await request(server())
        .post(`/v1/branches/${branchId}/activate`)
        .set("Cookie", ownerCookie)
        .expect(201);
      await request(server())
        .post(`/v1/restaurants/${restaurantId}/submit`)
        .set("Cookie", ownerCookie)
        .expect(201);
      await request(server())
        .post(`/v1/admin/restaurants/${restaurantId}/activate`)
        .set("Cookie", adminCookie)
        .expect(201);

      const plan = await pool.query<{ id: string }>(
        `INSERT INTO subscription_plans (
           id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders"
         ) VALUES (gen_random_uuid(), 'PLAN_015_OFFERS', 'Plan 015', 99000, 30, 14, 2, 10)
         RETURNING id`,
      );
      await pool.query(
        `INSERT INTO restaurant_subscriptions (
           id, "restaurantId", "planId", "priceCop", status, "isCurrent", "periodStartsAt", "periodEndsAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), $1, $2, 99000, 'TRIAL', true, now() - interval '1 day', now() + interval '13 days', now()
         )`,
        [restaurantId, plan.rows[0]?.id],
      );

      const courierReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "courier-offers-015@example.invalid",
          password,
          client: "MOBILE",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const courierToken = String(record(courierReg.body)["token"]);

      await request(server())
        .post("/v1/consents")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({
          legalDocumentId: record(docLegal.body)["id"],
          purpose: "DOCUMENT_STORAGE",
          channel: "MOBILE",
        })
        .expect(201);
      const created = await request(server())
        .post("/v1/couriers")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({
          documentType: "CC",
          documentNumber: "9000150001",
          firstName: "Camilo",
          lastName: "Prueba",
        })
        .expect(201);
      const courierId = String(record(created.body)["id"]);

      for (const type of documentTypes) {
        await request(server())
          .post("/v1/couriers/me/documents")
          .set("Authorization", `Bearer ${courierToken}`)
          .field("type", type)
          .attach("file", pdf, { filename: "sintetico.pdf", contentType: "application/pdf" })
          .expect(201);
      }
      await request(server())
        .post("/v1/couriers/me/vehicle")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ plate: "D015A1", soatExpiresOn: "2028-04-01", techExpiresOn: "2028-08-01" })
        .expect(201);
      const vCase = await request(server())
        .post("/v1/couriers/me/verification-cases")
        .set("Authorization", `Bearer ${courierToken}`)
        .expect(201);
      await request(server())
        .post(`/v1/admin/verification-cases/${String(record(vCase.body)["id"])}/decision`)
        .set("Cookie", adminCookie)
        .send({ outcome: "APPROVED", reasonCode: "DOCS_VERIFIED", comment: "Aprobado 015" })
        .expect(201);

      await request(server())
        .post("/v1/consents")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({
          legalDocumentId: record(gpsLegal.body)["id"],
          purpose: "GEOLOCATION",
          channel: "MOBILE",
        })
        .expect(201);
      await request(server())
        .post("/v1/couriers/me/availability")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ state: "AVAILABLE" })
        .expect(201);
      await request(server())
        .post("/v1/couriers/me/location")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ longitude: -73.9135, latitude: 4.9658, accuracyM: 10 })
        .expect(201);

      const draft = await request(server())
        .post("/v1/orders")
        .set("Cookie", ownerCookie)
        .send({
          branchId,
          foodAmountCop: 32000,
          deliveryFeeCop: 5500,
          paymentMethod: "CASH",
        })
        .expect(201);
      const orderId = String(record(draft.body)["id"]);

      await request(server())
        .post(`/v1/orders/${orderId}/publish`)
        .set("Cookie", ownerCookie)
        .send({
          mode: "DIRECT",
          courierId,
          customerName: "Cliente 015",
          customerPhone: "+573001110159",
          dropoffAddress: "Carrera 8 # 11-20",
          longitude: -73.92,
          latitude: 4.97,
        })
        .expect(201);

      const beforeSuspend = await request(server())
        .get("/v1/offers/available")
        .set("Authorization", `Bearer ${courierToken}`)
        .expect(200);
      const offersBefore = record(beforeSuspend.body)["offers"] as unknown[];
      expect(offersBefore).toHaveLength(1);
      expect(record(offersBefore[0])["orderId"]).toBe(orderId);

      await request(server())
        .post(`/v1/admin/couriers/${courierId}/suspend`)
        .set("Cookie", adminCookie)
        .send({ reason: "Suspensión 015" })
        .expect(201);

      const afterSuspend = await request(server())
        .get("/v1/offers/available")
        .set("Authorization", `Bearer ${courierToken}`)
        .expect(200);
      expect(afterSuspend.body).toEqual({ offers: [] });
    } finally {
      await pool.end();
    }
  });

  it("persiste note en audit_logs.reason en acknowledge, valida note inválida con 422 y mantiene 201 sin body", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const adminCookie = await registerSuperadmin(pool, "admin-ack-015@example.invalid");

      const ownerRes = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "owner-ack-015@example.invalid",
          password,
          client: "WEB",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const ownerCookie = sessionCookie(ownerRes.headers);

      const site = await request(server())
        .post("/v1/restaurants")
        .set("Cookie", ownerCookie)
        .send({
          legalName: "Razon Ack 015",
          tradeName: "Comercio Ack 015",
          nit: "900000151",
          email: "local-ack-015@example.invalid",
          phoneE164: "+573001110151",
          establishmentName: "Sede Ack 015",
          branchName: "Principal",
          addressLine: "Calle 16 # 3-10",
          longitude: -73.9132,
          latitude: 4.9655,
        })
        .expect(201);
      const restaurantId = String(record(site.body)["id"]);

      const planRes = await request(server())
        .post("/v1/admin/plans")
        .set("Cookie", adminCookie)
        .send({
          code: "PLAN_ACK_015",
          name: "Mensual 015",
          priceCop: 45000,
          periodDays: 30,
          trialDays: 7,
          maxBranches: 1,
          maxConcurrentOrders: 5,
        })
        .expect(201);
      await request(server())
        .post("/v1/admin/subscriptions")
        .set("Cookie", adminCookie)
        .send({
          restaurantId,
          planId: String(record(planRes.body)["id"]),
          status: "TRIAL",
        })
        .expect(201);

      const decl1 = await request(server())
        .post(`/v1/restaurants/${restaurantId}/subscription/declarations`)
        .set("Cookie", ownerCookie)
        .send({ amountCop: 45000, method: "TRANSFER", reference: "COMP-015-1" })
        .expect(201);
      const decl1Id = String(record(decl1.body)["id"]);

      await request(server())
        .post(`/v1/admin/declarations/${decl1Id}/acknowledge`)
        .set("Cookie", adminCookie)
        .send({ note: 12345 })
        .expect(422);

      await request(server())
        .post(`/v1/admin/declarations/${decl1Id}/acknowledge`)
        .set("Cookie", adminCookie)
        .send({ note: "N".repeat(201) })
        .expect(422);

      const ack1 = await request(server())
        .post(`/v1/admin/declarations/${decl1Id}/acknowledge`)
        .set("Cookie", adminCookie)
        .send({ note: "  Revision soporte ref 9915  " })
        .expect(201);
      expect(ack1.body).toEqual({ acknowledged: true });

      const audit1 = await pool.query<{ reason: string | null }>(
        `SELECT reason FROM audit_logs
         WHERE action = 'subscription.payment_acknowledged' AND "entityId" = $1`,
        [decl1Id],
      );
      expect(audit1.rows[0]?.reason).toBe("Revision soporte ref 9915");

      const decl2 = await request(server())
        .post(`/v1/restaurants/${restaurantId}/subscription/declarations`)
        .set("Cookie", ownerCookie)
        .send({ amountCop: 45000, method: "TRANSFER", reference: "COMP-015-2" })
        .expect(201);
      const decl2Id = String(record(decl2.body)["id"]);

      const ack2 = await request(server())
        .post(`/v1/admin/declarations/${decl2Id}/acknowledge`)
        .set("Cookie", adminCookie)
        .expect(201);
      expect(ack2.body).toEqual({ acknowledged: true });

      const audit2 = await pool.query<{ reason: string | null }>(
        `SELECT reason FROM audit_logs
         WHERE action = 'subscription.payment_acknowledged' AND "entityId" = $1`,
        [decl2Id],
      );
      expect(audit2.rows[0]?.reason).toBeNull();
    } finally {
      await pool.end();
    }
  });
});
