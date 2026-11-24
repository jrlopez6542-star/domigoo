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
async function registerUser(email: string, phoneE164?: string): Promise<string> {
  const res = await request(server())
    .post("/v1/auth/register")
    .send({
      email,
      ...(phoneE164 !== undefined ? { phoneE164 } : {}),
      password,
      client: "MOBILE",
      consents: { termsAccepted: true, privacyAccepted: true },
    })
    .expect(201);
  return String(record(res.body)["token"]);
}
async function loginUser(email: string): Promise<string> {
  const res = await request(server())
    .post("/v1/auth/login")
    .send({ email, password, client: "MOBILE" })
    .expect(200);
  return String(record(res.body)["token"]);
}
async function setupCourierCandidate(params: {
  email: string;
  phoneE164: string;
  documentNumber: string;
  firstName: string;
  plate: string;
  docLegalId: string;
  gpsLegalId: string;
}): Promise<{ token: string; courierId: string; caseId: string }> {
  const token = await registerUser(params.email, params.phoneE164);
  await request(server())
    .post("/v1/consents")
    .set("Authorization", `Bearer ${token}`)
    .send({
      legalDocumentId: params.docLegalId,
      purpose: "DOCUMENT_STORAGE",
      channel: "MOBILE",
    })
    .expect(201);
  const courierRes = await request(server())
    .post("/v1/couriers")
    .set("Authorization", `Bearer ${token}`)
    .send({
      documentType: "CC",
      documentNumber: params.documentNumber,
      firstName: params.firstName,
      lastName: "Prueba",
    })
    .expect(201);
  const courierId = String(record(courierRes.body)["id"]);
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
    .send({ plate: params.plate, soatExpiresOn: "2028-04-01", techExpiresOn: "2028-08-01" })
    .expect(201);
  const vCase = await request(server())
    .post("/v1/couriers/me/verification-cases")
    .set("Authorization", `Bearer ${token}`)
    .expect(201);
  const caseId = String(record(vCase.body)["id"]);
  await request(server())
    .post("/v1/consents")
    .set("Authorization", `Bearer ${token}`)
    .send({
      legalDocumentId: params.gpsLegalId,
      purpose: "GEOLOCATION",
      channel: "MOBILE",
    })
    .expect(201);
  return { token, courierId, caseId };
}
async function createActiveRestaurantWithPlan(params: {
  pool: Pool;
  ownerToken: string;
  nit: string;
  tradeName: string;
  email: string;
  phoneE164: string;
  planId: string;
}): Promise<{ restaurantId: string; branchId: string }> {
  const site = await request(server())
    .post("/v1/restaurants")
    .set("Authorization", `Bearer ${params.ownerToken}`)
    .send({
      legalName: `Razon ${params.tradeName}`,
      tradeName: params.tradeName,
      nit: params.nit,
      email: params.email,
      phoneE164: params.phoneE164,
      establishmentName: `Establecimiento ${params.tradeName}`,
      branchName: "Principal",
      addressLine: "Calle 10 # 10-10",
      longitude: -73.9132,
      latitude: 4.9655,
    })
    .expect(201);
  const restaurantId = String(record(site.body)["id"]);
  const branchId = String(record(site.body)["branchId"]);
  await params.pool.query(`UPDATE restaurants SET status = 'ACTIVE' WHERE id = $1`, [restaurantId]);
  await request(server())
    .put(`/v1/branches/${branchId}/hours`)
    .set("Authorization", `Bearer ${params.ownerToken}`)
    .send({ slots: [{ weekday: 1, opensMinute: 480, closesMinute: 1200 }] })
    .expect(200);
  await request(server())
    .post(`/v1/branches/${branchId}/activate`)
    .set("Authorization", `Bearer ${params.ownerToken}`)
    .expect(201);
  await params.pool.query(
    `INSERT INTO restaurant_subscriptions (
       id, "restaurantId", "planId", "priceCop", status, "isCurrent", "periodStartsAt", "periodEndsAt", "updatedAt"
     ) VALUES (
       gen_random_uuid(), $1, $2, 45000, 'ACTIVE', true, now(), now() + interval '30 days', now()
     )`,
    [restaurantId, params.planId],
  );
  return { restaurantId, branchId };
}
describe("ORDEN 010 - flujos E2E completos e aislamiento", () => {
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
  it("cubre restaurante, domiciliario, tracking, admin y aislamiento IDOR", async () => {
    await registerUser("owner-a-010@example.invalid", "+573001110101");
    const ownerAToken = await loginUser("owner-a-010@example.invalid");
    const ownerBToken = await registerUser("owner-b-010@example.invalid", "+573001110102");
    const clientToken = await registerUser("client-010@example.invalid", "+573001110103");
    const opsToken = await registerUser("ops-010@example.invalid", "+573001110104");
    const reviewerToken = await registerUser("rev-010@example.invalid", "+573001110105");
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query(
        `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
         SELECT id, 'Operaciones 010', 'OPERATIONS', now(), now()
         FROM users WHERE email = 'ops-010@example.invalid'`,
      );
      await pool.query(
        `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
         SELECT id, 'Revisor 010', 'REVIEWER', now(), now()
         FROM users WHERE email = 'rev-010@example.invalid'`,
      );
      await pool.query(`UPDATE tariff_versions SET status = 'RETIRED' WHERE status = 'PUBLISHED'`);
      const tv = await pool.query<{ id: string }>(
        `INSERT INTO tariff_versions (id, name, status, "publishedAt", "createdAt")
         VALUES (gen_random_uuid(), 'Tarifa 010', 'PUBLISHED', now(), now())
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
           gen_random_uuid(), 'Politica 010', 'PUBLISHED', 2000, 120, 120, 600, 5, 120, now(), now()
         )`,
      );
      const plan = await pool.query<{ id: string }>(
        `INSERT INTO subscription_plans (
           id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders"
         ) VALUES (gen_random_uuid(), 'PLAN_010', 'Plan 010', 45000, 30, 0, 2, 10)
         RETURNING id`,
      );
      const planId = String(plan.rows[0]?.id);
      const docLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Authorization", `Bearer ${reviewerToken}`)
        .send({ kind: "DOCUMENT_PROCESSING", version: "2026-010-doc", content: "Doc 010" })
        .expect(201);
      const gpsLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Authorization", `Bearer ${reviewerToken}`)
        .send({ kind: "GEOLOCATION_CONSENT", version: "2026-010-gps", content: "GPS 010" })
        .expect(201);
      const docLegalId = String(record(docLegal.body)["id"]);
      const gpsLegalId = String(record(gpsLegal.body)["id"]);
      const courier1 = await setupCourierCandidate({
        email: "courier1-010@example.invalid",
        phoneE164: "+573001110106",
        documentNumber: "9000100001",
        firstName: "Camilo",
        plate: "O10A01",
        docLegalId,
        gpsLegalId,
      });
      const courier2 = await setupCourierCandidate({
        email: "courier2-010@example.invalid",
        phoneE164: "+573001110107",
        documentNumber: "9000100002",
        firstName: "Andrea",
        plate: "O10B02",
        docLegalId,
        gpsLegalId,
      });
      // d) Admin: no-admin recibe 403; REVIEWER lista (array plano) y decide casos de verificación
      await request(server())
        .get("/v1/admin/verification-cases")
        .set("Authorization", `Bearer ${clientToken}`)
        .expect(403);
      await request(server())
        .get("/v1/admin/verification-cases")
        .set("Authorization", `Bearer ${ownerAToken}`)
        .expect(403);
      const casesRes = await request(server())
        .get("/v1/admin/verification-cases")
        .set("Authorization", `Bearer ${reviewerToken}`)
        .expect(200);
      expect(Array.isArray(casesRes.body)).toBe(true);
      const listedCases = casesRes.body as Array<{ id?: string }>;
      const listedIds = listedCases.map((c) => c.id);
      expect(listedIds).toContain(courier1.caseId);
      expect(listedIds).toContain(courier2.caseId);
      for (const item of [
        { caseId: courier1.caseId, courierId: courier1.courierId },
        { caseId: courier2.caseId, courierId: courier2.courierId },
      ]) {
        await request(server())
          .post(`/v1/admin/verification-cases/${item.caseId}/decision`)
          .set("Authorization", `Bearer ${reviewerToken}`)
          .send({ outcome: "APPROVED", reasonCode: "DOCS_VERIFIED", comment: "Aprobado 010" })
          .expect(201);
        const cStatus = await pool.query<{ status: string }>(
          `SELECT status::text AS status FROM couriers WHERE id = $1`,
          [item.courierId],
        );
        expect(cStatus.rows[0]?.status).toBe("APPROVED");
      }
      for (const cToken of [courier1.token, courier2.token]) {
        await request(server())
          .post("/v1/couriers/me/availability")
          .set("Authorization", `Bearer ${cToken}`)
          .send({ state: "AVAILABLE" })
          .expect(201);
        await request(server())
          .post("/v1/couriers/me/location")
          .set("Authorization", `Bearer ${cToken}`)
          .send({ longitude: -73.9135, latitude: 4.9658, accuracyM: 10 })
          .expect(201);
      }
      const restA = await createActiveRestaurantWithPlan({
        pool,
        ownerToken: ownerAToken,
        nit: "900000101",
        tradeName: "Restaurante A 010",
        email: "rest-a-010@example.invalid",
        phoneE164: "+573001110111",
        planId,
      });
      const restB = await createActiveRestaurantWithPlan({
        pool,
        ownerToken: ownerBToken,
        nit: "900000102",
        tradeName: "Restaurante B 010",
        email: "rest-b-010@example.invalid",
        phoneE164: "+573001110112",
        planId,
      });
      // a) Cliente NO puede crear pedidos (403/404)
      const clientOrderRes = await request(server())
        .post("/v1/orders")
        .set("Authorization", `Bearer ${clientToken}`)
        .send({
          branchId: restA.branchId,
          foodAmountCop: 25000,
          deliveryFeeCop: 5500,
          paymentMethod: "CASH",
        });
      expect([403, 404]).toContain(clientOrderRes.status);
      // a) Restaurante A crea pedido y publica DIRECTO a courier1 -> { offer: { id, status } }
      const directDraft = await request(server())
        .post("/v1/orders")
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({
          branchId: restA.branchId,
          foodAmountCop: 30000,
          deliveryFeeCop: 5500,
          paymentMethod: "CASH",
        })
        .expect(201);
      const directOrderId = String(record(directDraft.body)["id"]);
      const pubDirectRes = await request(server())
        .post(`/v1/orders/${directOrderId}/publish`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({
          mode: "DIRECT",
          courierId: courier1.courierId,
          customerName: "Cliente Directo 010",
          customerPhone: "+573001110190",
          dropoffAddress: "Calle 20 # 5-10",
          longitude: -73.914,
          latitude: 4.966,
        })
        .expect(201);
      const directOfferObj = record(record(pubDirectRes.body)["offer"]);
      const directOfferId = String(directOfferObj["id"]);
      expect(directOfferId).toBeTruthy();
      expect(directOfferObj["status"]).toBe("PENDING");
      // b) Domiciliario: offers[] con offerId y orderId; courier2 NO ve oferta directa de courier1
      const availC2Before = await request(server())
        .get("/v1/offers/available")
        .set("Authorization", `Bearer ${courier2.token}`)
        .expect(200);
      const rawAvailC2Before = record(availC2Before.body)["offers"];
      expect(Array.isArray(rawAvailC2Before)).toBe(true);
      const c2OfferIdsBefore = (
        rawAvailC2Before as Array<{ offerId?: string; orderId?: string }>
      ).map((o) => o.offerId);
      expect(c2OfferIdsBefore).not.toContain(directOfferId);
      const availC1 = await request(server())
        .get("/v1/offers/available")
        .set("Authorization", `Bearer ${courier1.token}`)
        .expect(200);
      const rawAvailC1 = record(availC1.body)["offers"];
      expect(Array.isArray(rawAvailC1)).toBe(true);
      const c1Offer = (rawAvailC1 as Array<{ offerId?: string; orderId?: string }>).find(
        (o) => o.orderId === directOrderId,
      );
      expect(c1Offer?.offerId).toBe(directOfferId);
      // Oferta DIRECTA ajena da 404 al otro domiciliario
      await request(server())
        .post(`/v1/offers/${directOfferId}/accept`)
        .set("Authorization", `Bearer ${courier2.token}`)
        .set("Idempotency-Key", "010-accept-direct-c2-forbidden")
        .send({ ack: true })
        .expect(404);
      // courier1 acepta la directa
      await request(server())
        .post(`/v1/offers/${directOfferId}/accept`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .set("Idempotency-Key", "010-accept-direct-c1")
        .send({ ack: true })
        .expect(201);
      // Domiciliario no asignado (courier2) recibe 403 al ver o avanzar el pedido (contrato journey.e2e-spec.ts)
      await request(server())
        .get(`/v1/orders/${directOrderId}`)
        .set("Authorization", `Bearer ${courier2.token}`)
        .expect(403);
      await request(server())
        .post(`/v1/orders/${directOrderId}/arrive-pickup`)
        .set("Authorization", `Bearer ${courier2.token}`)
        .expect(403);
      // Emitir tracking y leer pickupPin como restaurante A
      const linkRes = await request(server())
        .post(`/v1/orders/${directOrderId}/tracking-link`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .expect(201);
      const trackingToken = String(record(linkRes.body)["token"]);
      const restOrderView = await request(server())
        .get(`/v1/orders/${directOrderId}`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .expect(200);
      const pickupPin = String(record(restOrderView.body)["pickupPin"]);
      expect(pickupPin).toMatch(/^\d{6}$/);
      // Recoger: arrive-pickup -> at-pickup -> wrong pickup PIN (maxAttempts + pin_attempts) -> right pickup PIN
      await request(server())
        .post(`/v1/orders/${directOrderId}/arrive-pickup`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .expect(201);
      await request(server())
        .post(`/v1/orders/${directOrderId}/at-pickup`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .expect(201);
      const wrongPickupPin = pickupPin === "000000" ? "111111" : "000000";
      const wrongPickupRes = await request(server())
        .post(`/v1/orders/${directOrderId}/pickup-pin`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .send({ pin: wrongPickupPin })
        .expect(422);
      expect(record(wrongPickupRes.body)["attempts"]).toBe(1);
      expect(record(wrongPickupRes.body)["maxAttempts"]).toBe(5);
      const pickupAttemptsDb = await pool.query<{ success: boolean }>(
        `SELECT success FROM pin_attempts WHERE "orderId" = $1 AND kind = 'PICKUP'`,
        [directOrderId],
      );
      expect(pickupAttemptsDb.rows.some((r) => !r.success)).toBe(true);
      const okPickupRes = await request(server())
        .post(`/v1/orders/${directOrderId}/pickup-pin`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .send({ pin: pickupPin })
        .expect(201);
      expect(record(okPickupRes.body)["status"]).toBe("PICKED_UP");
      // c) Seguimiento: claves exactas, sin PII ni montos, Cache-Control no-store y private; token inválido -> 404 genérico + no-store
      const trackRes = await request(server()).get(`/v1/tracking/${trackingToken}`).expect(200);
      const cacheControl = trackRes.headers["cache-control"] ?? "";
      expect(cacheControl).toContain("no-store");
      expect(cacheControl).toContain("private");
      const trackBody = record(trackRes.body);
      expect(Object.keys(trackBody).sort()).toEqual([
        "courierFirstName",
        "deliveryPin",
        "events",
        "referenceCode",
        "restaurantName",
        "status",
      ]);
      expect(trackBody["status"]).toBe("PICKED_UP");
      const serializedTrack = JSON.stringify(trackBody);
      expect(serializedTrack).not.toContain("Cliente Directo 010");
      expect(serializedTrack).not.toContain("+573001110190");
      expect(serializedTrack).not.toContain("Calle 20 # 5-10");
      expect(serializedTrack).not.toContain("30000");
      expect(serializedTrack).not.toContain("5500");
      const deliveryPin = String(trackBody["deliveryPin"]);
      expect(deliveryPin).toMatch(/^\d{6}$/);
      const invalidTrackRes = await request(server())
        .get("/v1/tracking/token-invalido-010")
        .expect(404);
      expect(invalidTrackRes.body).toEqual({ statusCode: 404, message: "Not Found" });
      expect(invalidTrackRes.headers["cache-control"] ?? "").toContain("no-store");
      // Llega y entrega con PIN incorrecto (maxAttempts + pin_attempts) y PIN correcto
      await request(server())
        .post(`/v1/orders/${directOrderId}/at-dropoff`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .expect(201);
      const wrongDeliveryPin = deliveryPin === "000000" ? "111111" : "000000";
      const wrongDeliveryRes = await request(server())
        .post(`/v1/orders/${directOrderId}/delivery-pin`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .send({ pin: wrongDeliveryPin })
        .expect(422);
      expect(record(wrongDeliveryRes.body)["attempts"]).toBe(1);
      expect(record(wrongDeliveryRes.body)["maxAttempts"]).toBe(5);
      const deliveryAttemptsDb = await pool.query<{ success: boolean }>(
        `SELECT success FROM pin_attempts WHERE "orderId" = $1 AND kind = 'DELIVERY'`,
        [directOrderId],
      );
      expect(deliveryAttemptsDb.rows.some((r) => !r.success)).toBe(true);
      const deliveredRes = await request(server())
        .post(`/v1/orders/${directOrderId}/delivery-pin`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .send({ pin: deliveryPin })
        .expect(201);
      expect(record(deliveredRes.body)["status"]).toBe("DELIVERED");
      // a) & b) Publicación ABIERTA: ambos domiciliarios reciben oferta del mismo pedido; uno acepta 201 y el otro 409
      for (const cToken of [courier1.token, courier2.token]) {
        await request(server())
          .post("/v1/couriers/me/availability")
          .set("Authorization", `Bearer ${cToken}`)
          .send({ state: "AVAILABLE" })
          .expect(201);
        await request(server())
          .post("/v1/couriers/me/location")
          .set("Authorization", `Bearer ${cToken}`)
          .send({ longitude: -73.9135, latitude: 4.9658, accuracyM: 10 })
          .expect(201);
      }
      const openDraft = await request(server())
        .post("/v1/orders")
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({
          branchId: restA.branchId,
          foodAmountCop: 32000,
          deliveryFeeCop: 5500,
          paymentMethod: "CASH",
        })
        .expect(201);
      const openOrderId = String(record(openDraft.body)["id"]);
      const pubOpenRes = await request(server())
        .post(`/v1/orders/${openOrderId}/publish`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({
          mode: "OPEN",
          customerName: "Cliente Abierto 010",
          customerPhone: "+573001110191",
          dropoffAddress: "Carrera 5 # 12-30",
          longitude: -73.914,
          latitude: 4.966,
        })
        .expect(201);
      const rawOpenOffers = record(pubOpenRes.body)["offers"];
      expect(Array.isArray(rawOpenOffers)).toBe(true);
      expect((rawOpenOffers as unknown[]).length).toBeGreaterThanOrEqual(2);
      const openAvailC1 = await request(server())
        .get("/v1/offers/available")
        .set("Authorization", `Bearer ${courier1.token}`)
        .expect(200);
      const rawOpenAvailC1 = record(openAvailC1.body)["offers"];
      expect(Array.isArray(rawOpenAvailC1)).toBe(true);
      const c1OpenOffer = (rawOpenAvailC1 as Array<{ offerId?: string; orderId?: string }>).find(
        (o) => o.orderId === openOrderId,
      );
      expect(c1OpenOffer?.offerId).toBeTruthy();
      const openAvailC2 = await request(server())
        .get("/v1/offers/available")
        .set("Authorization", `Bearer ${courier2.token}`)
        .expect(200);
      const rawOpenAvailC2 = record(openAvailC2.body)["offers"];
      expect(Array.isArray(rawOpenAvailC2)).toBe(true);
      const c2OpenOffer = (rawOpenAvailC2 as Array<{ offerId?: string; orderId?: string }>).find(
        (o) => o.orderId === openOrderId,
      );
      expect(c2OpenOffer?.offerId).toBeTruthy();
      await request(server())
        .post(`/v1/offers/${String(c1OpenOffer?.offerId)}/accept`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .set("Idempotency-Key", "010-accept-open-c1")
        .send({ ack: true })
        .expect(201);
      await request(server())
        .post(`/v1/offers/${String(c2OpenOffer?.offerId)}/accept`)
        .set("Authorization", `Bearer ${courier2.token}`)
        .set("Idempotency-Key", "010-accept-open-c2")
        .send({ ack: true })
        .expect(409);
      // e) Aislamiento IDOR: restaurante B crea pedido, restaurante A recibe 404 en detalle, publicar, cancelar y tracking-link
      const orderBRes = await request(server())
        .post("/v1/orders")
        .set("Authorization", `Bearer ${ownerBToken}`)
        .send({
          branchId: restB.branchId,
          foodAmountCop: 28000,
          deliveryFeeCop: 5500,
          paymentMethod: "CASH",
        })
        .expect(201);
      const orderBId = String(record(orderBRes.body)["id"]);
      await request(server())
        .get(`/v1/orders/${orderBId}`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .expect(404);
      await request(server())
        .post(`/v1/orders/${orderBId}/publish`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({
          mode: "OPEN",
          customerName: "Intento IDOR",
          customerPhone: "+573001110199",
          dropoffAddress: "Calle Falsa 123",
          longitude: -73.914,
          latitude: 4.966,
        })
        .expect(404);
      await request(server())
        .post(`/v1/orders/${orderBId}/cancel`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({ reason: "Intento IDOR" })
        .expect(404);
      await request(server())
        .post(`/v1/orders/${orderBId}/tracking-link`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .expect(404);
      const mineARes = await request(server())
        .get("/v1/orders/mine")
        .set("Authorization", `Bearer ${ownerAToken}`)
        .expect(200);
      const rawMineA = record(mineARes.body)["orders"];
      expect(Array.isArray(rawMineA)).toBe(true);
      const mineAIds = (rawMineA as Array<{ id?: string }>).map((o) => o.id);
      expect(mineAIds).toContain(directOrderId);
      expect(mineAIds).not.toContain(orderBId);
      // d) Admin: suspender y rehabilitar restaurante y domiciliario; no-admin recibe 403
      await request(server())
        .post(`/v1/admin/restaurants/${restA.restaurantId}/suspend`)
        .set("Authorization", `Bearer ${clientToken}`)
        .send({ reason: "No autorizado" })
        .expect(403);
      const suspRest = await request(server())
        .post(`/v1/admin/restaurants/${restA.restaurantId}/suspend`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ reason: "Suspensión 010" })
        .expect(201);
      expect(record(suspRest.body)["status"]).toBe("SUSPENDED");
      const reinRest = await request(server())
        .post(`/v1/admin/restaurants/${restA.restaurantId}/reinstate`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ reason: "Rehabilitación 010" })
        .expect(201);
      expect(record(reinRest.body)["status"]).toBe("ACTIVE");
      const suspCourier = await request(server())
        .post(`/v1/admin/couriers/${courier2.courierId}/suspend`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ reason: "Suspensión domiciliario 010" })
        .expect(201);
      expect(record(suspCourier.body)["status"]).toBe("SUSPENDED");
      const reinCourier = await request(server())
        .post(`/v1/admin/couriers/${courier2.courierId}/reinstate`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ reason: "Rehabilitación domiciliario 010" })
        .expect(201);
      expect(record(reinCourier.body)["status"]).toBe("APPROVED");
    } finally {
      await pool.end();
    }
  });
});
