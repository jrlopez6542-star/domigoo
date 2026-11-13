import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, readEnv, type AppEnv } from "../src/config/env.js";
import { applyHttpSecurity } from "../src/http.js";
import { resetLoginThrottle } from "../src/identity/login-throttle.js";
import { OutboxRepository } from "../src/notifications/outbox.repository.js";
import { PUSH_SENDER, RecordingPushSender } from "../src/notifications/push-sender.port.js";
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
];

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

describe("recorrido de punta a punta (M38)", () => {
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

  it("completa el flujo de punta a punta: suscripción, domiciliario aprobado, oferta abierta, recorrido, ambos PIN y tracking", async () => {
    const ownerRes = await request(server())
      .post("/v1/auth/register")
      .send({ email: "owner-m38@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const owner = String(record(ownerRes.body)["token"]);

    const reviewerRes = await request(server())
      .post("/v1/auth/register")
      .send({ email: "reviewer-m38@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const reviewer = String(record(reviewerRes.body)["token"]);

    const courierRes = await request(server())
      .post("/v1/auth/register")
      .send({ email: "courier-m38@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const courier = String(record(courierRes.body)["token"]);

    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query(
        `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
         SELECT id, 'Revisor M38', 'REVIEWER', now(), now()
         FROM users WHERE email = 'reviewer-m38@example.invalid'`,
      );
      await pool.query(`UPDATE tariff_versions SET status = 'RETIRED' WHERE status = 'PUBLISHED'`);
      const tv = await pool.query<{ id: string }>(
        `INSERT INTO tariff_versions (id, name, status, "publishedAt", "createdAt")
         VALUES (gen_random_uuid(), 'Tarifa M38', 'PUBLISHED', now(), now())
         RETURNING id`,
      );
      await pool.query(
        `INSERT INTO tariff_rules (
           id, "versionId", "zoneId", "baseFeeCop", "perKmCop", "minimumFeeCop",
           "nightMultiplierBps", "nightStartsMinute", "nightEndsMinute"
         ) VALUES (gen_random_uuid(), $1, NULL, 5500, 0, 0, 10000, 0, 0)`,
        [tv.rows[0]?.id],
      );
      await pool.query(
        `UPDATE operations_policies SET status = 'RETIRED' WHERE status = 'PUBLISHED'`,
      );
      await pool.query(
        `INSERT INTO operations_policies (
           id, name, status, "offerRadiusMeters", "directOfferTtlSeconds", "openOfferTtlSeconds",
           "seekingTtlSeconds", "maxOffersPerWave", "locationFreshnessSeconds", "publishedAt", "createdAt"
         ) VALUES (
           gen_random_uuid(), 'Politica M38', 'PUBLISHED', 2000, 120, 120, 600, 2, 120, now(), now()
         )`,
      );

      // Documentos legales y aprobación del domiciliario
      const docLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Authorization", `Bearer ${reviewer}`)
        .send({ kind: "DOCUMENT_PROCESSING", version: "2026-m38-doc", content: "Doc M38" })
        .expect(201);
      const gpsLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Authorization", `Bearer ${reviewer}`)
        .send({ kind: "GEOLOCATION_CONSENT", version: "2026-m38-gps", content: "GPS M38" })
        .expect(201);

      await request(server())
        .post("/v1/consents")
        .set("Authorization", `Bearer ${courier}`)
        .send({
          legalDocumentId: record(docLegal.body)["id"],
          purpose: "DOCUMENT_STORAGE",
          channel: "MOBILE",
        })
        .expect(201);
      await request(server())
        .post("/v1/couriers")
        .set("Authorization", `Bearer ${courier}`)
        .send({
          documentType: "CC",
          documentNumber: "9000038001",
          firstName: "Mateo",
          lastName: "Prueba",
        })
        .expect(201);
      for (const type of documentTypes) {
        await request(server())
          .post("/v1/couriers/me/documents")
          .set("Authorization", `Bearer ${courier}`)
          .field("type", type)
          .attach("file", pdf, { filename: "sintetico.pdf", contentType: "application/pdf" })
          .expect(201);
      }
      await request(server())
        .post("/v1/couriers/me/vehicle")
        .set("Authorization", `Bearer ${courier}`)
        .send({ plate: "M38A01", soatExpiresOn: "2028-04-01", techExpiresOn: "2028-08-01" })
        .expect(201);
      const vCase = await request(server())
        .post("/v1/couriers/me/verification-cases")
        .set("Authorization", `Bearer ${courier}`)
        .expect(201);
      await request(server())
        .post(`/v1/admin/verification-cases/${String(record(vCase.body)["id"])}/decision`)
        .set("Authorization", `Bearer ${reviewer}`)
        .send({ outcome: "APPROVED", reasonCode: "OK", comment: "Aprobado M38" })
        .expect(201);

      await request(server())
        .post("/v1/consents")
        .set("Authorization", `Bearer ${courier}`)
        .send({
          legalDocumentId: record(gpsLegal.body)["id"],
          purpose: "GEOLOCATION",
          channel: "MOBILE",
        })
        .expect(201);
      await request(server())
        .post("/v1/devices/push-token")
        .set("Authorization", `Bearer ${courier}`)
        .send({ token: "fcm-token-m38-sintetico-123456" })
        .expect(201);
      await request(server())
        .post("/v1/couriers/me/availability")
        .set("Authorization", `Bearer ${courier}`)
        .send({ state: "AVAILABLE" })
        .expect(201);
      await request(server())
        .post("/v1/couriers/me/location")
        .set("Authorization", `Bearer ${courier}`)
        .send({ longitude: -73.92, latitude: 4.97, accuracyM: 8 })
        .expect(201);

      // Restaurante activo con suscripción de prueba
      const site = await request(server())
        .post("/v1/restaurants")
        .set("Authorization", `Bearer ${owner}`)
        .send({
          legalName: "Razon M38",
          tradeName: "Asadero M38",
          nit: "900000380",
          email: "local-m38@example.invalid",
          phoneE164: "+573001110380",
          establishmentName: "Establecimiento M38",
          branchName: "Principal",
          addressLine: "Calle M38",
          longitude: -73.9132,
          latitude: 4.9655,
        })
        .expect(201);
      const branchId = String(record(site.body)["branchId"]);
      const restaurantId = String(record(site.body)["restaurantId"]);
      await pool.query(`UPDATE restaurants SET status = 'ACTIVE' WHERE id = $1`, [restaurantId]);
      await request(server())
        .put(`/v1/branches/${branchId}/hours`)
        .set("Authorization", `Bearer ${owner}`)
        .send({ slots: [{ weekday: 1, opensMinute: 480, closesMinute: 1200 }] })
        .expect(200);
      await request(server())
        .post(`/v1/branches/${branchId}/activate`)
        .set("Authorization", `Bearer ${owner}`)
        .expect(201);

      const plan = await pool.query<{ id: string }>(
        `INSERT INTO subscription_plans (
           id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders"
         ) VALUES (gen_random_uuid(), 'M38_PLAN', 'Plan M38', 99000, 30, 14, 2, 10)
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

      // Borrador y publicación abierta
      const draft = await request(server())
        .post("/v1/orders")
        .set("Authorization", `Bearer ${owner}`)
        .send({
          branchId,
          foodAmountCop: 45000,
          deliveryFeeCop: 5500,
          paymentMethod: "CASH",
        })
        .expect(201);
      const orderId = String(record(draft.body)["id"]);

      const pub = await request(server())
        .post(`/v1/orders/${orderId}/publish`)
        .set("Authorization", `Bearer ${owner}`)
        .send({
          mode: "OPEN",
          customerName: "Cliente M38",
          customerPhone: "+573007778899",
          dropoffAddress: "Carrera 4 # 8-12",
          longitude: -73.92,
          latitude: 4.97,
        })
        .expect(201);
      const offers = record(pub.body)["offers"] as unknown[];
      const offerId = String(record(offers[0])["id"]);

      // Push drenado con adaptador falso sin PII
      const outbox = currentApp?.get(OutboxRepository);
      const sender = currentApp?.get<RecordingPushSender>(PUSH_SENDER);
      sender?.clear();
      await outbox?.drain(new Date());
      expect(sender?.sent.length).toBeGreaterThanOrEqual(1);

      // Aceptar oferta
      await request(server())
        .post(`/v1/offers/${offerId}/accept`)
        .set("Authorization", `Bearer ${courier}`)
        .set("Idempotency-Key", "m38-accept-key")
        .send({ ack: true })
        .expect(201);

      // Emitir tracking y leer pickupPin como restaurante
      const linkRes = await request(server())
        .post(`/v1/orders/${orderId}/tracking-link`)
        .set("Authorization", `Bearer ${owner}`)
        .expect(201);
      const trackingToken = String(record(linkRes.body)["token"]);

      const restView = await request(server())
        .get(`/v1/orders/${orderId}`)
        .set("Authorization", `Bearer ${owner}`)
        .expect(200);
      const pickupPin = String(record(restView.body)["pickupPin"]);
      expect(pickupPin).toMatch(/^\d{6}$/);

      // Recorrido completo: arrive-pickup -> at-pickup -> pickup-pin -> at-dropoff -> delivery-pin
      await request(server())
        .post(`/v1/orders/${orderId}/arrive-pickup`)
        .set("Authorization", `Bearer ${courier}`)
        .expect(201);
      await request(server())
        .post(`/v1/orders/${orderId}/at-pickup`)
        .set("Authorization", `Bearer ${courier}`)
        .expect(201);
      await request(server())
        .post(`/v1/orders/${orderId}/pickup-pin`)
        .set("Authorization", `Bearer ${courier}`)
        .send({ pin: pickupPin })
        .expect(201);

      // Tracking en PICKED_UP muestra deliveryPin sin PII
      const trackPicked = await request(server()).get(`/v1/tracking/${trackingToken}`).expect(200);
      const deliveryPin = String(record(trackPicked.body)["deliveryPin"]);
      expect(deliveryPin).toMatch(/^\d{6}$/);
      expect(record(trackPicked.body)["courierFirstName"]).toBe("Mateo");

      await request(server())
        .post(`/v1/orders/${orderId}/at-dropoff`)
        .set("Authorization", `Bearer ${courier}`)
        .expect(201);
      const delivered = await request(server())
        .post(`/v1/orders/${orderId}/delivery-pin`)
        .set("Authorization", `Bearer ${courier}`)
        .send({ pin: deliveryPin })
        .expect(201);
      expect(record(delivered.body)["status"]).toBe("DELIVERED");
    } finally {
      await pool.end();
    }
  });
});
