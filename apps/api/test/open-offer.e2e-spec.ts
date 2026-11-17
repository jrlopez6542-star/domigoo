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
): Promise<void> {
  await request(server())
    .post("/v1/consents")
    .set("Authorization", `Bearer ${token}`)
    .send({ legalDocumentId, purpose: "DOCUMENT_STORAGE", channel: "MOBILE" })
    .expect(201);
  await request(server())
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
}

describe("oferta abierta", () => {
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
    await pool.query(`DELETE FROM idempotency_keys`);
    await pool.query(`DELETE FROM tariff_quotes`);
    await pool.query(`DELETE FROM orders`);
    await pool.query(
      `DELETE FROM tariff_rules WHERE "versionId" IN (SELECT id FROM tariff_versions WHERE name = 'Tarifa abierta')`,
    );
    await pool.query(`DELETE FROM tariff_versions WHERE name = 'Tarifa abierta'`);
    await pool.query(`DELETE FROM operations_policies WHERE name = 'Politica abierta'`);
    await pool.end();
  });

  it("acepta en exclusiva con dos conexiones y repite la misma clave", async () => {
    const owner = await register("dueno-abierta@example.invalid");
    const reviewer = await register("revisor-abierta@example.invalid");
    const first = await register("uno-abierta@example.invalid");
    const second = await register("dos-abierta@example.invalid");
    const pool = new Pool({ connectionString: databaseUrl });
    const reviewerUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'revisor-abierta@example.invalid'`,
    );
    await pool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Revisor', 'REVIEWER', now(), now())`,
      [reviewerUser.rows[0]?.id],
    );
    await pool.query(`UPDATE tariff_versions SET status = 'RETIRED' WHERE status = 'PUBLISHED'`);
    const version = await pool.query<{ id: string }>(
      `INSERT INTO tariff_versions (id, name, status, "publishedAt", "createdAt")
       VALUES (gen_random_uuid(), 'Tarifa abierta', 'PUBLISHED', now(), now())
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
         gen_random_uuid(), 'Politica abierta', 'PUBLISHED', 2000, 120, 120, 600, 2, 120, now(), now()
       )`,
    );
    await pool.end();

    const documents = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${reviewer}`)
      .send({
        kind: "DOCUMENT_PROCESSING",
        version: "2026-abierta-docs",
        content: "Texto sintetico de tratamiento de documentos de prueba",
      })
      .expect(201);
    const geolocation = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${reviewer}`)
      .send({
        kind: "GEOLOCATION_CONSENT",
        version: "2026-abierta-gps",
        content: "Texto sintetico de geolocalizacion de prueba",
      })
      .expect(201);
    const legalDocumentId = String(record(documents.body)["id"]);
    await approveCourier(first, reviewer, legalDocumentId, "9000000231", "ABC23A");
    await approveCourier(second, reviewer, legalDocumentId, "9000000232", "ABC23B");
    for (const token of [first, second]) {
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
        .send({ longitude: -73.92, latitude: 4.97, accuracyM: 8 })
        .expect(201);
    }

    const site = await request(server())
      .post("/v1/restaurants")
      .set("Authorization", `Bearer ${owner}`)
      .send({
        legalName: "Razon abierta",
        tradeName: "Local abierto",
        nit: "900000231",
        email: "local-abierta@example.invalid",
        phoneE164: "+573001110231",
        establishmentName: "Establecimiento",
        branchName: "Principal",
        addressLine: "Calle sintetica",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(201);
    const restaurantId = String(record(site.body)["id"]);
    const billing = new Pool({ connectionString: databaseUrl });
    const plan = await billing.query<{ id: string }>(
      `INSERT INTO subscription_plans (
         id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders", "createdAt"
       ) VALUES (gen_random_uuid(), 'abierta', 'Mensual', 45000, 30, 0, 1, 3, now())
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
    await billing.end();

    const draft = await request(server())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${owner}`)
      .send({
        branchId: record(site.body)["branchId"],
        foodAmountCop: 9000,
        deliveryFeeCop: 5000,
        paymentMethod: "NEQUI",
      })
      .expect(201);
    const orderId = String(record(draft.body)["id"]);
    const published = await request(server())
      .post(`/v1/orders/${orderId}/publish`)
      .set("Authorization", `Bearer ${owner}`)
      .send({
        mode: "OPEN",
        customerName: "Cliente Sintetico",
        customerPhone: "+573009990231",
        dropoffAddress: "Calle sintetica 2",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(201);
    const offers = record(published.body)["offers"];
    if (!Array.isArray(offers) || offers.length !== 2) {
      throw new Error("La ola no creó dos ofertas");
    }
    expect(JSON.stringify(published.body)).not.toContain("Cliente Sintetico");
    expect(JSON.stringify(published.body)).not.toContain("+573009990231");

    const links = new Pool({ connectionString: databaseUrl });
    const rows = await links.query<{ id: string; email: string }>(
      `SELECT d.id, u.email
       FROM dispatch_offers d
       JOIN couriers c ON c.id = d."courierId"
       JOIN users u ON u.id = c."userId"
       WHERE d."orderId" = $1 AND d.status = 'PENDING'`,
      [orderId],
    );
    await links.end();
    const byEmail = new Map(rows.rows.map((row) => [row.email, row.id]));
    const firstOffer = byEmail.get("uno-abierta@example.invalid");
    const secondOffer = byEmail.get("dos-abierta@example.invalid");
    if (firstOffer === undefined || secondOffer === undefined) {
      throw new Error("No aparecieron las dos ofertas");
    }
    await request(server()).get("/v1/offers/available").expect(401);

    await request(server())
      .get("/v1/offers/available")
      .set("Authorization", `Bearer ${owner}`)
      .expect(403);

    const firstAvailable = await request(server())
      .get("/v1/offers/available")
      .set("Authorization", `Bearer ${first}`)
      .expect(200);
    expect(record(firstAvailable.body)["offers"]).toEqual([
      expect.objectContaining({
        offerId: firstOffer,
        orderId,
        deliveryFeeCop: 5000,
      }),
    ]);

    const tokens = new Map([
      [firstOffer, first],
      [secondOffer, second],
    ]);
    const raced = await Promise.all([
      request(server())
        .post(`/v1/offers/${firstOffer}/accept`)
        .set("Authorization", `Bearer ${first}`)
        .set("Idempotency-Key", "clave-uno")
        .send({ ack: true }),
      request(server())
        .post(`/v1/offers/${secondOffer}/accept`)
        .set("Authorization", `Bearer ${second}`)
        .set("Idempotency-Key", "clave-dos")
        .send({ ack: true }),
    ]);
    expect(raced.map((item) => item.status).sort()).toEqual([201, 409]);
    const winner = raced.find((item) => item.status === 201);
    if (winner === undefined) {
      throw new Error("Nadie aceptó");
    }
    const winnerBody = record(winner.body);
    const winnerOffer = String(winnerBody["offerId"]);
    const winnerToken = tokens.get(winnerOffer);
    if (winnerToken === undefined) {
      throw new Error("La oferta ganadora no es de estos domiciliarios");
    }
    const winnerKey = winnerOffer === firstOffer ? "clave-uno" : "clave-dos";

    // Escenario 1: Reintento secuencial idéntico devuelve 201 y la misma respuesta
    const again = await request(server())
      .post(`/v1/offers/${winnerOffer}/accept`)
      .set("Authorization", `Bearer ${winnerToken}`)
      .set("Idempotency-Key", winnerKey)
      .send({ ack: true })
      .expect(201);
    expect(record(again.body)["offerId"]).toBe(winnerBody["offerId"]);
    expect(record(again.body)["orderStatus"]).toBe("ACCEPTED");

    // Escenario 2: Dos solicitudes concurrentes idénticas obtienen ambas 201 y la misma respuesta
    const concurrentRetries = await Promise.all([
      request(server())
        .post(`/v1/offers/${winnerOffer}/accept`)
        .set("Authorization", `Bearer ${winnerToken}`)
        .set("Idempotency-Key", winnerKey)
        .send({ ack: true }),
      request(server())
        .post(`/v1/offers/${winnerOffer}/accept`)
        .set("Authorization", `Bearer ${winnerToken}`)
        .set("Idempotency-Key", winnerKey)
        .send({ ack: true }),
    ]);
    expect(concurrentRetries[0].status).toBe(201);
    expect(concurrentRetries[1].status).toBe(201);
    expect(record(concurrentRetries[0].body)["offerId"]).toBe(winnerOffer);
    expect(record(concurrentRetries[1].body)["offerId"]).toBe(winnerOffer);
    expect(record(concurrentRetries[0].body)["orderStatus"]).toBe("ACCEPTED");
    expect(record(concurrentRetries[1].body)["orderStatus"]).toBe("ACCEPTED");

    // Escenario 3: Dos solicitudes concurrentes con distinta oferta (la oferta ajena es rechazada con 409 mismatch)
    const concurrentMismatch = await Promise.all([
      request(server())
        .post(`/v1/offers/${winnerOffer}/accept`)
        .set("Authorization", `Bearer ${winnerToken}`)
        .set("Idempotency-Key", winnerKey)
        .send({ ack: true }),
      request(server())
        .post(`/v1/offers/00000000-0000-4000-8000-000000000001/accept`)
        .set("Authorization", `Bearer ${winnerToken}`)
        .set("Idempotency-Key", winnerKey)
        .send({ ack: true }),
    ]);
    expect(concurrentMismatch.map((item) => item.status).sort()).toEqual([201, 409]);

    // Escenario 4: Misma clave con cuerpo diferente se rechaza con 409
    await request(server())
      .post(`/v1/offers/${winnerOffer}/accept`)
      .set("Authorization", `Bearer ${winnerToken}`)
      .set("Idempotency-Key", winnerKey)
      .send({ ack: false })
      .expect(409);

    const after = new Pool({ connectionString: databaseUrl });
    const states = await after.query<{ status: string }>(
      `SELECT status::text AS status FROM dispatch_offers WHERE "orderId" = $1 ORDER BY status`,
      [orderId],
    );
    const order = await after.query<{ status: string }>(
      `SELECT status::text AS status FROM orders WHERE id = $1`,
      [orderId],
    );
    expect(states.rows.map((row) => row.status)).toEqual(["ACCEPTED", "SUPERSEDED"]);
    expect(order.rows[0]?.status).toBe("ACCEPTED");

    // Escenario 5: Reintento con pedido en PICKED_UP responde 201 ACCEPTED sin revertir la BD
    await after.query(`UPDATE orders SET status = 'PICKED_UP', "updatedAt" = now() WHERE id = $1`, [
      orderId,
    ]);
    const retryPickedUp = await request(server())
      .post(`/v1/offers/${winnerOffer}/accept`)
      .set("Authorization", `Bearer ${winnerToken}`)
      .set("Idempotency-Key", winnerKey)
      .send({ ack: true })
      .expect(201);
    expect(record(retryPickedUp.body)["orderStatus"]).toBe("ACCEPTED");
    const checkPickedUp = await after.query<{ status: string }>(
      `SELECT status::text AS status FROM orders WHERE id = $1`,
      [orderId],
    );
    expect(checkPickedUp.rows[0]?.status).toBe("PICKED_UP");

    // Escenario 6: Reintento con pedido en DELIVERED responde 201 ACCEPTED sin revertir la BD
    await after.query(`UPDATE orders SET status = 'DELIVERED', "updatedAt" = now() WHERE id = $1`, [
      orderId,
    ]);
    const retryDelivered = await request(server())
      .post(`/v1/offers/${winnerOffer}/accept`)
      .set("Authorization", `Bearer ${winnerToken}`)
      .set("Idempotency-Key", winnerKey)
      .send({ ack: true })
      .expect(201);
    expect(record(retryDelivered.body)["orderStatus"]).toBe("ACCEPTED");
    const checkDelivered = await after.query<{ status: string }>(
      `SELECT status::text AS status FROM orders WHERE id = $1`,
      [orderId],
    );
    expect(checkDelivered.rows[0]?.status).toBe("DELIVERED");

    // Escenario 7: Reintento con pedido cancelado responde 201 ACCEPTED sin reactivar el pedido
    await after.query(
      `UPDATE orders SET status = 'CANCELLED_RESTAURANT', "updatedAt" = now() WHERE id = $1`,
      [orderId],
    );
    const retryCancelled = await request(server())
      .post(`/v1/offers/${winnerOffer}/accept`)
      .set("Authorization", `Bearer ${winnerToken}`)
      .set("Idempotency-Key", winnerKey)
      .send({ ack: true })
      .expect(201);
    expect(record(retryCancelled.body)["orderStatus"]).toBe("ACCEPTED");
    const checkCancelled = await after.query<{ status: string }>(
      `SELECT status::text AS status FROM orders WHERE id = $1`,
      [orderId],
    );
    expect(checkCancelled.rows[0]?.status).toBe("CANCELLED_RESTAURANT");
    await after.end();

    const loserToken = winnerOffer === firstOffer ? second : first;
    const another = await request(server())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${owner}`)
      .send({
        branchId: record(site.body)["branchId"],
        foodAmountCop: 8000,
        deliveryFeeCop: 5000,
        paymentMethod: "CASH",
      })
      .expect(201);
    const secondWave = await request(server())
      .post(`/v1/orders/${String(record(another.body)["id"])}/publish`)
      .set("Authorization", `Bearer ${owner}`)
      .send({
        mode: "OPEN",
        customerName: "Otro Cliente",
        customerPhone: "+573009990232",
        dropoffAddress: "Calle sintetica 3",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(201);
    const nextOffers = record(secondWave.body)["offers"];
    if (!Array.isArray(nextOffers) || nextOffers.length !== 1) {
      throw new Error("La segunda ola no quedó en una sola oferta");
    }

    const nextOfferId = String(record(nextOffers[0])["id"]);

    // Riesgo B: Misma clave de idempotencia del ganador en una oferta real distinta responde 409
    await request(server())
      .post(`/v1/offers/${nextOfferId}/accept`)
      .set("Authorization", `Bearer ${winnerToken}`)
      .set("Idempotency-Key", winnerKey)
      .send({ ack: true })
      .expect(409);

    // Riesgo A: Domiciliario ON_SERVICE con oferta pendiente propia responde 409 (no disponible)
    const forceDb = new Pool({ connectionString: databaseUrl });
    const winnerCourier = await forceDb.query<{ id: string }>(
      `SELECT c.id FROM couriers c JOIN users u ON u.id = c."userId" WHERE u.email = $1`,
      [winnerOffer === firstOffer ? "uno-abierta@example.invalid" : "dos-abierta@example.invalid"],
    );
    const forcedOffer = await forceDb.query<{ id: string }>(
      `INSERT INTO dispatch_offers (id, "orderId", "courierId", wave, status, "expiresAt", "createdAt")
       VALUES (gen_random_uuid(), $1, $2, 2, 'PENDING', now() + interval '10 minutes', now())
       RETURNING id`,
      [record(another.body)["id"], winnerCourier.rows[0]?.id],
    );
    const forcedOfferId = String(forcedOffer.rows[0]?.id);
    await forceDb.end();

    await request(server())
      .post(`/v1/offers/${forcedOfferId}/accept`)
      .set("Authorization", `Bearer ${winnerToken}`)
      .set("Idempotency-Key", "clave-intento-doble-asignacion")
      .send({ ack: true })
      .expect(409);

    const declined = await request(server())
      .post(`/v1/offers/${nextOfferId}/decline`)
      .set("Authorization", `Bearer ${loserToken}`)
      .expect(201);
    expect(record(declined.body)["status"]).toBe("DECLINED");
  });

  it("carrera de creación concurrente de clave de idempotencia en oferta nueva", async () => {
    // 1. Setup independiente: Dueño, Revisor y Domiciliario disponible
    const owner = await register("dueno-concurrente@example.invalid");
    const reviewer = await register("revisor-concurrente@example.invalid");
    const courier = await register("domiciliario-concurrente@example.invalid");

    const pool = new Pool({ connectionString: databaseUrl });
    const reviewerUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'revisor-concurrente@example.invalid'`,
    );
    await pool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Revisor Concurrente', 'REVIEWER', now(), now())`,
      [reviewerUser.rows[0]?.id],
    );
    await pool.query(`UPDATE tariff_versions SET status = 'RETIRED' WHERE status = 'PUBLISHED'`);
    const version = await pool.query<{ id: string }>(
      `INSERT INTO tariff_versions (id, name, status, "publishedAt", "createdAt")
       VALUES (gen_random_uuid(), 'Tarifa abierta concurrente', 'PUBLISHED', now(), now())
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
         gen_random_uuid(), 'Politica abierta concurrente', 'PUBLISHED', 2000, 120, 120, 600, 2, 120, now(), now()
       )`,
    );
    await pool.end();

    const documents = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${reviewer}`)
      .send({
        kind: "DOCUMENT_PROCESSING",
        version: "2026-conc-docs",
        content: "Texto sintetico de tratamiento de documentos de prueba concurrente",
      })
      .expect(201);
    const geolocation = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${reviewer}`)
      .send({
        kind: "GEOLOCATION_CONSENT",
        version: "2026-conc-gps",
        content: "Texto sintetico de geolocalizacion de prueba concurrente",
      })
      .expect(201);
    const legalDocumentId = String(record(documents.body)["id"]);

    await approveCourier(courier, reviewer, legalDocumentId, "9000000299", "CON999");
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
        legalName: "Razon concurrente",
        tradeName: "Local concurrente",
        nit: "900000299",
        email: "local-concurrente@example.invalid",
        phoneE164: "+573001110299",
        establishmentName: "Establecimiento Concurrente",
        branchName: "Principal",
        addressLine: "Calle sintetica concurrente",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(201);
    const restaurantId = String(record(site.body)["id"]);
    const billing = new Pool({ connectionString: databaseUrl });
    const plan = await billing.query<{ id: string }>(
      `INSERT INTO subscription_plans (
         id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders", "createdAt"
       ) VALUES (gen_random_uuid(), 'concurrente', 'Mensual', 45000, 30, 0, 1, 3, now())
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
    await billing.end();

    // 2. Oferta nueva y pedido nuevo
    const draft = await request(server())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${owner}`)
      .send({
        branchId: record(site.body)["branchId"],
        foodAmountCop: 10000,
        deliveryFeeCop: 5000,
        paymentMethod: "CASH",
      })
      .expect(201);
    const orderId = String(record(draft.body)["id"]);

    const published = await request(server())
      .post(`/v1/orders/${orderId}/publish`)
      .set("Authorization", `Bearer ${owner}`)
      .send({
        mode: "OPEN",
        customerName: "Cliente Concurrente",
        customerPhone: "+573009990999",
        dropoffAddress: "Calle sintetica concurrente 9",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(201);
    const offers = record(published.body)["offers"];
    if (!Array.isArray(offers) || offers.length !== 1) {
      throw new Error("Se esperaba exactamente una oferta nueva para el domiciliario disponible");
    }
    const freshOfferId = String(record(offers[0])["id"]);

    // 3. Clave de idempotencia nueva
    const freshKey = "clave-concurrente-creacion-fresca";

    // 4. Comprobación previa en base de datos: la clave NO existe antes de las solicitudes
    const preDb = new Pool({ connectionString: databaseUrl });
    const courierInfo = await preDb.query<{ userId: string; courierId: string }>(
      `SELECT u.id AS "userId", c.id AS "courierId"
       FROM users u
       JOIN couriers c ON c."userId" = u.id
       WHERE u.email = 'domiciliario-concurrente@example.invalid'`,
    );
    const courierUserId = String(courierInfo.rows[0]?.userId);
    const courierId = String(courierInfo.rows[0]?.courierId);
    const existingKeyRows = await preDb.query(
      `SELECT 1 FROM idempotency_keys WHERE "userId" = $1 AND key = $2`,
      [courierUserId, freshKey],
    );
    expect(existingKeyRows.rows).toHaveLength(0);

    const initialCourierState = await preDb.query<{ state: string }>(
      `SELECT state::text AS state FROM courier_availabilities WHERE "courierId" = $1`,
      [courierId],
    );
    expect(initialCourierState.rows[0]?.state).toBe("AVAILABLE");
    await preDb.end();

    // 5. Ejecución simultánea mediante Promise.all con mismo usuario, oferta, clave y cuerpo
    const [resA, resB] = await Promise.all([
      request(server())
        .post(`/v1/offers/${freshOfferId}/accept`)
        .set("Authorization", `Bearer ${courier}`)
        .set("Idempotency-Key", freshKey)
        .send({ ack: true }),
      request(server())
        .post(`/v1/offers/${freshOfferId}/accept`)
        .set("Authorization", `Bearer ${courier}`)
        .set("Idempotency-Key", freshKey)
        .send({ ack: true }),
    ]);

    // 6. Verificación de respuestas contractuales HTTP 201 idénticas
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect(resA.body).toEqual(resB.body);
    expect(record(resA.body)["offerId"]).toBe(freshOfferId);
    expect(record(resA.body)["orderId"]).toBe(orderId);
    expect(record(resA.body)["offerStatus"]).toBe("ACCEPTED");
    expect(record(resA.body)["orderStatus"]).toBe("ACCEPTED");

    // 7. Verificación en base de datos:
    const verifyDb = new Pool({ connectionString: databaseUrl });

    // a) Solo existe una fila de idempotencia para esa clave
    const keyCount = await verifyDb.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM idempotency_keys WHERE "userId" = $1 AND key = $2`,
      [courierUserId, freshKey],
    );
    expect(Number(keyCount.rows[0]?.count)).toBe(1);

    // b) Solo existe una aceptación efectiva de la oferta
    const offerCheck = await verifyDb.query<{ status: string; count: string }>(
      `SELECT status::text AS status, count(*)::text AS count
       FROM dispatch_offers
       WHERE id = $1
       GROUP BY status`,
      [freshOfferId],
    );
    expect(offerCheck.rows).toHaveLength(1);
    expect(offerCheck.rows[0]?.status).toBe("ACCEPTED");
    expect(Number(offerCheck.rows[0]?.count)).toBe(1);

    // c) El pedido tiene un único domiciliario asignado
    const orderCheck = await verifyDb.query<{ status: string; assignedCourierId: string }>(
      `SELECT status::text AS status, "assignedCourierId" FROM orders WHERE id = $1`,
      [orderId],
    );
    expect(orderCheck.rows[0]?.status).toBe("ACCEPTED");
    expect(orderCheck.rows[0]?.assignedCourierId).toBe(courierId);

    // d) El domiciliario termina en ON_SERVICE
    const courierState = await verifyDb.query<{ state: string }>(
      `SELECT state::text AS state FROM courier_availabilities WHERE "courierId" = $1`,
      [courierId],
    );
    expect(courierState.rows[0]?.state).toBe("ON_SERVICE");

    // e) No hay duplicación de eventos de aceptación
    const eventCheck = await verifyDb.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM order_events
       WHERE "orderId" = $1 AND "toStatus" = 'ACCEPTED'`,
      [orderId],
    );
    expect(Number(eventCheck.rows[0]?.count)).toBe(1);

    // f) No hay duplicación de registros de auditoría
    const auditCheck = await verifyDb.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM audit_logs
       WHERE "entityId" = $1 AND action = 'offer.accepted'`,
      [freshOfferId],
    );
    expect(Number(auditCheck.rows[0]?.count)).toBe(1);

    await verifyDb.end();
  });
});
