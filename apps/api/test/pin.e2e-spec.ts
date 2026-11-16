import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, type AppEnv } from "../src/config/env.js";
import { applyHttpSecurity } from "../src/http.js";
import { resetLoginThrottle } from "../src/identity/login-throttle.js";
import { setupOpenApi } from "../src/openapi.js";
import { openPin, pinMac } from "../src/orders/pin.js";
import { migrateDatabase } from "./migrate.js";
import { resetDatabase } from "./reset-db.js";
import { testDataKey, testEnv, testPinPepper } from "./test-env.js";

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
const customerPhone = "+573009990251";

type HttpServer = Parameters<typeof request>[0];
let currentApp: INestApplication | undefined;
let owner = "";
let courier = "";
let other = "";
let orderId = "";
let pickupPin = "";

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

function wrongPin(pin: string): string {
  return pin === "000000" ? "111111" : "000000";
}

describe("PIN de recogida y de entrega", () => {
  beforeAll(() => {
    migrateDatabase(databaseUrl);
  });

  beforeEach(async () => {
    resetLoginThrottle();
    await resetDatabase(databaseUrl);
    currentApp = await createApp(testEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO" }));
    owner = await register("dueno-pin@example.invalid");
    const reviewer = await register("revisor-pin@example.invalid");
    courier = await register("domi-pin@example.invalid");
    other = await register("ajeno-pin@example.invalid");
    const pool = new Pool({ connectionString: databaseUrl });
    const reviewerUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'revisor-pin@example.invalid'`,
    );
    await pool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Revisor', 'REVIEWER', now(), now())`,
      [reviewerUser.rows[0]?.id],
    );
    await pool.query(`UPDATE tariff_versions SET status = 'RETIRED' WHERE status = 'PUBLISHED'`);
    const version = await pool.query<{ id: string }>(
      `INSERT INTO tariff_versions (id, name, status, "publishedAt", "createdAt")
       VALUES (gen_random_uuid(), 'Tarifa pin', 'PUBLISHED', now(), now())
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
         "seekingTtlSeconds", "maxOffersPerWave", "locationFreshnessSeconds",
         "pinLength", "maxPinAttempts", "publishedAt", "createdAt"
       ) VALUES (
         gen_random_uuid(), 'Politica pin', 'PUBLISHED', 2000, 120, 120, 600, 2, 120, 6, 5, now(), now()
       )`,
    );
    await pool.end();

    const documents = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${reviewer}`)
      .send({
        kind: "DOCUMENT_PROCESSING",
        version: "2026-pin-docs",
        content: "Texto sintetico de tratamiento de documentos de prueba",
      })
      .expect(201);
    const geolocation = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${reviewer}`)
      .send({
        kind: "GEOLOCATION_CONSENT",
        version: "2026-pin-gps",
        content: "Texto sintetico de geolocalizacion de prueba",
      })
      .expect(201);
    const legalDocumentId = String(record(documents.body)["id"]);
    for (const [token, number] of [
      [courier, "9000000251"],
      [other, "9000000252"],
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
      .send({ plate: "ABC25A", soatExpiresOn: "2027-04-01", techExpiresOn: "2027-08-01" })
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
        legalName: "Razon pin",
        tradeName: "Local pin",
        nit: "900000251",
        email: "local-pin@example.invalid",
        phoneE164: "+573001110251",
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
       ) VALUES (gen_random_uuid(), 'pin', 'Mensual', 45000, 30, 0, 1, 3, now())
       RETURNING id`,
    );
    const courierRow = await billing.query<{ id: string }>(
      `SELECT c.id FROM couriers c JOIN users u ON u.id = c."userId" WHERE u.email = 'domi-pin@example.invalid'`,
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
    orderId = String(record(draft.body)["id"]);
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
      .set("Idempotency-Key", "pin-acepta")
      .send({ ack: true })
      .expect(201);

    const accepted = await request(server())
      .get(`/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${owner}`)
      .expect(200);
    pickupPin = String(record(accepted.body)["pickupPin"]);
    expect(pickupPin).toMatch(/^\d{6}$/);
    const courierView = await request(server())
      .get(`/v1/orders/${orderId}/courier`)
      .set("Authorization", `Bearer ${courier}`)
      .expect(200);
    expect(JSON.stringify(courierView.body)).not.toContain(pickupPin);

    await request(server())
      .post(`/v1/orders/${orderId}/arrive-pickup`)
      .set("Authorization", `Bearer ${courier}`)
      .expect(201);
    const arriving = await request(server())
      .get(`/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${owner}`)
      .expect(200);
    expect(record(arriving.body)["pickupPin"]).toBe(pickupPin);
    await request(server())
      .post(`/v1/orders/${orderId}/at-pickup`)
      .set("Authorization", `Bearer ${courier}`)
      .expect(201);
    const waiting = await request(server())
      .get(`/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${owner}`)
      .expect(200);
    expect(record(waiting.body)["pickupPin"]).toBe(pickupPin);
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
      `DELETE FROM tariff_rules WHERE "versionId" IN (SELECT id FROM tariff_versions WHERE name = 'Tarifa pin')`,
    );
    await pool.query(`DELETE FROM tariff_versions WHERE name = 'Tarifa pin'`);
    await pool.query(`DELETE FROM operations_policies WHERE name = 'Politica pin'`);
    await pool.end();
  });

  it("el PIN correcto recoge y entrega, y la fila no guarda los dígitos", async () => {
    const picked = await request(server())
      .post(`/v1/orders/${orderId}/pickup-pin`)
      .set("Authorization", `Bearer ${courier}`)
      .set("Idempotency-Key", "pin-recoge")
      .send({ pin: pickupPin })
      .expect(201);
    expect(record(picked.body)["status"]).toBe("PICKED_UP");
    expect(JSON.stringify(picked.body)).not.toContain(pickupPin);
    expect(JSON.stringify(picked.body)).not.toContain("foodAmountCop");
    const replay = await request(server())
      .post(`/v1/orders/${orderId}/pickup-pin`)
      .set("Authorization", `Bearer ${courier}`)
      .set("Idempotency-Key", "pin-recoge")
      .send({ pin: pickupPin })
      .expect(201);
    expect(record(replay.body)["status"]).toBe("PICKED_UP");

    const hidden = await request(server())
      .get(`/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${owner}`)
      .expect(200);
    expect(record(hidden.body)["pickupPin"]).toBeUndefined();

    const pool = new Pool({ connectionString: databaseUrl });
    const stored = await pool.query<{
      pickupPinHash: string;
      pickupPinCiphertext: string;
      deliveryPinHash: string;
      deliveryPinCiphertext: string;
      pickedUpAt: Date | null;
    }>(
      `SELECT "pickupPinHash", "pickupPinCiphertext", "deliveryPinHash", "deliveryPinCiphertext", "pickedUpAt"
       FROM orders WHERE id = $1`,
      [orderId],
    );
    const row = stored.rows[0];
    if (row === undefined) {
      throw new Error("El pedido no quedó guardado");
    }
    expect(row.pickedUpAt).not.toBeNull();
    expect(row.pickupPinHash).toBe(
      pinMac(testPinPepper, orderId, "PICKUP", pickupPin).toString("hex"),
    );
    expect(row.pickupPinHash).not.toContain(pickupPin);
    expect(row.pickupPinCiphertext).not.toContain(pickupPin);
    expect(openPin(testDataKey, orderId, "PICKUP", row.pickupPinCiphertext)).toBe(pickupPin);
    const deliveryPin = openPin(testDataKey, orderId, "DELIVERY", row.deliveryPinCiphertext);
    if (deliveryPin === null || !/^\d{6}$/.test(deliveryPin)) {
      throw new Error("No se pudo leer el PIN de entrega");
    }
    expect(row.deliveryPinHash).not.toContain(deliveryPin);
    expect(row.deliveryPinCiphertext).not.toContain(deliveryPin);
    expect(row.deliveryPinHash).toBe(
      pinMac(testPinPepper, orderId, "DELIVERY", deliveryPin).toString("hex"),
    );

    const events = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM order_events
       WHERE "orderId" = $1 AND "fromStatus" = 'AT_PICKUP' AND "toStatus" = 'PICKED_UP'`,
      [orderId],
    );
    expect(events.rows[0]?.count).toBe("1");
    const audited = await pool.query<{ diff: string }>(
      `SELECT coalesce(string_agg(diff::text, ' '), '') AS diff
       FROM audit_logs WHERE action IN ('order.picked_up', 'order.delivered')`,
    );
    expect(audited.rows[0]?.diff ?? "").not.toContain(pickupPin);
    expect(audited.rows[0]?.diff ?? "").not.toContain(deliveryPin);
    await pool.end();

    await request(server())
      .post(`/v1/orders/${orderId}/at-dropoff`)
      .set("Authorization", `Bearer ${courier}`)
      .expect(201);
    const atDestination = await request(server())
      .get(`/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${owner}`)
      .expect(200);
    expect(record(atDestination.body)["pickupPin"]).toBeUndefined();
    expect(JSON.stringify(atDestination.body)).not.toContain(deliveryPin);

    const delivered = await request(server())
      .post(`/v1/orders/${orderId}/delivery-pin`)
      .set("Authorization", `Bearer ${courier}`)
      .set("Idempotency-Key", "pin-entrega")
      .send({ pin: deliveryPin })
      .expect(201);
    expect(record(delivered.body)["status"]).toBe("DELIVERED");
    expect(JSON.stringify(delivered.body)).not.toContain(deliveryPin);
    expect(JSON.stringify(delivered.body)).not.toContain(pickupPin);
    expect(JSON.stringify(delivered.body)).not.toContain("foodAmountCop");

    const closed = await request(server())
      .get(`/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${owner}`)
      .expect(200);
    expect(record(closed.body)["pickupPin"]).toBeUndefined();
    expect(JSON.stringify(closed.body)).not.toContain(deliveryPin);

    const after = new Pool({ connectionString: databaseUrl });
    const finalRow = await after.query<{
      pickupPinCiphertext: string | null;
      deliveryPinCiphertext: string | null;
      state: string;
    }>(
      `SELECT o."pickupPinCiphertext", o."deliveryPinCiphertext", a.state::text AS state
       FROM orders o
       JOIN courier_availabilities a ON a."courierId" = o."assignedCourierId"
       WHERE o.id = $1`,
      [orderId],
    );
    expect(finalRow.rows[0]?.pickupPinCiphertext).toBeNull();
    expect(finalRow.rows[0]?.deliveryPinCiphertext).toBeNull();
    expect(finalRow.rows[0]?.state).toBe("AVAILABLE");
    await after.end();
  });

  it("un PIN incorrecto no avanza y suma un intento", async () => {
    await request(server())
      .post(`/v1/orders/${orderId}/pickup-pin`)
      .set("Authorization", `Bearer ${other}`)
      .set("Idempotency-Key", "pin-ajeno")
      .send({ pin: wrongPin(pickupPin) })
      .expect(403);

    const failed = await request(server())
      .post(`/v1/orders/${orderId}/pickup-pin`)
      .set("Authorization", `Bearer ${courier}`)
      .set("Idempotency-Key", "pin-mal-1")
      .send({ pin: wrongPin(pickupPin) })
      .expect(422);
    expect(JSON.stringify(failed.body)).not.toContain(pickupPin);

    const pool = new Pool({ connectionString: databaseUrl });
    const order = await pool.query<{ status: string; attempts: number }>(
      `SELECT status::text AS status, "pickupPinAttempts" AS attempts FROM orders WHERE id = $1`,
      [orderId],
    );
    const tries = await pool.query<{ count: string; success: boolean }>(
      `SELECT count(*)::text AS count, bool_or(success) AS success FROM pin_attempts WHERE "orderId" = $1`,
      [orderId],
    );
    const incidents = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM incidents WHERE "orderId" = $1 AND type = 'PIN_LOCKOUT'`,
      [orderId],
    );
    expect(order.rows[0]?.status).toBe("AT_PICKUP");
    expect(order.rows[0]?.attempts).toBe(1);
    expect(tries.rows[0]?.count).toBe("1");
    expect(tries.rows[0]?.success).toBe(false);
    expect(incidents.rows[0]?.count).toBe("0");
    await pool.end();
  });

  it("el quinto intento incorrecto bloquea sin cambiar el estado", async () => {
    const wrong = wrongPin(pickupPin);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await request(server())
        .post(`/v1/orders/${orderId}/pickup-pin`)
        .set("Authorization", `Bearer ${courier}`)
        .set("Idempotency-Key", `pin-bloqueo-${String(attempt)}`)
        .send({ pin: wrong })
        .expect(422);
    }
    await request(server())
      .post(`/v1/orders/${orderId}/pickup-pin`)
      .set("Authorization", `Bearer ${courier}`)
      .set("Idempotency-Key", "pin-ya-bloqueado")
      .send({ pin: pickupPin })
      .expect(422);

    const pool = new Pool({ connectionString: databaseUrl });
    const order = await pool.query<{ status: string; attempts: number }>(
      `SELECT status::text AS status, "pickupPinAttempts" AS attempts FROM orders WHERE id = $1`,
      [orderId],
    );
    const incidents = await pool.query<{ count: string; summary: string }>(
      `SELECT count(*)::text AS count, min(summary) AS summary
       FROM incidents WHERE "orderId" = $1 AND type = 'PIN_LOCKOUT'`,
      [orderId],
    );
    expect(order.rows[0]?.status).toBe("AT_PICKUP");
    expect(order.rows[0]?.attempts).toBe(5);
    expect(incidents.rows[0]?.count).toBe("1");
    expect(incidents.rows[0]?.summary ?? "").not.toContain(pickupPin);
    expect(incidents.rows[0]?.summary ?? "").not.toContain(wrong);
    await pool.end();
  });
});
