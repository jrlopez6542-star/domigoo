import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, type AppEnv } from "../src/config/env.js";
import { applyHttpSecurity } from "../src/http.js";
import { resetLoginThrottle } from "../src/identity/login-throttle.js";
import { setupOpenApi } from "../src/openapi.js";
import { migrateDatabase } from "./migrate.js";
import { resetDatabase } from "./reset-db.js";
import { testEnv } from "./test-env.js";

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
const customerPhone = "+573009990241";

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
    .send({ email, password, client: "MOBILE" })
    .expect(201);
  return String(record(created.body)["token"]);
}

describe("recorrido del pedido", () => {
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
    await pool.query(`DELETE FROM pin_attempts`);
    await pool.query(`DELETE FROM incident_events`);
    await pool.query(`DELETE FROM incidents`);
    await pool.query(`DELETE FROM dispatch_offers`);
    await pool.query(`DELETE FROM order_events`);
    await pool.query(`DELETE FROM notification_outbox`);
    await pool.query(`DELETE FROM idempotency_keys`);
    await pool.query(`DELETE FROM tariff_quotes`);
    await pool.query(`DELETE FROM orders`);
    await pool.query(
      `DELETE FROM tariff_rules WHERE "versionId" IN (SELECT id FROM tariff_versions WHERE name = 'Tarifa recorrido')`,
    );
    await pool.query(`DELETE FROM tariff_versions WHERE name = 'Tarifa recorrido'`);
    await pool.query(`DELETE FROM operations_policies WHERE name = 'Politica recorrido'`);
    await pool.end();
  });

  it("guarda cada paso y oculta la comida al domiciliario asignado", async () => {
    const owner = await register("dueno-recorrido@example.invalid");
    const reviewer = await register("revisor-recorrido@example.invalid");
    const courier = await register("domi-recorrido@example.invalid");
    const other = await register("ajeno-recorrido@example.invalid");
    const pool = new Pool({ connectionString: databaseUrl });
    const reviewerUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'revisor-recorrido@example.invalid'`,
    );
    await pool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Revisor', 'REVIEWER', now(), now())`,
      [reviewerUser.rows[0]?.id],
    );
    await pool.query(`UPDATE tariff_versions SET status = 'RETIRED' WHERE status = 'PUBLISHED'`);
    const version = await pool.query<{ id: string }>(
      `INSERT INTO tariff_versions (id, name, status, "publishedAt", "createdAt")
       VALUES (gen_random_uuid(), 'Tarifa recorrido', 'PUBLISHED', now(), now())
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
         gen_random_uuid(), 'Politica recorrido', 'PUBLISHED', 2000, 120, 120, 600, 2, 120, now(), now()
       )`,
    );
    await pool.end();

    const documents = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${reviewer}`)
      .send({
        kind: "DOCUMENT_PROCESSING",
        version: "2026-recorrido-docs",
        content: "Texto sintetico de tratamiento de documentos de prueba",
      })
      .expect(201);
    const geolocation = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${reviewer}`)
      .send({
        kind: "GEOLOCATION_CONSENT",
        version: "2026-recorrido-gps",
        content: "Texto sintetico de geolocalizacion de prueba",
      })
      .expect(201);
    const legalDocumentId = String(record(documents.body)["id"]);
    for (const [token, number] of [
      [courier, "9000000241"],
      [other, "9000000242"],
    ] as const) {
      await request(server())
        .post("/v1/consents")
        .set("Authorization", `Bearer ${token}`)
        .send({ legalDocumentId, purpose: "DOCUMENT_STORAGE", channel: "MOBILE" })
        .expect(201);
      await request(server())
        .post("/v1/couriers")
        .set("Authorization", `Bearer ${token}`)
        .send({
          documentType: "CC",
          documentNumber: number,
          firstName: "Persona",
          lastName: "Sintetica",
        })
        .expect(201);
    }
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
      .send({ plate: "ABC24A", soatExpiresOn: "2027-04-01", techExpiresOn: "2027-08-01" })
      .expect(201);
    const opened = await request(server())
      .post("/v1/couriers/me/verification-cases")
      .set("Authorization", `Bearer ${courier}`)
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
    await request(server())
      .post("/v1/consents")
      .set("Authorization", `Bearer ${courier}`)
      .send({
        legalDocumentId: record(geolocation.body)["id"],
        purpose: "GEOLOCATION",
        channel: "MOBILE",
      })
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

    const site = await request(server())
      .post("/v1/restaurants")
      .set("Authorization", `Bearer ${owner}`)
      .send({
        legalName: "Razon recorrido",
        tradeName: "Local recorrido",
        nit: "900000241",
        email: "local-recorrido@example.invalid",
        phoneE164: "+573001110241",
        establishmentName: "Establecimiento",
        branchName: "Principal",
        addressLine: "Calle sintetica",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(201);
    const billing = new Pool({ connectionString: databaseUrl });
    const plan = await billing.query<{ id: string }>(
      `INSERT INTO subscription_plans (
         id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders", "createdAt"
       ) VALUES (gen_random_uuid(), 'recorrido', 'Mensual', 45000, 30, 0, 1, 3, now())
       RETURNING id`,
    );
    const courierRow = await billing.query<{ id: string }>(
      `SELECT c.id FROM couriers c JOIN users u ON u.id = c."userId" WHERE u.email = 'domi-recorrido@example.invalid'`,
    );
    await billing.query(
      `INSERT INTO restaurant_subscriptions (
         id, "restaurantId", "planId", "priceCop", status, "isCurrent",
         "periodStartsAt", "periodEndsAt", "createdAt", "updatedAt"
       ) VALUES (
         gen_random_uuid(), $1, $2, 45000, 'ACTIVE', true, now(), now() + interval '30 days', now(), now()
       )`,
      [record(site.body)["id"], plan.rows[0]?.id],
    );
    await billing.end();

    const draft = await request(server())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${owner}`)
      .send({
        branchId: record(site.body)["branchId"],
        foodAmountCop: 15000,
        deliveryFeeCop: 5000,
        paymentMethod: "CASH",
      })
      .expect(201);
    const orderId = String(record(draft.body)["id"]);
    const published = await request(server())
      .post(`/v1/orders/${orderId}/publish`)
      .set("Authorization", `Bearer ${owner}`)
      .send({
        courierId: courierRow.rows[0]?.id,
        customerName: "Cliente Sintetico",
        customerPhone,
        dropoffAddress: "Calle sintetica 4",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(201);
    const offerId = String(record(record(published.body)["offer"])["id"]);
    await request(server())
      .post(`/v1/offers/${offerId}/accept`)
      .set("Authorization", `Bearer ${courier}`)
      .set("Idempotency-Key", "recorrido-1")
      .send({ ack: true })
      .expect(201);

    await request(server())
      .post(`/v1/orders/${orderId}/arrive-pickup`)
      .set("Authorization", `Bearer ${other}`)
      .expect(403);

    const shown = await request(server())
      .get(`/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${owner}`)
      .expect(200);
    const pickupPin = String(record(shown.body)["pickupPin"]);
    expect(pickupPin).toMatch(/^\d{6}$/);

    const seen = await request(server())
      .get(`/v1/orders/${orderId}/courier`)
      .set("Authorization", `Bearer ${courier}`)
      .expect(200);
    expect(JSON.stringify(seen.body)).not.toContain("foodAmountCop");
    expect(JSON.stringify(seen.body)).not.toContain(pickupPin);
    expect(record(seen.body)["customerPhoneE164"]).toBe(customerPhone);

    await request(server())
      .post(`/v1/orders/${orderId}/arrive-pickup`)
      .set("Authorization", `Bearer ${courier}`)
      .expect(201);
    await request(server())
      .post(`/v1/orders/${orderId}/at-pickup`)
      .set("Authorization", `Bearer ${courier}`)
      .expect(201);
    const still = await request(server())
      .get(`/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${owner}`)
      .expect(200);
    expect(record(still.body)["pickupPin"]).toBe(pickupPin);
    const picked = await request(server())
      .post(`/v1/orders/${orderId}/pickup-pin`)
      .set("Authorization", `Bearer ${courier}`)
      .set("Idempotency-Key", "recorrido-pin")
      .send({ pin: pickupPin })
      .expect(201);
    expect(record(picked.body)["status"]).toBe("PICKED_UP");
    expect(JSON.stringify(picked.body)).not.toContain(pickupPin);
    expect(JSON.stringify(picked.body)).not.toContain("foodAmountCop");
    const dropped = await request(server())
      .post(`/v1/orders/${orderId}/at-dropoff`)
      .set("Authorization", `Bearer ${courier}`)
      .expect(201);
    expect(JSON.stringify(dropped.body)).not.toContain("foodAmountCop");
    expect(record(dropped.body)["customerPhoneE164"]).toBe(customerPhone);

    const history = await request(server())
      .get(`/v1/orders/${orderId}/events`)
      .set("Authorization", `Bearer ${owner}`)
      .expect(200);
    const pairs = (history.body as unknown[]).map((item) => {
      const step = record(item);
      return `${String(step["fromStatus"])}->${String(step["toStatus"])}`;
    });
    const toward = pairs.indexOf("ACCEPTED->ARRIVING_PICKUP");
    const arrived = pairs.indexOf("ARRIVING_PICKUP->AT_PICKUP");
    const collected = pairs.indexOf("AT_PICKUP->PICKED_UP");
    const destination = pairs.indexOf("PICKED_UP->AT_DROPOFF");
    expect(toward).toBeGreaterThanOrEqual(0);
    expect(arrived).toBeGreaterThan(toward);
    expect(collected).toBeGreaterThan(arrived);
    expect(destination).toBeGreaterThan(collected);

    const courierHistory = await request(server())
      .get(`/v1/orders/${orderId}/events`)
      .set("Authorization", `Bearer ${courier}`)
      .expect(200);
    expect(courierHistory.body).toEqual(history.body);
  });
});
