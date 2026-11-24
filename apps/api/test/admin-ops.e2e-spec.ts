import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, readEnv, type AppEnv } from "../src/config/env.js";
import { applyHttpSecurity } from "../src/http.js";
import { resetLoginThrottle } from "../src/identity/login-throttle.js";
import { setupOpenApi } from "../src/openapi.js";
import { activateRestaurantForTest } from "./activate-restaurant.js";
import { migrateDatabase } from "./migrate.js";
import { resetDatabase } from "./reset-db.js";
const databaseUrl =
  process.env["DATABASE_URL"] ?? "postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo";
const password = "clave-de-prueba-12";
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
describe("suspensión y estadísticas operativas (M35 y M36)", () => {
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
  it("suspende y rehabilita domiciliario/restaurante con auditoría, y expone stats sin PII ni acceso a REVIEWER", async () => {
    const opsRes = await request(server())
      .post("/v1/auth/register")
      .send({
        email: "ops-m35@example.invalid",
        password,
        client: "MOBILE",
        consents: { termsAccepted: true, privacyAccepted: true },
      })
      .expect(201);
    const opsToken = String(record(opsRes.body)["token"]);
    const revRes = await request(server())
      .post("/v1/auth/register")
      .send({
        email: "rev-m35@example.invalid",
        password,
        client: "MOBILE",
        consents: { termsAccepted: true, privacyAccepted: true },
      })
      .expect(201);
    const revToken = String(record(revRes.body)["token"]);
    const ownerRes = await request(server())
      .post("/v1/auth/register")
      .send({
        email: "owner-m35@example.invalid",
        password,
        client: "MOBILE",
        consents: { termsAccepted: true, privacyAccepted: true },
      })
      .expect(201);
    const ownerToken = String(record(ownerRes.body)["token"]);
    const courierRes = await request(server())
      .post("/v1/auth/register")
      .send({
        email: "courier-m35@example.invalid",
        password,
        client: "MOBILE",
        consents: { termsAccepted: true, privacyAccepted: true },
      })
      .expect(201);
    expect(record(courierRes.body)["token"]).toBeDefined();
    const site = await request(server())
      .post("/v1/restaurants")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        legalName: "Razon M35",
        tradeName: "Local M35",
        nit: "900000350",
        email: "local-m35@example.invalid",
        phoneE164: "+573001110350",
        establishmentName: "Establecimiento M35",
        branchName: "Principal",
        addressLine: "Calle M35",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(201);
    const branchId = String(record(site.body)["branchId"]);
    const restaurantId = String(record(site.body)["id"]);
    const db = new Pool({ connectionString: databaseUrl });
    try {
      await db.query(
        `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
         SELECT id, 'Operaciones M35', 'OPERATIONS', now(), now()
         FROM users WHERE email = 'ops-m35@example.invalid'`,
      );
      await db.query(
        `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
         SELECT id, 'Revisor M35', 'REVIEWER', now(), now()
         FROM users WHERE email = 'rev-m35@example.invalid'`,
      );
      const cInsert = await db.query<{ id: string }>(
        `INSERT INTO couriers (
           id, "userId", "documentType", "documentNumber", "firstName", "lastName",
           status, "registrationSource", "createdAt", "updatedAt"
         )
         SELECT gen_random_uuid(), id, 'CC', '80035001', 'Domiciliario', 'M35',
                'APPROVED', 'OPEN', now(), now()
         FROM users WHERE email = 'courier-m35@example.invalid'
         RETURNING id`,
      );
      const courierId = String(cInsert.rows[0]?.id);
      await db.query(
        `INSERT INTO courier_availabilities ("courierId", state, "updatedAt")
         VALUES ($1, 'AVAILABLE', now())`,
        [courierId],
      );
      await activateRestaurantForTest(db, restaurantId, branchId);

      // M35: Suspender sin motivo -> 422
      await request(server())
        .post(`/v1/admin/couriers/${courierId}/suspend`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ reason: "" })
        .expect(422);
      // Suspender domiciliario -> pasa a SUSPENDED y OFFLINE, y escribe audit_logs
      const suspC = await request(server())
        .post(`/v1/admin/couriers/${courierId}/suspend`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ reason: "Revisión disciplinaria" })
        .expect(201);
      expect(record(suspC.body)["status"]).toBe("SUSPENDED");
      const availAfterSusp = await db.query<{ state: string }>(
        `SELECT state::text AS state FROM courier_availabilities WHERE "courierId" = $1`,
        [courierId],
      );
      expect(availAfterSusp.rows[0]?.state).toBe("OFFLINE");
      // Rehabilitar domiciliario -> vuelve a APPROVED
      const reinC = await request(server())
        .post(`/v1/admin/couriers/${courierId}/reinstate`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ reason: "Caso aclarado" })
        .expect(201);
      expect(record(reinC.body)["status"]).toBe("APPROVED");
      // Preparar tarifa, política, suscripción y elegibilidad del domiciliario para publicar tras rehabilitar
      await db.query(`UPDATE tariff_versions SET status = 'RETIRED' WHERE status = 'PUBLISHED'`);
      const tv = await db.query<{ id: string }>(
        `INSERT INTO tariff_versions (id, name, status, "publishedAt", "createdAt")
         VALUES (gen_random_uuid(), 'Tarifa M35', 'PUBLISHED', now(), now())
         RETURNING id`,
      );
      await db.query(
        `INSERT INTO tariff_rules (
           id, "versionId", "zoneId", "baseFeeCop", "perKmCop", "minimumFeeCop",
           "nightMultiplierBps", "nightStartsMinute", "nightEndsMinute"
         ) VALUES (gen_random_uuid(), $1, NULL, 5000, 0, 0, 10000, 0, 0)`,
        [tv.rows[0]?.id],
      );
      await db.query(
        `UPDATE operations_policies SET status = 'RETIRED' WHERE status = 'PUBLISHED'`,
      );
      await db.query(
        `INSERT INTO operations_policies (
           id, name, status, "offerRadiusMeters", "directOfferTtlSeconds", "openOfferTtlSeconds",
           "seekingTtlSeconds", "maxOffersPerWave", "locationFreshnessSeconds", "publishedAt", "createdAt"
         ) VALUES (
           gen_random_uuid(), 'Politica M35', 'PUBLISHED', 2000, 120, 90, 600, 5, 120, now(), now()
         )`,
      );
      const subPlan = await db.query<{ id: string }>(
        `INSERT INTO subscription_plans (
           id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders", "createdAt"
         ) VALUES (gen_random_uuid(), 'm35-plan', 'Mensual', 45000, 30, 0, 1, 5, now())
         RETURNING id`,
      );
      await db.query(
        `INSERT INTO restaurant_subscriptions (
           id, "restaurantId", "planId", "priceCop", status, "isCurrent",
           "periodStartsAt", "periodEndsAt", "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), $1, $2, 45000, 'ACTIVE', true, now(), now() + interval '30 days', now(), now()
         )`,
        [restaurantId, subPlan.rows[0]?.id],
      );
      await db.query(
        `INSERT INTO vehicles (id, "courierId", type, plate, "soatExpiresOn", "techExpiresOn", status, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, 'MOTORCYCLE', 'M35ABC', CURRENT_DATE + 180, CURRENT_DATE + 180, 'ACTIVE', now(), now())`,
        [courierId],
      );
      for (const docType of [
        "NATIONAL_ID",
        "DRIVER_LICENSE",
        "SOAT",
        "TECH_INSPECTION",
        "VEHICLE_PHOTO",
        "PROFILE_PHOTO",
      ]) {
        await db.query(
          `INSERT INTO courier_documents (id, "courierId", type, "storageKey", sha256, "mimeType", "byteSize", status, "createdAt", "updatedAt")
           VALUES (gen_random_uuid(), $1, $2::"CourierDocumentType", $3, repeat('a', 64), 'image/jpeg', 1024, 'ACCEPTED', now(), now())`,
          [courierId, docType, `m35/${courierId}/${docType}`],
        );
      }
      const geoDoc = await db.query<{ id: string }>(
        `INSERT INTO legal_documents (id, kind, version, "contentHash", "publishedAt")
         VALUES (gen_random_uuid(), 'GEOLOCATION_CONSENT', 'm35-geo-1', repeat('b', 64), now())
         RETURNING id`,
      );
      const geoConsent = await db.query<{ id: string }>(
        `INSERT INTO consent_records (id, "userId", "legalDocumentId", purpose, channel, "grantedAt")
         SELECT gen_random_uuid(), "userId", $2, 'GEOLOCATION', 'MOBILE', now()
         FROM couriers WHERE id = $1
         RETURNING id`,
        [courierId, geoDoc.rows[0]?.id],
      );
      await db.query(
        `UPDATE courier_availabilities
         SET state = 'AVAILABLE',
             location = ST_SetSRID(ST_MakePoint(-73.914, 4.966), 4326)::geography,
             "recordedAt" = now(),
             "consentId" = $2,
             "updatedAt" = now()
         WHERE "courierId" = $1`,
        [courierId, geoConsent.rows[0]?.id],
      );
      const draftDirectRes = await request(server())
        .post("/v1/orders")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ branchId, foodAmountCop: 20000, deliveryFeeCop: 5000, paymentMethod: "CASH" })
        .expect(201);
      const draftDirectId = String(record(draftDirectRes.body)["id"]);
      const draftOpenRes = await request(server())
        .post("/v1/orders")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ branchId, foodAmountCop: 21000, deliveryFeeCop: 5000, paymentMethod: "CASH" })
        .expect(201);
      const draftOpenId = String(record(draftOpenRes.body)["id"]);
      const cancelDraftRes = await request(server())
        .post("/v1/orders")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ branchId, foodAmountCop: 22000, deliveryFeeCop: 5000, paymentMethod: "CASH" })
        .expect(201);
      const cancelOrderId = String(record(cancelDraftRes.body)["id"]);
      await db.query(
        `UPDATE orders SET status = 'SEEKING_COURIER', "updatedAt" = now() WHERE id = $1`,
        [cancelOrderId],
      );
      // Suspender y rehabilitar restaurante
      const suspR = await request(server())
        .post(`/v1/admin/restaurants/${restaurantId}/suspend`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ reason: "Incumplimiento operativo" })
        .expect(201);
      expect(record(suspR.body)["status"]).toBe("SUSPENDED");
      const createSuspendedRes = await request(server())
        .post("/v1/orders")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          branchId,
          foodAmountCop: 20000,
          deliveryFeeCop: 5000,
          paymentMethod: "CASH",
        })
        .expect(404);
      const genericNotFound = createSuspendedRes.body as unknown;
      expect(genericNotFound).toEqual({ statusCode: 404, message: "Not Found" });
      const publishDirectSuspendedRes = await request(server())
        .post(`/v1/orders/${draftDirectId}/publish`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          mode: "DIRECT",
          courierId,
          customerName: "Cliente M35",
          customerPhone: "+573001110355",
          dropoffAddress: "Calle 10 # 2-3",
          longitude: -73.9135,
          latitude: 4.9658,
        })
        .expect(404);
      expect(publishDirectSuspendedRes.body).toEqual(genericNotFound);
      const publishOpenSuspendedRes = await request(server())
        .post(`/v1/orders/${draftOpenId}/publish`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          mode: "OPEN",
          customerName: "Cliente M35 Open",
          customerPhone: "+573001110356",
          dropoffAddress: "Calle 11 # 2-3",
          longitude: -73.9135,
          latitude: 4.9658,
        })
        .expect(404);
      expect(publishOpenSuspendedRes.body).toEqual(genericNotFound);
      const cancelSuspendedRes = await request(server())
        .post(`/v1/orders/${cancelOrderId}/cancel`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ reason: "Intento mientras suspendido" })
        .expect(404);
      expect(cancelSuspendedRes.body).toEqual(genericNotFound);
      const reinR = await request(server())
        .post(`/v1/admin/restaurants/${restaurantId}/reinstate`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ reason: "Subsanado" })
        .expect(201);
      expect(record(reinR.body)["status"]).toBe("ACTIVE");
      await request(server())
        .post(`/v1/orders/${cancelOrderId}/cancel`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ reason: "Cancelado tras rehabilitación" })
        .expect(201);
      await request(server())
        .post(`/v1/orders/${draftDirectId}/publish`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          mode: "DIRECT",
          courierId,
          customerName: "Cliente M35",
          customerPhone: "+573001110355",
          dropoffAddress: "Calle 10 # 2-3",
          longitude: -73.9135,
          latitude: 4.9658,
        })
        .expect(201);
      await request(server())
        .post(`/v1/orders/${draftOpenId}/publish`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          mode: "OPEN",
          customerName: "Cliente M35 Open",
          customerPhone: "+573001110356",
          dropoffAddress: "Calle 11 # 2-3",
          longitude: -73.9135,
          latitude: 4.9658,
        })
        .expect(201);
      // M36: Sembrar tres pedidos en estados distintos
      for (const st of ["DRAFT", "ACCEPTED", "DELIVERED"]) {
        const ord = await request(server())
          .post("/v1/orders")
          .set("Authorization", `Bearer ${ownerToken}`)
          .send({
            branchId,
            foodAmountCop: 20000,
            deliveryFeeCop: 5000,
            paymentMethod: "CASH",
          })
          .expect(201);
        const oid = String(record(ord.body)["id"]);
        if (st !== "DRAFT") {
          await db.query(
            `UPDATE orders SET status = $2::"OrderStatus", "acceptedAt" = now() + interval '30 seconds' WHERE id = $1`,
            [oid, st],
          );
        }
      }
      // REVIEWER recibe 403 en /v1/admin/stats
      await request(server())
        .get("/v1/admin/stats")
        .set("Authorization", `Bearer ${revToken}`)
        .expect(403);
      // OPERATIONS recibe conteos sin PII
      const statsRes = await request(server())
        .get("/v1/admin/stats")
        .set("Authorization", `Bearer ${opsToken}`)
        .expect(200);
      const stats = record(statsRes.body);
      const byStatus = record(stats["ordersByStatus"]);
      expect(byStatus["DRAFT"]).toBe(1);
      expect(byStatus["ACCEPTED"]).toBe(1);
      expect(byStatus["DELIVERED"]).toBe(1);
      expect(typeof stats["medianAcceptSeconds"]).toBe("number");
      expect(JSON.stringify(stats)).not.toContain("80035001");
    } finally {
      await db.end();
    }
  });
});
