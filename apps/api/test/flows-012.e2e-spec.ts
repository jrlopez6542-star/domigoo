import { randomBytes } from "node:crypto";
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
     SELECT id, 'Admin 012', 'SUPERADMIN', now(), now()
     FROM users WHERE email = $1`,
    [email],
  );
  return cookie;
}

async function seedTariffAndPolicy(pool: Pool): Promise<void> {
  await pool.query(`UPDATE tariff_versions SET status = 'RETIRED' WHERE status = 'PUBLISHED'`);
  const tv = await pool.query<{ id: string }>(
    `INSERT INTO tariff_versions (id, name, status, "publishedAt", "createdAt")
     VALUES (gen_random_uuid(), 'Tarifa 012', 'PUBLISHED', now(), now())
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
       gen_random_uuid(), 'Politica 012', 'PUBLISHED', 3000, 120, 120, 600, 4, 120, now(), now()
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
    .send({
      email: ownerEmail,
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
      legalName: `Razon ${nit}`,
      tradeName: `Comercio ${nit}`,
      nit,
      email: `contacto-${nit}@example.invalid`,
      phoneE164: "+573001110120",
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

  const activated = await request(server())
    .post(`/v1/admin/restaurants/${restaurantId}/activate`)
    .set("Cookie", adminCookie)
    .expect(201);
  expect(record(activated.body)["status"]).toBe("ACTIVE");

  const plan = await pool.query<{ id: string }>(
    `INSERT INTO subscription_plans (
       id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders"
     ) VALUES (gen_random_uuid(), $1, 'Plan 012', 99000, 30, 14, 2, 10)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [`PLAN_012_${nit}`],
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

async function submitCourierCase(params: {
  email: string;
  documentNumber: string;
  firstName: string;
  plate: string;
  docLegalId: string;
}): Promise<{ token: string; courierId: string; caseId: string }> {
  const reg = await request(server())
    .post("/v1/auth/register")
    .send({
      email: params.email,
      password,
      client: "MOBILE",
      consents: { termsAccepted: true, privacyAccepted: true },
    })
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
      lastName: "Prueba",
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

  return { token, courierId, caseId };
}

async function registerAndVerifyCourier(params: {
  adminCookie: string;
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
  const { token, courierId, caseId } = await submitCourierCase({
    email: params.email,
    documentNumber: params.documentNumber,
    firstName: params.firstName,
    plate: params.plate,
    docLegalId: params.docLegalId,
  });

  await request(server())
    .post(`/v1/admin/verification-cases/${caseId}/decision`)
    .set("Cookie", params.adminCookie)
    .send({ outcome: "APPROVED", reasonCode: "DOCS_VERIFIED", comment: "Aprobado 012" })
    .expect(201);

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

async function assertPublicTrackingStep(
  trackingToken: string,
  expectedStatus: string,
  expectedEventStatuses: readonly string[],
  pickupPin?: string,
): Promise<Record<string, unknown>> {
  const res = await request(server()).get(`/v1/tracking/${trackingToken}`).expect(200);
  const body = record(res.body);

  expect(body["status"]).toBe(expectedStatus);

  const expectsDeliveryPin = expectedStatus === "PICKED_UP" || expectedStatus === "AT_DROPOFF";
  const expectedKeys = expectsDeliveryPin
    ? ["courierFirstName", "deliveryPin", "events", "referenceCode", "restaurantName", "status"]
    : ["courierFirstName", "events", "referenceCode", "restaurantName", "status"];
  expect(Object.keys(body).sort()).toEqual(expectedKeys);

  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain("+573001110129");
  expect(serialized).not.toContain("3001110129");
  expect(serialized).not.toContain("Carrera 5");
  expect(serialized).not.toContain("Calle 10");
  expect(serialized).not.toContain("Cliente 012");
  expect(serialized).not.toContain("example.invalid");
  expect(serialized).not.toContain("Prueba");
  if (pickupPin !== undefined) {
    expect(serialized).not.toContain(pickupPin);
  }

  const bodyWithoutDeliveryPin = Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== "deliveryPin"),
  );
  const serializedWithoutDeliveryPin = JSON.stringify(bodyWithoutDeliveryPin);
  expect(serializedWithoutDeliveryPin).not.toContain("36000");
  expect(serializedWithoutDeliveryPin).not.toContain("5500");

  const events = body["events"] as unknown[];
  expect(Array.isArray(events)).toBe(true);
  expect(events.map((ev) => record(ev)["toStatus"])).toEqual(expectedEventStatuses);
  for (const ev of events) {
    const item = record(ev);
    expect(Object.keys(item).sort()).toEqual(["createdAt", "fromStatus", "toStatus"]);
    expect(typeof item["createdAt"]).toBe("string");
  }

  return body;
}

describe("flujo completo de punta a punta, ofertas, tracking y admin (ORDEN 012)", () => {
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

  it("cubre publicación, ofertas disponibles/exclusión, trayecto con PINs, tracking por paso, revocación y vistas admin", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await seedTariffAndPolicy(pool);
      const adminCookie = await registerSuperadmin(pool, "admin-012@example.invalid");

      const docLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "DOCUMENT_PROCESSING", version: "2026-012-doc", content: "Doc 012" })
        .expect(201);
      const gpsLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "GEOLOCATION_CONSENT", version: "2026-012-gps", content: "GPS 012" })
        .expect(201);
      const docLegalId = String(record(docLegal.body)["id"]);
      const gpsLegalId = String(record(gpsLegal.body)["id"]);

      const { ownerCookie, branchId } = await registerAndVerifyRestaurant(
        pool,
        adminCookie,
        "owner-012@example.invalid",
        "900000120",
      );

      const courier1 = await registerAndVerifyCourier({
        adminCookie,
        email: "courier1-012@example.invalid",
        documentNumber: "9000120001",
        firstName: "Mateo",
        plate: "D012A1",
        docLegalId,
        gpsLegalId,
        pushToken: "fcm-token-012-courier1-123456",
        longitude: -73.9135,
        latitude: 4.9658,
      });

      const courier2 = await registerAndVerifyCourier({
        adminCookie,
        email: "courier2-012@example.invalid",
        documentNumber: "9000120002",
        firstName: "Sofia",
        plate: "D012B2",
        docLegalId,
        gpsLegalId,
        pushToken: "fcm-token-012-courier2-123456",
        longitude: -73.914,
        latitude: 4.966,
      });

      const pendingCourier = await submitCourierCase({
        email: "courier3-012@example.invalid",
        documentNumber: "9000120003",
        firstName: "Camila",
        plate: "D012C3",
        docLegalId,
      });

      const draft = await request(server())
        .post("/v1/orders")
        .set("Cookie", ownerCookie)
        .send({
          branchId,
          foodAmountCop: 36000,
          deliveryFeeCop: 5500,
          paymentMethod: "CASH",
        })
        .expect(201);
      expect(record(draft.body)["status"]).toBe("DRAFT");
      const orderId = String(record(draft.body)["id"]);

      const pub = await request(server())
        .post(`/v1/orders/${orderId}/publish`)
        .set("Cookie", ownerCookie)
        .send({
          mode: "OPEN",
          customerName: "Cliente 012",
          customerPhone: "+573001110129",
          dropoffAddress: "Carrera 5 # 12-30",
          longitude: -73.92,
          latitude: 4.97,
        })
        .expect(201);
      expect(record(pub.body)["status"]).toBe("SEEKING_COURIER");

      const linkRes = await request(server())
        .post(`/v1/orders/${orderId}/tracking-link`)
        .set("Cookie", ownerCookie)
        .expect(201);
      const trackingToken = String(record(linkRes.body)["token"]);

      await assertPublicTrackingStep(trackingToken, "SEEKING_COURIER", ["SEEKING_COURIER"]);

      // Ambos domiciliarios ven su oferta en GET /v1/offers/available
      const avail1 = await request(server())
        .get("/v1/offers/available")
        .set("Authorization", `Bearer ${courier1.token}`)
        .expect(200);
      const offers1 = record(avail1.body)["offers"] as unknown[];
      expect(offers1).toHaveLength(1);
      expect(record(offers1[0])["orderId"]).toBe(orderId);
      const offerId1 = String(record(offers1[0])["offerId"]);

      const avail2 = await request(server())
        .get("/v1/offers/available")
        .set("Authorization", `Bearer ${courier2.token}`)
        .expect(200);
      const offers2 = record(avail2.body)["offers"] as unknown[];
      expect(offers2).toHaveLength(1);
      expect(record(offers2[0])["orderId"]).toBe(orderId);
      const offerId2 = String(record(offers2[0])["offerId"]);

      // Domiciliario 1 acepta la oferta
      const accepted = await request(server())
        .post(`/v1/offers/${offerId1}/accept`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .set("Idempotency-Key", "orden-012-accept-1")
        .send({ ack: true })
        .expect(201);
      expect(accepted.body).toEqual({
        offerId: offerId1,
        orderId,
        offerStatus: "ACCEPTED",
        orderStatus: "ACCEPTED",
      });

      const restOrder = await request(server())
        .get(`/v1/orders/${orderId}`)
        .set("Cookie", ownerCookie)
        .expect(200);
      const pickupPin = String(record(restOrder.body)["pickupPin"]);
      expect(pickupPin).toMatch(/^\d{6}$/);

      await assertPublicTrackingStep(
        trackingToken,
        "ACCEPTED",
        ["SEEKING_COURIER", "ACCEPTED"],
        pickupPin,
      );

      // Domiciliario 2 ya no ve la oferta, su oferta queda SUPERSEDED en BD y su accept falla
      const offer2Row = await pool.query<{ status: string }>(
        `SELECT status::text AS status FROM dispatch_offers WHERE id = $1`,
        [offerId2],
      );
      expect(offer2Row.rows[0]?.status).toBe("SUPERSEDED");

      const avail2After = await request(server())
        .get("/v1/offers/available")
        .set("Authorization", `Bearer ${courier2.token}`)
        .expect(200);
      expect(record(avail2After.body)["offers"]).toEqual([]);

      await request(server())
        .post(`/v1/offers/${offerId2}/accept`)
        .set("Authorization", `Bearer ${courier2.token}`)
        .set("Idempotency-Key", "orden-012-accept-2")
        .send({ ack: true })
        .expect(409);

      // Recorrido: ARRIVING_PICKUP -> AT_PICKUP -> PICKED_UP (PIN) -> AT_DROPOFF -> DELIVERED (PIN)
      const arrive = await request(server())
        .post(`/v1/orders/${orderId}/arrive-pickup`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .expect(201);
      expect(record(arrive.body)["status"]).toBe("ARRIVING_PICKUP");
      await assertPublicTrackingStep(
        trackingToken,
        "ARRIVING_PICKUP",
        ["SEEKING_COURIER", "ACCEPTED", "ARRIVING_PICKUP"],
        pickupPin,
      );

      const atPickup = await request(server())
        .post(`/v1/orders/${orderId}/at-pickup`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .expect(201);
      expect(record(atPickup.body)["status"]).toBe("AT_PICKUP");
      await assertPublicTrackingStep(
        trackingToken,
        "AT_PICKUP",
        ["SEEKING_COURIER", "ACCEPTED", "ARRIVING_PICKUP", "AT_PICKUP"],
        pickupPin,
      );

      const pickedUp = await request(server())
        .post(`/v1/orders/${orderId}/pickup-pin`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .send({ pin: pickupPin })
        .expect(201);
      expect(record(pickedUp.body)["status"]).toBe("PICKED_UP");
      await assertPublicTrackingStep(
        trackingToken,
        "PICKED_UP",
        ["SEEKING_COURIER", "ACCEPTED", "ARRIVING_PICKUP", "AT_PICKUP", "PICKED_UP"],
        pickupPin,
      );

      const atDropoff = await request(server())
        .post(`/v1/orders/${orderId}/at-dropoff`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .expect(201);
      expect(record(atDropoff.body)["status"]).toBe("AT_DROPOFF");
      const trackDropoff = await assertPublicTrackingStep(
        trackingToken,
        "AT_DROPOFF",
        ["SEEKING_COURIER", "ACCEPTED", "ARRIVING_PICKUP", "AT_PICKUP", "PICKED_UP", "AT_DROPOFF"],
        pickupPin,
      );
      const deliveryPin = String(trackDropoff["deliveryPin"]);
      expect(deliveryPin).toMatch(/^\d{6}$/);

      const delivered = await request(server())
        .post(`/v1/orders/${orderId}/delivery-pin`)
        .set("Authorization", `Bearer ${courier1.token}`)
        .send({ pin: deliveryPin })
        .expect(201);
      expect(record(delivered.body)["status"]).toBe("DELIVERED");
      await assertPublicTrackingStep(
        trackingToken,
        "DELIVERED",
        [
          "SEEKING_COURIER",
          "ACCEPTED",
          "ARRIVING_PICKUP",
          "AT_PICKUP",
          "PICKED_UP",
          "AT_DROPOFF",
          "DELIVERED",
        ],
        pickupPin,
      );

      // Token revocado: respuesta genérica 404 idéntica a un token nunca emitido
      const revoked = await request(server())
        .post(`/v1/orders/${orderId}/tracking-link/revoke`)
        .set("Cookie", ownerCookie)
        .expect(201);
      expect(revoked.body).toEqual({ revoked: true });

      const neverIssuedToken = randomBytes(24).toString("base64url");
      const afterRevoke = await request(server()).get(`/v1/tracking/${trackingToken}`).expect(404);
      const neverIssued = await request(server())
        .get(`/v1/tracking/${neverIssuedToken}`)
        .expect(404);
      expect(afterRevoke.body).toEqual(neverIssued.body);

      // Admin: stats.ordersByStatus cuadra con la BD
      const statsRes = await request(server())
        .get("/v1/admin/stats")
        .set("Cookie", adminCookie)
        .expect(200);
      const dbOrders = await pool.query<{ status: string; total: number }>(
        `SELECT status::text AS status, COUNT(*)::int AS total FROM orders GROUP BY status`,
      );
      const expectedOrdersByStatus: Record<string, number> = {};
      for (const row of dbOrders.rows) {
        expectedOrdersByStatus[row.status] = row.total;
      }
      expect(record(statsRes.body)["ordersByStatus"]).toEqual(expectedOrdersByStatus);

      // Admin: verification-cases solo trae id, courierId, status
      const casesRes = await request(server())
        .get("/v1/admin/verification-cases")
        .set("Cookie", adminCookie)
        .expect(200);
      const cases = casesRes.body as unknown[];
      expect(cases).toEqual([
        {
          id: pendingCourier.caseId,
          courierId: pendingCourier.courierId,
          status: "PENDING_HUMAN",
        },
      ]);
      expect(Object.keys(record(cases[0])).sort()).toEqual(["courierId", "id", "status"]);
    } finally {
      await pool.end();
    }
  });
});
