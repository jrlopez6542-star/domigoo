import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, type AppEnv } from "../src/config/env.js";
import { testEnv } from "./test-env.js";
import { applyHttpSecurity } from "../src/http.js";
import { resetLoginThrottle } from "../src/identity/login-throttle.js";
import { setupOpenApi } from "../src/openapi.js";
import { activateRestaurantForTest } from "./activate-restaurant.js";
import { migrateDatabase } from "./migrate.js";
import { resetDatabase } from "./reset-db.js";

const databaseUrl =
  process.env["DATABASE_URL"] ?? "postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo";
const password = "clave-de-prueba-12";
const pdf = Buffer.from("%PDF-1.4\n% archivo sintetico de prueba\n%%EOF\n");
const documentTypes = [
  "NATIONAL_ID",
  "DRIVER_LICENSE",
  "SOAT",
  "TECH_INSPECTION",
  "VEHICLE_PHOTO",
  "PROFILE_PHOTO",
];
const customerName = "Cliente Sintetico";
const customerPhone = "+573009990210";

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

async function register(email: string): Promise<string> {
  const created = await request(server())
    .post("/v1/auth/register")
    .send({
      email,
      password,
      client: "MOBILE",
      consents: { termsAccepted: true, privacyAccepted: true },
    })
    .expect(201);
  return String(record(created.body)["token"]);
}

async function approveCourier(
  token: string,
  reviewer: string,
  legalDocumentId: string,
  documentNumber: string,
  plate: string,
): Promise<string> {
  await request(server())
    .post("/v1/consents")
    .set("Authorization", `Bearer ${token}`)
    .send({ legalDocumentId, purpose: "DOCUMENT_STORAGE", channel: "MOBILE" })
    .expect(201);
  const created = await request(server())
    .post("/v1/couriers")
    .set("Authorization", `Bearer ${token}`)
    .send({ documentType: "CC", documentNumber, firstName: "Persona", lastName: "Sintetica" })
    .expect(201);
  for (const type of documentTypes) {
    await request(server())
      .post("/v1/couriers/me/documents")
      .set("Authorization", `Bearer ${token}`)
      .field("type", type)
      .attach("file", pdf, { filename: "sintetico.pdf", contentType: "application/pdf" })
      .expect(201);
  }
  await request(server())
    .post("/v1/couriers/me/vehicle")
    .set("Authorization", `Bearer ${token}`)
    .send({ plate, soatExpiresOn: "2027-04-01", techExpiresOn: "2027-08-01" })
    .expect(201);
  const opened = await request(server())
    .post("/v1/couriers/me/verification-cases")
    .set("Authorization", `Bearer ${token}`)
    .expect(201);
  await request(server())
    .post(`/v1/admin/verification-cases/${String(record(opened.body)["id"])}/decision`)
    .set("Authorization", `Bearer ${reviewer}`)
    .send({
      outcome: "APPROVED",
      reasonCode: "EXPEDIENTE_OK",
      comment: "Revision humana de un expediente sintetico",
    })
    .expect(201);
  return String(record(created.body)["id"]);
}

