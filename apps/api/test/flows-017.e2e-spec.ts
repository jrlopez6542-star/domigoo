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
     SELECT id, 'Admin 017', 'SUPERADMIN', now(), now()
     FROM users WHERE email = $1`,
    [email],
  );
  return cookie;
}

async function seedTariffAndPolicy(pool: Pool): Promise<void> {
  await pool.query(`UPDATE tariff_versions SET status = 'RETIRED' WHERE status = 'PUBLISHED'`);
  const tv = await pool.query<{ id: string }>(
    `INSERT INTO tariff_versions (id, name, status, "publishedAt", "createdAt")
     VALUES (gen_random_uuid(), 'Tarifa 017', 'PUBLISHED', now(), now())
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
       gen_random_uuid(), 'Politica 017', 'PUBLISHED', 3000, 120, 120, 600, 4, 120, now(), now()
     )`,
  );
}

async function seedTrialSubscription(
  pool: Pool,
  restaurantId: string,
  code: string,
): Promise<void> {
  const plan = await pool.query<{ id: string }>(
    `INSERT INTO subscription_plans (
       id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders"
     ) VALUES (gen_random_uuid(), $1, 'Plan 017', 99000, 30, 14, 2, 10)
     RETURNING id`,
    [code],
  );
  await pool.query(
    `INSERT INTO restaurant_subscriptions (
       id, "restaurantId", "planId", "priceCop", status, "isCurrent", "periodStartsAt", "periodEndsAt", "updatedAt"
     ) VALUES (
       gen_random_uuid(), $1, $2, 99000, 'TRIAL', true, now() - interval '1 day', now() + interval '13 days', now()
     )`,
    [restaurantId, plan.rows[0]?.id],
  );
}

async function onboardApprovedCourier(input: {
  adminCookie: string;
  docLegalId: string;
  gpsLegalId: string;
  email: string;
  documentNumber: string;
  firstName: string;
  plate: string;
}): Promise<{ courierId: string; courierToken: string }> {
  const reg = await request(server())
    .post("/v1/auth/register")
    .send({
      email: input.email,
      password,
      client: "MOBILE",
      consents: { termsAccepted: true, privacyAccepted: true },
    })
    .expect(201);
  const courierToken = String(record(reg.body)["token"]);

  await request(server())
    .post("/v1/consents")
    .set("Authorization", `Bearer ${courierToken}`)
    .send({
      legalDocumentId: input.docLegalId,
      purpose: "DOCUMENT_STORAGE",
      channel: "MOBILE",
    })
    .expect(201);

  const created = await request(server())
    .post("/v1/couriers")
    .set("Authorization", `Bearer ${courierToken}`)
    .send({
      documentType: "CC",
      documentNumber: input.documentNumber,
      firstName: input.firstName,
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
    .send({ plate: input.plate, soatExpiresOn: "2028-04-01", techExpiresOn: "2028-08-01" })
    .expect(201);

  const vCase = await request(server())
    .post("/v1/couriers/me/verification-cases")
    .set("Authorization", `Bearer ${courierToken}`)
    .expect(201);

  await request(server())
    .post(`/v1/admin/verification-cases/${String(record(vCase.body)["id"])}/decision`)
    .set("Cookie", input.adminCookie)
    .send({ outcome: "APPROVED", reasonCode: "DOCS_VERIFIED", comment: "Aprobado 017" })
    .expect(201);

  await request(server())
    .post("/v1/consents")
    .set("Authorization", `Bearer ${courierToken}`)
    .send({
      legalDocumentId: input.gpsLegalId,
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

  return { courierId, courierToken };
}

describe("compuerta ACTIVE+ACTIVE y cancelación de ofertas PENDING al suspender domiciliario (ORDEN 017)", () => {
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

  it("solo permite crear y publicar pedidos cuando restaurante y sucursal están ACTIVE (onboarding real por API)", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await seedTariffAndPolicy(pool);
      const adminCookie = await registerSuperadmin(pool, "admin-gate-017@example.invalid");

      const docLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "DOCUMENT_PROCESSING", version: "2026-017-doc-a", content: "Doc 017 A" })
        .expect(201);
      const gpsLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "GEOLOCATION_CONSENT", version: "2026-017-gps-a", content: "GPS 017 A" })
        .expect(201);

      const ownerRes = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "owner-gate-017@example.invalid",
          password,
          client: "WEB",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const ownerCookie = sessionCookie(ownerRes.headers);

      // 1) Restaurante DRAFT + sucursal DRAFT -> 404
      const site = await request(server())
        .post("/v1/restaurants")
        .set("Cookie", ownerCookie)
        .send({
          legalName: "Razon Gate 017",
          tradeName: "Comercio Gate 017",
          nit: "900000171",
          email: "local-gate-017@example.invalid",
          phoneE164: "+573001110171",
          establishmentName: "Sede Gate 017",
          branchName: "Principal",
          addressLine: "Calle 17 # 4-10",
          longitude: -73.9132,
          latitude: 4.9655,
        })
        .expect(201);
      const restaurantId = String(record(site.body)["id"]);
      const branchId = String(record(site.body)["branchId"]);

      const draftPayload = {
        branchId,
        foodAmountCop: 28000,
        deliveryFeeCop: 5500,
        paymentMethod: "CASH",
      };

      await request(server())
        .post("/v1/orders")
        .set("Cookie", ownerCookie)
        .send(draftPayload)
        .expect(404);

      // 2) Horarios + activar sucursal -> restaurante DRAFT + sucursal ACTIVE -> 404
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
        .post("/v1/orders")
        .set("Cookie", ownerCookie)
        .send(draftPayload)
        .expect(404);

      // 3) Submit restaurante -> PENDING_REVIEW + sucursal ACTIVE -> 404
      await request(server())
        .post(`/v1/restaurants/${restaurantId}/submit`)
        .set("Cookie", ownerCookie)
        .expect(201);
      await request(server())
        .post("/v1/orders")
        .set("Cookie", ownerCookie)
        .send(draftPayload)
        .expect(404);

      // 4) Admin activa restaurante -> ACTIVE + ACTIVE -> 201
      await request(server())
        .post(`/v1/admin/restaurants/${restaurantId}/activate`)
        .set("Cookie", adminCookie)
        .expect(201);
      const createdActive = await request(server())
        .post("/v1/orders")
        .set("Cookie", ownerCookie)
        .send(draftPayload)
        .expect(201);
      expect(record(createdActive.body)["status"]).toBe("DRAFT");

      // 5) Restaurante ACTIVE con sucursal DRAFT, PAUSED o CLOSED -> 404
      for (const branchStatus of ["DRAFT", "PAUSED", "CLOSED"] as const) {
        await pool.query(
          `UPDATE branches SET status = $2::"BranchStatus", "updatedAt" = now() WHERE id = $1`,
          [branchId, branchStatus],
        );
        await request(server())
          .post("/v1/orders")
          .set("Cookie", ownerCookie)
          .send(draftPayload)
          .expect(404);
      }
      await pool.query(`UPDATE branches SET status = 'ACTIVE', "updatedAt" = now() WHERE id = $1`, [
        branchId,
      ]);

      // 6) Restaurante SUSPENDED y CLOSED (con sucursal ACTIVE) -> 404
      await request(server())
        .post(`/v1/admin/restaurants/${restaurantId}/suspend`)
        .set("Cookie", adminCookie)
        .send({ reason: "Suspensión gate 017" })
        .expect(201);
      await request(server())
        .post("/v1/orders")
        .set("Cookie", ownerCookie)
        .send(draftPayload)
        .expect(404);

      await pool.query(
        `UPDATE restaurants SET status = 'CLOSED', "updatedAt" = now() WHERE id = $1`,
        [restaurantId],
      );
      await request(server())
        .post("/v1/orders")
        .set("Cookie", ownerCookie)
        .send(draftPayload)
        .expect(404);

      // CLOSED no es reinstalable por API (reinstate solo desde SUSPENDED -> 409):
      // fixture vuelve a SUSPENDED y se rehabilita por el endpoint real.
      await pool.query(
        `UPDATE restaurants SET status = 'SUSPENDED', "updatedAt" = now() WHERE id = $1`,
        [restaurantId],
      );
      // Rehabilitar a ACTIVE para probar compuerta de publish (DIRECT y OPEN)
      await request(server())
        .post(`/v1/admin/restaurants/${restaurantId}/reinstate`)
        .set("Cookie", adminCookie)
        .send({ reason: "Rehabilitado gate 017" })
        .expect(201);

      await seedTrialSubscription(pool, restaurantId, "PLAN_017_GATE");
      const { courierId } = await onboardApprovedCourier({
        adminCookie,
        docLegalId: String(record(docLegal.body)["id"]),
        gpsLegalId: String(record(gpsLegal.body)["id"]),
        email: "courier-gate-017@example.invalid",
        documentNumber: "9000170001",
        firstName: "Mateo",
        plate: "D017A1",
      });

      const draftDirectRes = await request(server())
        .post("/v1/orders")
        .set("Cookie", ownerCookie)
        .send(draftPayload)
        .expect(201);
      const draftDirectId = String(record(draftDirectRes.body)["id"]);

      const draftOpenRes = await request(server())
        .post("/v1/orders")
        .set("Cookie", ownerCookie)
        .send(draftPayload)
        .expect(201);
      const draftOpenId = String(record(draftOpenRes.body)["id"]);

      const directPublishBody = {
        mode: "DIRECT",
        courierId,
        customerName: "Cliente Directo 017",
        customerPhone: "+573001110178",
        dropoffAddress: "Carrera 7 # 12-10",
        longitude: -73.92,
        latitude: 4.97,
      };
      const openPublishBody = {
        mode: "OPEN",
        customerName: "Cliente Abierto 017",
        customerPhone: "+573001110179",
        dropoffAddress: "Carrera 7 # 12-20",
        longitude: -73.92,
        latitude: 4.97,
      };

      // Restaurante SUSPENDED bloquea publish DIRECT y OPEN con 404 y deja pedidos en DRAFT
      await request(server())
        .post(`/v1/admin/restaurants/${restaurantId}/suspend`)
        .set("Cookie", adminCookie)
        .send({ reason: "Suspensión antes de publicar" })
        .expect(201);

      await request(server())
        .post(`/v1/orders/${draftDirectId}/publish`)
        .set("Cookie", ownerCookie)
        .send(directPublishBody)
        .expect(404);
      await request(server())
        .post(`/v1/orders/${draftOpenId}/publish`)
        .set("Cookie", ownerCookie)
        .send(openPublishBody)
        .expect(404);

      const afterRestSuspend = await pool.query<{ id: string; status: string }>(
        `SELECT id, status::text AS status FROM orders WHERE id = ANY($1::uuid[])`,
        [[draftDirectId, draftOpenId]],
      );
      expect(afterRestSuspend.rows.map((r) => r.status)).toEqual(["DRAFT", "DRAFT"]);

      // Restaurante ACTIVE pero sucursal PAUSED bloquea publish DIRECT y OPEN con 404 y deja pedidos en DRAFT
      await request(server())
        .post(`/v1/admin/restaurants/${restaurantId}/reinstate`)
        .set("Cookie", adminCookie)
        .send({ reason: "Rehabilitado para probar sucursal pausada" })
        .expect(201);
      await pool.query(`UPDATE branches SET status = 'PAUSED', "updatedAt" = now() WHERE id = $1`, [
        branchId,
      ]);

      await request(server())
        .post(`/v1/orders/${draftDirectId}/publish`)
        .set("Cookie", ownerCookie)
        .send(directPublishBody)
        .expect(404);
      await request(server())
        .post(`/v1/orders/${draftOpenId}/publish`)
        .set("Cookie", ownerCookie)
        .send(openPublishBody)
        .expect(404);

      const afterBranchPause = await pool.query<{ id: string; status: string }>(
        `SELECT id, status::text AS status FROM orders WHERE id = ANY($1::uuid[])`,
        [[draftDirectId, draftOpenId]],
      );
      expect(afterBranchPause.rows.map((r) => r.status)).toEqual(["DRAFT", "DRAFT"]);

      // Al reactivar la sucursal a ACTIVE, ambos borradores publican en 201
      await pool.query(`UPDATE branches SET status = 'ACTIVE', "updatedAt" = now() WHERE id = $1`, [
        branchId,
      ]);
      const pubDirect = await request(server())
        .post(`/v1/orders/${draftDirectId}/publish`)
        .set("Cookie", ownerCookie)
        .send(directPublishBody)
        .expect(201);
      expect(record(pubDirect.body)["status"]).toBe("SEEKING_COURIER");

      const pubOpen = await request(server())
        .post(`/v1/orders/${draftOpenId}/publish`)
        .set("Cookie", ownerCookie)
        .send(openPublishBody)
        .expect(201);
      expect(record(pubOpen.body)["status"]).toBe("SEEKING_COURIER");
    } finally {
      await pool.end();
    }
  });

  it("cancela ofertas PENDING DIRECT y OPEN al suspender domiciliario, impide aceptarlas incluso tras reinstate y no altera pedidos ACCEPTED", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await seedTariffAndPolicy(pool);
      const adminCookie = await registerSuperadmin(pool, "admin-offers-017@example.invalid");

      const docLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "DOCUMENT_PROCESSING", version: "2026-017-doc-b", content: "Doc 017 B" })
        .expect(201);
      const gpsLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "GEOLOCATION_CONSENT", version: "2026-017-gps-b", content: "GPS 017 B" })
        .expect(201);

      const ownerRes = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "owner-offers-017@example.invalid",
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
          legalName: "Razon Ofertas 017",
          tradeName: "Comercio Ofertas 017",
          nit: "900000172",
          email: "local-offers-017@example.invalid",
          phoneE164: "+573001110172",
          establishmentName: "Sede Ofertas 017",
          branchName: "Principal",
          addressLine: "Calle 17 # 5-15",
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
      await seedTrialSubscription(pool, restaurantId, "PLAN_017_OFFERS");

      const courier1 = await onboardApprovedCourier({
        adminCookie,
        docLegalId: String(record(docLegal.body)["id"]),
        gpsLegalId: String(record(gpsLegal.body)["id"]),
        email: "courier1-017@example.invalid",
        documentNumber: "9000170011",
        firstName: "Camilo",
        plate: "D017B1",
      });

      const draftDirect = await request(server())
        .post("/v1/orders")
        .set("Cookie", ownerCookie)
        .send({
          branchId,
          foodAmountCop: 30000,
          deliveryFeeCop: 5500,
          paymentMethod: "CASH",
        })
        .expect(201);
      const orderDirectId = String(record(draftDirect.body)["id"]);

      const pubDirect = await request(server())
        .post(`/v1/orders/${orderDirectId}/publish`)
        .set("Cookie", ownerCookie)
        .send({
          mode: "DIRECT",
          courierId: courier1.courierId,
          customerName: "Cliente Direct 017",
          customerPhone: "+573001110173",
          dropoffAddress: "Carrera 8 # 10-10",
          longitude: -73.92,
          latitude: 4.97,
        })
        .expect(201);
      const offerDirectId = String(record(record(pubDirect.body)["offer"])["id"]);

      const draftOpen = await request(server())
        .post("/v1/orders")
        .set("Cookie", ownerCookie)
        .send({
          branchId,
          foodAmountCop: 24000,
          deliveryFeeCop: 5500,
          paymentMethod: "NEQUI",
        })
        .expect(201);
      const orderOpenId = String(record(draftOpen.body)["id"]);

      const pubOpen = await request(server())
        .post(`/v1/orders/${orderOpenId}/publish`)
        .set("Cookie", ownerCookie)
        .send({
          mode: "OPEN",
          customerName: "Cliente Open 017",
          customerPhone: "+573001110174",
          dropoffAddress: "Carrera 8 # 10-20",
          longitude: -73.92,
          latitude: 4.97,
        })
        .expect(201);
      const openOffers = record(pubOpen.body)["offers"] as unknown[];
      expect(openOffers).toHaveLength(1);
      const offerOpenId = String(record(openOffers[0])["id"]);

      const availableBefore = await request(server())
        .get("/v1/offers/available")
        .set("Authorization", `Bearer ${courier1.courierToken}`)
        .expect(200);
      const beforeIds = (record(availableBefore.body)["offers"] as unknown[])
        .map((item) => String(record(item)["offerId"]))
        .sort();
      expect(beforeIds).toEqual([offerDirectId, offerOpenId].sort());

      // Admin suspende a courier1 -> ambas ofertas PENDING pasan a CANCELLED
      await request(server())
        .post(`/v1/admin/couriers/${courier1.courierId}/suspend`)
        .set("Cookie", adminCookie)
        .send({ reason: "Suspensión ofertas 017" })
        .expect(201);

      const offersAfterSuspend = await pool.query<{
        id: string;
        status: string;
        respondedAt: Date | null;
      }>(
        `SELECT id, status::text AS status, "respondedAt"
         FROM dispatch_offers
         WHERE id = ANY($1::uuid[])`,
        [[offerDirectId, offerOpenId]],
      );
      expect(offersAfterSuspend.rows).toHaveLength(2);
      for (const row of offersAfterSuspend.rows) {
        expect(row.status).toBe("CANCELLED");
        expect(row.respondedAt).not.toBeNull();
      }

      const ordersAfterSuspend = await pool.query<{
        id: string;
        status: string;
        assignedCourierId: string | null;
      }>(
        `SELECT id, status::text AS status, "assignedCourierId"
         FROM orders
         WHERE id = ANY($1::uuid[])`,
        [[orderDirectId, orderOpenId]],
      );
      expect(ordersAfterSuspend.rows).toHaveLength(2);
      for (const row of ordersAfterSuspend.rows) {
        expect(row.status).toBe("SEEKING_COURIER");
        expect(row.assignedCourierId).toBeNull();
      }

      const auditSuspend = await pool.query<{ diff: Record<string, unknown> }>(
        `SELECT diff
         FROM audit_logs
         WHERE action = 'courier.suspended' AND "entityId" = $1
         ORDER BY "createdAt" DESC
         LIMIT 1`,
        [courier1.courierId],
      );
      expect(auditSuspend.rows[0]?.diff["offersCancelled"]).toBe(2);

      const availableAfterSuspend = await request(server())
        .get("/v1/offers/available")
        .set("Authorization", `Bearer ${courier1.courierToken}`)
        .expect(200);
      expect(availableAfterSuspend.body).toEqual({ offers: [] });

      // Intentar aceptar o rechazar ofertas canceladas -> 409 y sin asignación
      await request(server())
        .post(`/v1/offers/${offerDirectId}/accept`)
        .set("Authorization", `Bearer ${courier1.courierToken}`)
        .set("Idempotency-Key", "017-accept-direct-suspended")
        .send({ ack: true })
        .expect(409);

      await request(server())
        .post(`/v1/offers/${offerOpenId}/accept`)
        .set("Authorization", `Bearer ${courier1.courierToken}`)
        .set("Idempotency-Key", "017-accept-open-suspended")
        .send({ ack: true })
        .expect(409);

      await request(server())
        .post(`/v1/offers/${offerDirectId}/decline`)
        .set("Authorization", `Bearer ${courier1.courierToken}`)
        .expect(409);

      const ordersStillUnassigned = await pool.query<{ assignedCourierId: string | null }>(
        `SELECT "assignedCourierId" FROM orders WHERE id = ANY($1::uuid[])`,
        [[orderDirectId, orderOpenId]],
      );
      expect(ordersStillUnassigned.rows.map((r) => r.assignedCourierId)).toEqual([null, null]);

      // Tras reinstate, las ofertas canceladas no vuelven y siguen dando 409
      await request(server())
        .post(`/v1/admin/couriers/${courier1.courierId}/reinstate`)
        .set("Cookie", adminCookie)
        .send({ reason: "Rehabilitado 017" })
        .expect(201);

      const availableAfterReinstate = await request(server())
        .get("/v1/offers/available")
        .set("Authorization", `Bearer ${courier1.courierToken}`)
        .expect(200);
      expect(availableAfterReinstate.body).toEqual({ offers: [] });

      await request(server())
        .post("/v1/couriers/me/availability")
        .set("Authorization", `Bearer ${courier1.courierToken}`)
        .send({ state: "AVAILABLE" })
        .expect(201);

      await request(server())
        .post(`/v1/offers/${offerDirectId}/accept`)
        .set("Authorization", `Bearer ${courier1.courierToken}`)
        .set("Idempotency-Key", "017-accept-direct-after-reinstate")
        .send({ ack: true })
        .expect(409);

      const orderDirectCheck = await pool.query<{ assignedCourierId: string | null }>(
        `SELECT "assignedCourierId" FROM orders WHERE id = $1`,
        [orderDirectId],
      );
      expect(orderDirectCheck.rows[0]?.assignedCourierId).toBeNull();

      // Un pedido ACCEPTED antes de la suspensión permanece intacto
      const courier2 = await onboardApprovedCourier({
        adminCookie,
        docLegalId: String(record(docLegal.body)["id"]),
        gpsLegalId: String(record(gpsLegal.body)["id"]),
        email: "courier2-017@example.invalid",
        documentNumber: "9000170012",
        firstName: "Andres",
        plate: "D017B2",
      });

      const draftAccepted = await request(server())
        .post("/v1/orders")
        .set("Cookie", ownerCookie)
        .send({
          branchId,
          foodAmountCop: 36000,
          deliveryFeeCop: 5500,
          paymentMethod: "CASH",
        })
        .expect(201);
      const orderAcceptedId = String(record(draftAccepted.body)["id"]);

      const pubAccepted = await request(server())
        .post(`/v1/orders/${orderAcceptedId}/publish`)
        .set("Cookie", ownerCookie)
        .send({
          mode: "DIRECT",
          courierId: courier2.courierId,
          customerName: "Cliente Aceptado 017",
          customerPhone: "+573001110175",
          dropoffAddress: "Carrera 9 # 14-05",
          longitude: -73.92,
          latitude: 4.97,
        })
        .expect(201);
      const offerAcceptedId = String(record(record(pubAccepted.body)["offer"])["id"]);

      const acceptedRes = await request(server())
        .post(`/v1/offers/${offerAcceptedId}/accept`)
        .set("Authorization", `Bearer ${courier2.courierToken}`)
        .set("Idempotency-Key", "017-accept-courier2")
        .send({ ack: true })
        .expect(201);
      expect(record(acceptedRes.body)["offerStatus"]).toBe("ACCEPTED");
      expect(record(acceptedRes.body)["orderStatus"]).toBe("ACCEPTED");

      await request(server())
        .post(`/v1/admin/couriers/${courier2.courierId}/suspend`)
        .set("Cookie", adminCookie)
        .send({ reason: "Suspensión tras aceptar 017" })
        .expect(201);

      const acceptedOrderRow = await pool.query<{
        status: string;
        assignedCourierId: string | null;
      }>(`SELECT status::text AS status, "assignedCourierId" FROM orders WHERE id = $1`, [
        orderAcceptedId,
      ]);
      expect(acceptedOrderRow.rows[0]).toEqual({
        status: "ACCEPTED",
        assignedCourierId: courier2.courierId,
      });

      const acceptedOfferRow = await pool.query<{ status: string }>(
        `SELECT status::text AS status FROM dispatch_offers WHERE id = $1`,
        [offerAcceptedId],
      );
      expect(acceptedOfferRow.rows[0]?.status).toBe("ACCEPTED");

      const auditCourier2 = await pool.query<{ diff: Record<string, unknown> }>(
        `SELECT diff
         FROM audit_logs
         WHERE action = 'courier.suspended' AND "entityId" = $1
         ORDER BY "createdAt" DESC
         LIMIT 1`,
        [courier2.courierId],
      );
      expect(auditCourier2.rows[0]?.diff["offersCancelled"]).toBe(0);
    } finally {
      await pool.end();
    }
  });
});
