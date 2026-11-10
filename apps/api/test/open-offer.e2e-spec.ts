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
    .send({ email, password, client: "MOBILE" })
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
    currentApp = await createApp(readEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO" }));
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

    const again = await request(server())
      .post(`/v1/offers/${winnerOffer}/accept`)
      .set("Authorization", `Bearer ${winnerToken}`)
      .set("Idempotency-Key", winnerKey)
      .send({ ack: true })
      .expect(201);
    expect(record(again.body)["offerId"]).toBe(winnerBody["offerId"]);
    expect(record(again.body)["orderStatus"]).toBe("ACCEPTED");
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
    await after.end();
    expect(states.rows.map((row) => row.status)).toEqual(["ACCEPTED", "SUPERSEDED"]);
    expect(order.rows[0]?.status).toBe("ACCEPTED");

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
    const declined = await request(server())
      .post(`/v1/offers/${String(record(nextOffers[0])["id"])}/decline`)
      .set("Authorization", `Bearer ${loserToken}`)
      .expect(201);
    expect(record(declined.body)["status"]).toBe("DECLINED");
  });
});