describe("publicación directa", () => {
  beforeAll(() => {
    migrateDatabase(databaseUrl);
  });

  beforeEach(async () => {
    resetLoginThrottle();
    await resetDatabase(databaseUrl);
    currentApp = await createApp(testEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO" }));
  });

  afterEach(async () => {
    await currentApp?.close();
    currentApp = undefined;
    const pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`DELETE FROM dispatch_offers`);
    await pool.query(`DELETE FROM order_events`);
    await pool.query(`DELETE FROM notification_outbox`);
    await pool.query(`DELETE FROM tariff_quotes`);
    await pool.query(`DELETE FROM orders`);
    await pool.query(
      `DELETE FROM tariff_quotes WHERE "tariffVersionId" IN (SELECT id FROM tariff_versions WHERE name = 'Tarifa de oferta')`,
    );
    await pool.query(
      `DELETE FROM tariff_rules WHERE "versionId" IN (SELECT id FROM tariff_versions WHERE name = 'Tarifa de oferta')`,
    );
    await pool.query(`DELETE FROM tariff_versions WHERE name = 'Tarifa de oferta'`);
    await pool.query(`DELETE FROM operations_policies WHERE name = 'Politica de oferta'`);
    await pool.end();
  });

  it("congela la cotización y no ofrece a quien no tiene los documentos aceptados o está lejos", async () => {
    const owner = await register("dueno-oferta@example.invalid");
    const reviewer = await register("revisor-oferta@example.invalid");
    const nearToken = await register("cerca-oferta@example.invalid");
    const farToken = await register("lejos-oferta@example.invalid");
    const pool = new Pool({ connectionString: databaseUrl });
    const reviewerUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'revisor-oferta@example.invalid'`,
    );
    await pool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Revisor', 'REVIEWER', now(), now())`,
      [reviewerUser.rows[0]?.id],
    );
    await pool.query(`UPDATE tariff_versions SET status = 'RETIRED' WHERE status = 'PUBLISHED'`);
    const version = await pool.query<{ id: string }>(
      `INSERT INTO tariff_versions (id, name, status, "publishedAt", "createdAt")
       VALUES (gen_random_uuid(), 'Tarifa de oferta', 'PUBLISHED', now(), now())
       RETURNING id`,
    );
    await pool.query(
      `INSERT INTO tariff_rules (
         id, "versionId", "zoneId", "baseFeeCop", "perKmCop", "minimumFeeCop",
         "nightMultiplierBps", "nightStartsMinute", "nightEndsMinute"
       ) VALUES (gen_random_uuid(), $1, NULL, 5000, 0, 0, 10000, 0, 0)`,
      [version.rows[0]?.id],
    );
    await pool.query(
      `UPDATE operations_policies SET status = 'RETIRED' WHERE status = 'PUBLISHED'`,
    );
    await pool.query(
      `INSERT INTO operations_policies (
         id, name, status, "offerRadiusMeters", "directOfferTtlSeconds", "openOfferTtlSeconds",
         "seekingTtlSeconds", "maxOffersPerWave", "locationFreshnessSeconds", "publishedAt", "createdAt"
       ) VALUES (
         gen_random_uuid(), 'Politica de oferta', 'PUBLISHED', 2000, 120, 90, 600, 5, 120, now(), now()
       )`,
    );
    await pool.end();

    const documents = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${reviewer}`)
      .send({
        kind: "DOCUMENT_PROCESSING",
        version: "2026-oferta-docs",
        content: "Texto sintetico de tratamiento de documentos de prueba",
      })
      .expect(201);
    const geolocation = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${reviewer}`)
      .send({
        kind: "GEOLOCATION_CONSENT",
        version: "2026-oferta-gps",
        content: "Texto sintetico de geolocalizacion de prueba",
      })
      .expect(201);
    const legalDocumentId = String(record(documents.body)["id"]);
    const nearId = await approveCourier(
      nearToken,
      reviewer,
      legalDocumentId,
      "9000000221",
      "ABC22A",
    );
    const farId = await approveCourier(farToken, reviewer, legalDocumentId, "9000000222", "ABC22B");
    for (const [token, point] of [
      [nearToken, { longitude: -73.92, latitude: 4.97, accuracyM: 10 }],
      [farToken, { longitude: -73.9132, latitude: 5.0105, accuracyM: 10 }],
    ] as const) {
      await request(server())
        .post("/v1/consents")
        .set("Authorization", `Bearer ${token}`)
        .send({
          legalDocumentId: record(geolocation.body)["id"],
          purpose: "GEOLOCATION",
          channel: "MOBILE",
        })
        .expect(201);
      await request(server())
        .post("/v1/couriers/me/availability")
        .set("Authorization", `Bearer ${token}`)
        .send({ state: "AVAILABLE" })
        .expect(201);
      await request(server())
        .post("/v1/couriers/me/location")
        .set("Authorization", `Bearer ${token}`)
        .send(point)
        .expect(201);
    }

    const site = await request(server())
      .post("/v1/restaurants")
      .set("Authorization", `Bearer ${owner}`)
      .send({
        legalName: "Razon oferta",
        tradeName: "Local oferta",
        nit: "900000221",
        email: "local-oferta@example.invalid",
        phoneE164: "+573001110221",
        establishmentName: "Establecimiento",
        branchName: "Principal",
        addressLine: "Calle sintetica",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(201);
    const branchId = String(record(site.body)["branchId"]);
    const restaurantId = String(record(site.body)["id"]);
    const billing = new Pool({ connectionString: databaseUrl });
    const plan = await billing.query<{ id: string }>(
      `INSERT INTO subscription_plans (
         id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders", "createdAt"
       ) VALUES (gen_random_uuid(), 'oferta', 'Mensual', 45000, 30, 0, 1, 3, now())
       RETURNING id`,
    );
    await billing.query(
      `INSERT INTO restaurant_subscriptions (
         id, "restaurantId", "planId", "priceCop", status, "isCurrent",
         "periodStartsAt", "periodEndsAt", "createdAt", "updatedAt"
       ) VALUES (
         gen_random_uuid(), $1, $2, 45000, 'ACTIVE', true, now(), now() + interval '30 days', now(), now()
       )`,
      [restaurantId, plan.rows[0]?.id],
    );
    await activateRestaurantForTest(billing, restaurantId, branchId);
    await billing.end();

    const draft = await request(server())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${owner}`)
      .send({
        branchId,
        foodAmountCop: 12000,
        deliveryFeeCop: 5000,
        paymentMethod: "CASH",
      })
      .expect(201);
    const orderId = String(record(draft.body)["id"]);
    const publishBody = {
      customerName,
      customerPhone,
      dropoffAddress: "Calle sintetica 10",
      longitude: -73.9132,
      latitude: 4.9655,
    };

    const due = new Pool({ connectionString: databaseUrl });
    await due.query(
      `UPDATE restaurant_subscriptions
       SET status = 'PAST_DUE', "periodEndsAt" = now() - interval '1 minute'
       WHERE "restaurantId" = $1`,
      [restaurantId],
    );
    await due.end();
    await request(server())
      .post(`/v1/orders/${orderId}/publish`)
      .set("Authorization", `Bearer ${owner}`)
      .send({ ...publishBody, courierId: nearId })
      .expect(422);
    const restore = new Pool({ connectionString: databaseUrl });
    await restore.query(
      `UPDATE restaurant_subscriptions
       SET status = 'ACTIVE', "periodEndsAt" = now() + interval '30 days'
       WHERE "restaurantId" = $1`,
      [restaurantId],
    );
    await restore.end();

    await request(server())
      .post(`/v1/orders/${orderId}/publish`)
      .set("Authorization", `Bearer ${owner}`)
      .send({ ...publishBody, courierId: farId })
      .expect(422);

    const hidden = new Pool({ connectionString: databaseUrl });
    await hidden.query(
      `UPDATE courier_documents SET status = 'UPLOADED', "updatedAt" = now()
       WHERE "courierId" = $1 AND type = 'SOAT'`,
      [nearId],
    );
    await hidden.end();
    const withoutDocs = await request(server())
      .get(`/v1/branches/${branchId}/couriers`)
      .query({ radiusMeters: 2000 })
      .set("Authorization", `Bearer ${owner}`)
      .expect(200);
    expect(JSON.stringify(withoutDocs.body)).not.toContain(nearId);
    await request(server())
      .post(`/v1/orders/${orderId}/publish`)
      .set("Authorization", `Bearer ${owner}`)
      .send({ ...publishBody, courierId: nearId })
      .expect(422);
    const shown = new Pool({ connectionString: databaseUrl });
    await shown.query(
      `UPDATE courier_documents SET status = 'ACCEPTED', "updatedAt" = now()
       WHERE "courierId" = $1 AND type = 'SOAT'`,
      [nearId],
    );
    await shown.end();

    const published = await request(server())
      .post(`/v1/orders/${orderId}/publish`)
      .set("Authorization", `Bearer ${owner}`)
      .send({ ...publishBody, courierId: nearId })
      .expect(201);
    const body = record(published.body);
    const offer = record(body["offer"]);
    expect(body["status"]).toBe("SEEKING_COURIER");
    expect(body["deliveryFeeCop"]).toBe(5000);
    expect(offer["status"]).toBe("PENDING");
    expect(JSON.stringify(published.body)).not.toContain(customerName);
    expect(JSON.stringify(published.body)).not.toContain(customerPhone);

    const changed = new Pool({ connectionString: databaseUrl });
    await changed.query(`UPDATE tariff_rules SET "baseFeeCop" = 9000 WHERE "versionId" = $1`, [
      version.rows[0]?.id,
    ]);
    const frozen = await changed.query<{ fee: number; saved: number; payload: string }>(
      `SELECT o."deliveryFeeCop" AS fee, q."deliveryFeeCop" AS saved, n.payload::text AS payload
       FROM orders o
       JOIN tariff_quotes q ON q."orderId" = o.id
       JOIN notification_outbox n ON n.payload->>'orderId' = o.id::text
       WHERE o.id = $1`,
      [orderId],
    );
    await changed.end();
    expect(frozen.rows[0]?.fee).toBe(5000);
    expect(frozen.rows[0]?.saved).toBe(5000);
    expect(frozen.rows[0]?.payload).not.toContain(customerName);
    expect(frozen.rows[0]?.payload).not.toContain(customerPhone);
  });
});
