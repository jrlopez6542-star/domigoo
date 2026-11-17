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

async function registerAdmin(pool: Pool, email: string): Promise<string> {
  const res = await request(server())
    .post("/v1/auth/register")
    .send({ email, password, client: "ADMIN" })
    .expect(201);
  const cookie = sessionCookie(res.headers);
  await pool.query(
    `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
     SELECT id, 'Admin M40', 'REVIEWER', now(), now()
     FROM users WHERE email = $1`,
    [email],
  );
  return cookie;
}

async function seedTariffAndPolicy(pool: Pool): Promise<void> {
  await pool.query(`UPDATE tariff_versions SET status = 'RETIRED' WHERE status = 'PUBLISHED'`);
  const tv = await pool.query<{ id: string }>(
    `INSERT INTO tariff_versions (id, name, status, "publishedAt", "createdAt")
     VALUES (gen_random_uuid(), 'Tarifa M40', 'PUBLISHED', now(), now())
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
       gen_random_uuid(), 'Politica M40', 'PUBLISHED', 3000, 120, 120, 600, 4, 120, now(), now()
     )`,
  );
}

async function registerAndVerifyRestaurant(
  pool: Pool,
  adminCookie: string,
  ownerEmail: string,
  nit: string,
): Promise<{ ownerCookie: string; restaurantId: string; branchId: string }> {
  const ownerRes = await request(server())
    .post("/v1/auth/register")
    .send({ email: ownerEmail, password, client: "WEB" })
    .expect(201);
  const ownerCookie = sessionCookie(ownerRes.headers);

  const site = await request(server())
    .post("/v1/restaurants")
    .set("Cookie", ownerCookie)
    .send({
      legalName: `Razon ${nit}`,
      tradeName: `Comercio ${nit}`,
      nit,
      email: `contacto-${nit}@example.invalid`,
      phoneE164: "+573001110400",
      establishmentName: `Sede ${nit}`,
      branchName: "Principal",
      addressLine: "Calle 10 # 4-20",
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

  // Actor no autorizado (dueño) no puede activar su propio restaurante -> 404 (AdminGuard)
  await request(server())
    .post(`/v1/admin/restaurants/${restaurantId}/activate`)
    .set("Cookie", ownerCookie)
    .expect(404);

  // Admin verifica y activa el restaurante
  const activated = await request(server())
    .post(`/v1/admin/restaurants/${restaurantId}/activate`)
    .set("Cookie", adminCookie)
    .expect(201);
  expect(record(activated.body)["status"]).toBe("ACTIVE");

  // Suscripción de prueba activa para habilitar publicación de pedidos
  const plan = await pool.query<{ id: string }>(
    `INSERT INTO subscription_plans (
       id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders"
     ) VALUES (gen_random_uuid(), $1, 'Plan M40', 99000, 30, 14, 2, 10)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [`M40_PLAN_${nit}`],
  );
  await pool.query(
    `INSERT INTO restaurant_subscriptions (
       id, "restaurantId", "planId", "priceCop", status, "isCurrent", "periodStartsAt", "periodEndsAt", "updatedAt"
     ) VALUES (
       gen_random_uuid(), $1, $2, 99000, 'TRIAL', true, now() - interval '1 day', now() + interval '13 days', now()
     )`,
    [restaurantId, plan.rows[0]?.id],
  );

  return { ownerCookie, restaurantId, branchId };
}

async function registerAndVerifyCourier(params: {
  adminCookie: string;
  nonAdminCookie: string;
  email: string;
  documentNumber: string;
  firstName: string;
  plate: string;
  docLegalId: string;
  gpsLegalId: string;
  pushToken: string;
  longitude: number;
  latitude: number;
}): Promise<{ token: string; courierId: string }> {
  const reg = await request(server())
    .post("/v1/auth/register")
    .send({ email: params.email, password, client: "MOBILE" })
    .expect(201);
  const token = String(record(reg.body)["token"]);

  await request(server())
    .post("/v1/consents")
    .set("Authorization", `Bearer ${token}`)
    .send({
      legalDocumentId: params.docLegalId,
      purpose: "DOCUMENT_STORAGE",
      channel: "MOBILE",
    })
    .expect(201);

  const created = await request(server())
    .post("/v1/couriers")
    .set("Authorization", `Bearer ${token}`)
    .send({
      documentType: "CC",
      documentNumber: params.documentNumber,
      firstName: params.firstName,
      lastName: "M40",
    })
    .expect(201);
  const courierId = String(record(created.body)["id"]);

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

  // Actor no autorizado (no admin) intentando decidir verificación -> 403 (VerificationAdminController.assertReviewer)
  await request(server())
    .post(`/v1/admin/verification-cases/${caseId}/decision`)
    .set("Cookie", params.nonAdminCookie)
    .send({ outcome: "APPROVED", reasonCode: "DOCS_VERIFIED", comment: "Intento no autorizado" })
    .expect(403);

  // Admin (REVIEWER) aprueba al domiciliario
  await request(server())
    .post(`/v1/admin/verification-cases/${caseId}/decision`)
    .set("Cookie", params.adminCookie)
    .send({ outcome: "APPROVED", reasonCode: "DOCS_VERIFIED", comment: "Aprobado M40" })
    .expect(201);

  // Sin consentimiento GEOLOCATION -> 422 al intentar AVAILABLE
  await request(server())
    .post("/v1/couriers/me/availability")
    .set("Authorization", `Bearer ${token}`)
    .send({ state: "AVAILABLE" })
    .expect(422);

  // Consentimiento GEOLOCATION, push token, disponibilidad y ubicación dentro de la zona
  await request(server())
    .post("/v1/consents")
    .set("Authorization", `Bearer ${token}`)
    .send({
      legalDocumentId: params.gpsLegalId,
      purpose: "GEOLOCATION",
      channel: "MOBILE",
    })
    .expect(201);
  await request(server())
    .post("/v1/devices/push-token")
    .set("Authorization", `Bearer ${token}`)
    .send({ token: params.pushToken })
    .expect(201);
  await request(server())
    .post("/v1/couriers/me/availability")
    .set("Authorization", `Bearer ${token}`)
    .send({ state: "AVAILABLE" })
    .expect(201);
  await request(server())
    .post("/v1/couriers/me/location")
    .set("Authorization", `Bearer ${token}`)
    .send({ longitude: params.longitude, latitude: params.latitude, accuracyM: 10 })
    .expect(201);

  return { token, courierId };
}

describe("flujo completo de punta a punta, casos negativos y concurrencia (M40)", () => {
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

  it("ejecuta los 12 pasos del flujo completo con validación de PIN incorrecto, actor no autorizado, eventos y tracking", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await seedTariffAndPolicy(pool);
      const adminCookie = await registerAdmin(pool, "admin-m40@example.invalid");

      const docLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "DOCUMENT_PROCESSING", version: "2026-m40-doc", content: "Doc M40" })
        .expect(201);
      const gpsLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "GEOLOCATION_CONSENT", version: "2026-m40-gps", content: "GPS M40" })
        .expect(201);
      const docLegalId = String(record(docLegal.body)["id"]);
      const gpsLegalId = String(record(gpsLegal.body)["id"]);

      // 1-2. Restaurante se registra y admin lo verifica
      const { ownerCookie, branchId } = await registerAndVerifyRestaurant(
        pool,
        adminCookie,
        "owner-m40@example.invalid",
        "900000401",
      );

      // 3-5. Domiciliario 1 se registra, admin lo verifica, da consentimiento GEOLOCATION y pasa a AVAILABLE en zona
      const courier1 = await registerAndVerifyCourier({
        adminCookie,
        nonAdminCookie: ownerCookie,
        email: "courier1-m40@example.invalid",
        documentNumber: "9000040001",
        firstName: "Lucia",
        plate: "M40A01",
        docLegalId,
        gpsLegalId,
        pushToken: "fcm-token-m40-courier1-123456",
        longitude: -73.918,
        latitude: 4.968,
      });

      // Segundo domiciliario registrado (no asignado) para validar errores de actor no autorizado
      const otherReg = await request(server())
        .post("/v1/auth/register")
        .send({ email: "courier2-m40@example.invalid", password, client: "MOBILE" })
        .expect(201);
      const otherCourierToken = String(record(otherReg.body)["token"]);
      await request(server())
        .post("/v1/consents")
        .set("Authorization", `Bearer ${otherCourierToken}`)
        .send({
          legalDocumentId: docLegalId,
          purpose: "DOCUMENT_STORAGE",
          channel: "MOBILE",
        })
        .expect(201);
      await request(server())
        .post("/v1/couriers")
        .set("Authorization", `Bearer ${otherCourierToken}`)
        .send({
          documentType: "CC",
          documentNumber: "9000040099",
          firstName: "Otro",
          lastName: "M40",
        })
        .expect(201);

      // 6. Restaurante crea borrador y publica pedido
      const draft = await request(server())
        .post("/v1/orders")
        .set("Cookie", ownerCookie)
        .send({
          branchId,
          foodAmountCop: 48000,
          deliveryFeeCop: 5500,
          paymentMethod: "CASH",
        })
        .expect(201);
      const orderId = String(record(draft.body)["id"]);

      const pub = await request(server())
        .post(`/v1/orders/${orderId}/publish`)
        .set("Cookie", ownerCookie)
        .send({
          mode: "OPEN",
          customerName: "Cliente M40",
          customerPhone: "+573007774000",
          dropoffAddress: "Carrera 5 # 12-30",
          longitude: -73.92,
          latitude: 4.97,
        })
        .expect(201);
      expect(record(pub.body)["status"]).toBe("SEEKING_COURIER");

      // 7. Se distribuyen ofertas y se drena outbox push sin PII
      const offers = record(pub.body)["offers"] as unknown[];
      expect(offers).toHaveLength(1);
      const offerId = String(record(offers[0])["id"]);

      const outbox = currentApp?.get(OutboxRepository);
      const sender = currentApp?.get<RecordingPushSender>(PUSH_SENDER);
      sender?.clear();
      await outbox?.drain(new Date());
      expect(sender?.sent.length).toBeGreaterThanOrEqual(1);

      // 8. Actor no autorizado intenta aceptar la oferta ajena -> 404; domiciliario 1 acepta -> 201
      await request(server())
        .post(`/v1/offers/${offerId}/accept`)
        .set("Authorization", `Bearer ${otherCourierToken}`)
        .set("Idempotency-Key", "m40-unauth-accept")
        .send({ ack: true })
        .expect(404);

      const accepted = await request(server())
        .post(`/v1/offers/${offerId}/accept`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .set("Idempotency-Key", "m40-accept-1")
        .send({ ack: true })
        .expect(201);
      expect(record(accepted.body)["orderStatus"]).toBe("ACCEPTED");

      // Actor no autorizado (domiciliario 2) no puede leer ni avanzar el pedido -> 403
      await request(server())
        .get(`/v1/orders/${orderId}`)
        .set("Authorization", `Bearer ${otherCourierToken}`)
        .expect(403);
      await request(server())
        .post(`/v1/orders/${orderId}/arrive-pickup`)
        .set("Authorization", `Bearer ${otherCourierToken}`)
        .expect(403);

      // 9. arrive-pickup -> at-pickup -> PIN incorrecto (422) -> PIN correcto de recogida (PICKED_UP)
      await request(server())
        .post(`/v1/orders/${orderId}/arrive-pickup`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .expect(201);
      await request(server())
        .post(`/v1/orders/${orderId}/at-pickup`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .expect(201);

      const restOrder = await request(server())
        .get(`/v1/orders/${orderId}`)
        .set("Cookie", ownerCookie)
        .expect(200);
      const pickupPin = String(record(restOrder.body)["pickupPin"]);
      expect(pickupPin).toMatch(/^\d{6}$/);

      const courierOrder = await request(server())
        .get(`/v1/orders/${orderId}`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .expect(200);
      expect(record(courierOrder.body)["pickupPin"]).toBeUndefined();
      expect(record(courierOrder.body)["deliveryPin"]).toBeUndefined();

      const wrongPickupPin = pickupPin === "000000" ? "111111" : "000000";
      const wrongPickup = await request(server())
        .post(`/v1/orders/${orderId}/pickup-pin`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .send({ pin: wrongPickupPin })
        .expect(422);
      expect(record(wrongPickup.body)["attempts"]).toBe(1);
      expect(record(wrongPickup.body)["lockedOut"]).toBe(false);

      const pickedUp = await request(server())
        .post(`/v1/orders/${orderId}/pickup-pin`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .send({ pin: pickupPin })
        .expect(201);
      expect(record(pickedUp.body)["status"]).toBe("PICKED_UP");

      // 10. Actualización del trayecto (at-dropoff)
      await request(server())
        .post(`/v1/orders/${orderId}/at-dropoff`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .expect(201);

      // 11. Enlace de tracking, PIN de entrega incorrecto (422) y validación correcta -> DELIVERED
      const linkRes = await request(server())
        .post(`/v1/orders/${orderId}/tracking-link`)
        .set("Cookie", ownerCookie)
        .expect(201);
      const trackingToken = String(record(linkRes.body)["token"]);

      const trackDropoff = await request(server()).get(`/v1/tracking/${trackingToken}`).expect(200);
      expect(record(trackDropoff.body)["status"]).toBe("AT_DROPOFF");
      expect(record(trackDropoff.body)["courierFirstName"]).toBe("Lucia");
      expect(record(trackDropoff.body)["customerPhone"]).toBeUndefined();
      const deliveryPin = String(record(trackDropoff.body)["deliveryPin"]);
      expect(deliveryPin).toMatch(/^\d{6}$/);

      const wrongDeliveryPin = deliveryPin === "000000" ? "111111" : "000000";
      const wrongDelivery = await request(server())
        .post(`/v1/orders/${orderId}/delivery-pin`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .send({ pin: wrongDeliveryPin })
        .expect(422);
      expect(record(wrongDelivery.body)["attempts"]).toBe(1);
      expect(record(wrongDelivery.body)["lockedOut"]).toBe(false);

      const delivered = await request(server())
        .post(`/v1/orders/${orderId}/delivery-pin`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .send({ pin: deliveryPin })
        .expect(201);
      expect(record(delivered.body)["status"]).toBe("DELIVERED");

      // 12. GET /v1/orders/:id/events y tracking reflejan todos los estados en orden
      const eventsRes = await request(server())
        .get(`/v1/orders/${orderId}/events`)
        .set("Cookie", ownerCookie)
        .expect(200);
      const events = record(eventsRes.body)["events"] as Array<Record<string, unknown>>;
      expect(events.map((e) => [e["fromStatus"], e["toStatus"]])).toEqual([
        ["DRAFT", "SEEKING_COURIER"],
        ["SEEKING_COURIER", "ACCEPTED"],
        ["ACCEPTED", "ARRIVING_PICKUP"],
        ["ARRIVING_PICKUP", "AT_PICKUP"],
        ["AT_PICKUP", "PICKED_UP"],
        ["PICKED_UP", "AT_DROPOFF"],
        ["AT_DROPOFF", "DELIVERED"],
      ]);

      const trackDelivered = await request(server())
        .get(`/v1/tracking/${trackingToken}`)
        .expect(200);
      expect(record(trackDelivered.body)["status"]).toBe("DELIVERED");
      expect(record(trackDelivered.body)["deliveryPin"]).toBeUndefined();
    } finally {
      await pool.end();
    }
  });

  it("bloquea el PIN tras 5 intentos fallidos creando PIN_LOCKOUT y rechaza el intento #6 incluso con PIN válido", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await seedTariffAndPolicy(pool);
      const adminCookie = await registerAdmin(pool, "admin-lock-m40@example.invalid");

      const docLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "DOCUMENT_PROCESSING", version: "2026-m40-lock-doc", content: "Doc" })
        .expect(201);
      const gpsLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "GEOLOCATION_CONSENT", version: "2026-m40-lock-gps", content: "GPS" })
        .expect(201);

      const { ownerCookie, branchId } = await registerAndVerifyRestaurant(
        pool,
        adminCookie,
        "owner-lock-m40@example.invalid",
        "900000402",
      );
      const courier = await registerAndVerifyCourier({
        adminCookie,
        nonAdminCookie: ownerCookie,
        email: "courier-lock-m40@example.invalid",
        documentNumber: "9000040002",
        firstName: "Andres",
        plate: "M40B02",
        docLegalId: String(record(docLegal.body)["id"]),
        gpsLegalId: String(record(gpsLegal.body)["id"]),
        pushToken: "fcm-token-m40-lock-123456",
        longitude: -73.918,
        latitude: 4.968,
      });

      const draft = await request(server())
        .post("/v1/orders")
        .set("Cookie", ownerCookie)
        .send({ branchId, foodAmountCop: 30000, deliveryFeeCop: 5500, paymentMethod: "CASH" })
        .expect(201);
      const orderId = String(record(draft.body)["id"]);

      const pub = await request(server())
        .post(`/v1/orders/${orderId}/publish`)
        .set("Cookie", ownerCookie)
        .send({
          mode: "OPEN",
          customerName: "Cliente Lock",
          customerPhone: "+573007774001",
          dropoffAddress: "Calle 8 # 9-10",
          longitude: -73.92,
          latitude: 4.97,
        })
        .expect(201);
      const offerId = String(record((record(pub.body)["offers"] as unknown[])[0])["id"]);

      await request(server())
        .post(`/v1/offers/${offerId}/accept`)
        .set("Authorization", `Bearer ${courier.token}`)
        .set("Idempotency-Key", "m40-lock-accept")
        .send({ ack: true })
        .expect(201);

      const restOrder = await request(server())
        .get(`/v1/orders/${orderId}`)
        .set("Cookie", ownerCookie)
        .expect(200);
      const pickupPin = String(record(restOrder.body)["pickupPin"]);

      await request(server())
        .post(`/v1/orders/${orderId}/arrive-pickup`)
        .set("Authorization", `Bearer ${courier.token}`)
        .expect(201);
      await request(server())
        .post(`/v1/orders/${orderId}/at-pickup`)
        .set("Authorization", `Bearer ${courier.token}`)
        .expect(201);
      await request(server())
        .post(`/v1/orders/${orderId}/pickup-pin`)
        .set("Authorization", `Bearer ${courier.token}`)
        .send({ pin: pickupPin })
        .expect(201);
      await request(server())
        .post(`/v1/orders/${orderId}/at-dropoff`)
        .set("Authorization", `Bearer ${courier.token}`)
        .expect(201);

      const linkRes = await request(server())
        .post(`/v1/orders/${orderId}/tracking-link`)
        .set("Cookie", ownerCookie)
        .expect(201);
      const trackRes = await request(server())
        .get(`/v1/tracking/${String(record(linkRes.body)["token"])}`)
        .expect(200);
      const deliveryPin = String(record(trackRes.body)["deliveryPin"]);
      const wrongDeliveryPin = deliveryPin === "000000" ? "111111" : "000000";

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const failRes = await request(server())
          .post(`/v1/orders/${orderId}/delivery-pin`)
          .set("Authorization", `Bearer ${courier.token}`)
          .send({ pin: wrongDeliveryPin })
          .expect(422);
        expect(record(failRes.body)["attempts"]).toBe(attempt);
        expect(record(failRes.body)["lockedOut"]).toBe(attempt === 5);
      }

      // Intento #6 incluso con PIN correcto sigue bloqueado (422)
      await request(server())
        .post(`/v1/orders/${orderId}/delivery-pin`)
        .set("Authorization", `Bearer ${courier.token}`)
        .send({ pin: deliveryPin })
        .expect(422);

      const orderRow = await pool.query<{ status: string }>(
        `SELECT status::text AS status FROM orders WHERE id = $1`,
        [orderId],
      );
      expect(orderRow.rows[0]?.status).toBe("AT_DROPOFF");

      const incidents = await pool.query<{ type: string; status: string }>(
        `SELECT type::text AS type, status::text AS status FROM incidents WHERE "orderId" = $1`,
        [orderId],
      );
      expect(incidents.rows).toHaveLength(1);
      expect(incidents.rows[0]?.type).toBe("PIN_LOCKOUT");
    } finally {
      await pool.end();
    }
  });

  it("garantiza exclusividad bajo concurrencia cuando dos domiciliarios aceptan el mismo pedido simultáneamente", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await seedTariffAndPolicy(pool);
      const adminCookie = await registerAdmin(pool, "admin-race-m40@example.invalid");

      const docLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "DOCUMENT_PROCESSING", version: "2026-m40-race-doc", content: "Doc" })
        .expect(201);
      const gpsLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "GEOLOCATION_CONSENT", version: "2026-m40-race-gps", content: "GPS" })
        .expect(201);
      const docLegalId = String(record(docLegal.body)["id"]);
      const gpsLegalId = String(record(gpsLegal.body)["id"]);

      const { ownerCookie, branchId } = await registerAndVerifyRestaurant(
        pool,
        adminCookie,
        "owner-race-m40@example.invalid",
        "900000403",
      );

      const courierA = await registerAndVerifyCourier({
        adminCookie,
        nonAdminCookie: ownerCookie,
        email: "courier-a-m40@example.invalid",
        documentNumber: "9000040003",
        firstName: "Sofia",
        plate: "M40C03",
        docLegalId,
        gpsLegalId,
        pushToken: "fcm-token-m40-race-a-123456",
        longitude: -73.918,
        latitude: 4.968,
      });
      const courierB = await registerAndVerifyCourier({
        adminCookie,
        nonAdminCookie: ownerCookie,
        email: "courier-b-m40@example.invalid",
        documentNumber: "9000040004",
        firstName: "Diego",
        plate: "M40D04",
        docLegalId,
        gpsLegalId,
        pushToken: "fcm-token-m40-race-b-123456",
        longitude: -73.919,
        latitude: 4.969,
      });

      const draft = await request(server())
        .post("/v1/orders")
        .set("Cookie", ownerCookie)
        .send({ branchId, foodAmountCop: 42000, deliveryFeeCop: 5500, paymentMethod: "CASH" })
        .expect(201);
      const orderId = String(record(draft.body)["id"]);

      const pub = await request(server())
        .post(`/v1/orders/${orderId}/publish`)
        .set("Cookie", ownerCookie)
        .send({
          mode: "OPEN",
          customerName: "Cliente Race",
          customerPhone: "+573007774002",
          dropoffAddress: "Avenida 1 # 2-30",
          longitude: -73.92,
          latitude: 4.97,
        })
        .expect(201);
      const offers = record(pub.body)["offers"] as unknown[];
      expect(offers).toHaveLength(2);

      const offerRows = await pool.query<{ id: string; courierId: string }>(
        `SELECT id, "courierId" FROM dispatch_offers WHERE "orderId" = $1`,
        [orderId],
      );
      const offerA = offerRows.rows.find((r) => r.courierId === courierA.courierId);
      const offerB = offerRows.rows.find((r) => r.courierId === courierB.courierId);
      expect(offerA).toBeDefined();
      expect(offerB).toBeDefined();

      // Ambos domiciliarios aceptan exactamente al mismo tiempo
      const [resA, resB] = await Promise.all([
        request(server())
          .post(`/v1/offers/${String(offerA?.id)}/accept`)
          .set("Authorization", `Bearer ${courierA.token}`)
          .set("Idempotency-Key", "m40-race-key-a")
          .send({ ack: true }),
        request(server())
          .post(`/v1/offers/${String(offerB?.id)}/accept`)
          .set("Authorization", `Bearer ${courierB.token}`)
          .set("Idempotency-Key", "m40-race-key-b")
          .send({ ack: true }),
      ]);

      const statuses = [resA.status, resB.status].sort((x, y) => x - y);
      expect(statuses).toEqual([201, 409]);

      const winnerCourierId = resA.status === 201 ? courierA.courierId : courierB.courierId;
      const loserCourierId = resA.status === 201 ? courierB.courierId : courierA.courierId;

      // Consistencia en BD: exactamente 1 oferta ACCEPTED, 1 SUPERSEDED, pedido asignado solo al ganador
      const finalOffers = await pool.query<{ status: string; courierId: string }>(
        `SELECT status::text AS status, "courierId" FROM dispatch_offers WHERE "orderId" = $1`,
        [orderId],
      );
      expect(finalOffers.rows.filter((r) => r.status === "ACCEPTED")).toHaveLength(1);
      expect(finalOffers.rows.filter((r) => r.status === "SUPERSEDED")).toHaveLength(1);
      expect(finalOffers.rows.find((r) => r.courierId === winnerCourierId)?.status).toBe(
        "ACCEPTED",
      );
      expect(finalOffers.rows.find((r) => r.courierId === loserCourierId)?.status).toBe(
        "SUPERSEDED",
      );

      const finalOrder = await pool.query<{ status: string; assignedCourierId: string }>(
        `SELECT status::text AS status, "assignedCourierId" FROM orders WHERE id = $1`,
        [orderId],
      );
      expect(finalOrder.rows[0]?.status).toBe("ACCEPTED");
      expect(finalOrder.rows[0]?.assignedCourierId).toBe(winnerCourierId);

      const availabilities = await pool.query<{ courierId: string; state: string }>(
        `SELECT "courierId", state::text AS state
         FROM courier_availabilities
         WHERE "courierId" = ANY($1::uuid[])`,
        [[winnerCourierId, loserCourierId]],
      );
      expect(availabilities.rows.find((r) => r.courierId === winnerCourierId)?.state).toBe(
        "ON_SERVICE",
      );
      expect(availabilities.rows.find((r) => r.courierId === loserCourierId)?.state).toBe(
        "AVAILABLE",
      );

      const acceptEvents = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM order_events
         WHERE "orderId" = $1 AND "fromStatus" = 'SEEKING_COURIER' AND "toStatus" = 'ACCEPTED'`,
        [orderId],
      );
      expect(acceptEvents.rows[0]?.count).toBe("1");
    } finally {
      await pool.end();
    }
  });
});
