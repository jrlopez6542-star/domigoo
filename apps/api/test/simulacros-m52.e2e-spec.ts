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
const password = "clave-simulacro-m52";
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

async function registerUser(email: string): Promise<string> {
  const res = await request(server())
    .post("/v1/auth/register")
    .send({
      email,
      password,
      client: "MOBILE",
      consents: { termsAccepted: true, privacyAccepted: true },
    })
    .expect(201);
  return String(record(res.body)["token"]);
}

async function setupBaseWorld(): Promise<{
  pool: Pool;
  adminToken: string;
  ownerToken: string;
  otherOwnerToken: string;
  clientToken: string;
  courier1Token: string;
  courier2Token: string;
  branchId: string;
}> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    // Register real admin via auth + update admin_profiles so we have a valid session token
    const adminToken = await registerUser("sim-m52-ops@ejemplo.com");
    const opsUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'sim-m52-ops@ejemplo.com'`,
    );
    await pool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Operaciones Simulacro', 'SUPERADMIN', now(), now())`,
      [String(opsUser.rows[0]?.id)],
    );

    // Legal docs
    const docLegal = await pool.query<{ id: string }>(
      `INSERT INTO legal_documents (id, kind, version, "contentHash", "publishedAt")
       VALUES (gen_random_uuid(), 'DOCUMENT_PROCESSING', 'sim-doc-1', 'hash1', now()) RETURNING id`,
    );
    const gpsLegal = await pool.query<{ id: string }>(
      `INSERT INTO legal_documents (id, kind, version, "contentHash", "publishedAt")
       VALUES (gen_random_uuid(), 'GEOLOCATION_CONSENT', 'sim-gps-1', 'hash2', now()) RETURNING id`,
    );
    const docLegalId = String(docLegal.rows[0]?.id);
    const gpsLegalId = String(gpsLegal.rows[0]?.id);

    // Tariff & Policy (reutiliza publicados si ya existen tras seed/migración)
    const existingTariff = await pool.query<{ id: string }>(
      `SELECT id FROM tariff_versions WHERE status = 'PUBLISHED' LIMIT 1`,
    );
    if (existingTariff.rows[0] === undefined) {
      const tariff = await pool.query<{ id: string }>(
        `INSERT INTO tariff_versions (id, name, status, "publishedAt", "createdAt")
         VALUES (gen_random_uuid(), 'Tarifa Simulacro', 'PUBLISHED', now(), now()) RETURNING id`,
      );
      await pool.query(
        `INSERT INTO tariff_rules (
           id, "versionId", "zoneId", "baseFeeCop", "perKmCop", "minimumFeeCop",
           "nightMultiplierBps", "nightStartsMinute", "nightEndsMinute"
         ) VALUES (gen_random_uuid(), $1, NULL, 5500, 0, 0, 10000, 0, 0)`,
        [String(tariff.rows[0]?.id)],
      );
    }
    const existingPolicy = await pool.query<{ id: string }>(
      `SELECT id FROM operations_policies WHERE status = 'PUBLISHED' LIMIT 1`,
    );
    if (existingPolicy.rows[0] === undefined) {
      await pool.query(
        `INSERT INTO operations_policies (
           id, name, status, "offerRadiusMeters", "directOfferTtlSeconds", "openOfferTtlSeconds",
           "seekingTtlSeconds", "maxOffersPerWave", "locationFreshnessSeconds", "maxPinAttempts", "publishedAt", "createdAt"
         ) VALUES (
           gen_random_uuid(), 'Politica Simulacro', 'PUBLISHED', 3000, 120, 120, 600, 4, 120, 5, now(), now()
         )`,
      );
    }

    // Plan
    await pool.query(
      `INSERT INTO subscription_plans (
       id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders"
     ) VALUES (gen_random_uuid(), 'TRIAL_15D', 'Prueba 15 dias', 0, 15, 15, 2, 10)
     ON CONFLICT (code) DO NOTHING`,
    );

    // Restaurant 1 + Branch in Tocancipá
    const ownerToken = await registerUser("sim-m52-restaurante@ejemplo.com");
    const restRes = await request(server())
      .post("/v1/restaurants")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        legalName: "Simulacro Cocina SAS",
        tradeName: "[SIM-M52] Cocina Tocancipa",
        nit: "900520001",
        email: "sim-m52-contacto@ejemplo.com",
        phoneE164: "+573000005201",
        establishmentName: "Sede Centro",
        branchName: "Principal Tocancipa",
        addressLine: "Calle Ficticia 12 # 5-30, Tocancipa",
        longitude: -73.9132,
        latitude: 4.9655,
        hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          opensMinute: 0,
          closesMinute: 1439,
        })),
      })
      .expect(201);
    const branchId = String(record(restRes.body)["branchId"]);

    // Restaurant 2 (for isolation)
    const otherOwnerToken = await registerUser("sim-m52-otro-restaurante@ejemplo.com");
    await request(server())
      .post("/v1/restaurants")
      .set("Authorization", `Bearer ${otherOwnerToken}`)
      .send({
        legalName: "Otro Restaurante SAS",
        tradeName: "Otro Restaurante",
        nit: "900520099",
        email: "sim-m52-otro@ejemplo.com",
        phoneE164: "+573000005299",
        establishmentName: "Sede Norte",
        branchName: "Norte Tocancipa",
        addressLine: "Carrera Ficticia 8 # 10-20",
        longitude: -73.912,
        latitude: 4.968,
        hours: [{ weekday: 1, opensMinute: 0, closesMinute: 1439 }],
      })
      .expect(201);

    // Client 1
    const clientToken = await registerUser("sim-m52-cliente1@ejemplo.com");

    // Approve 2 Couriers with location near Tocancipá branch
    const approveOne = async (
      email: string,
      docNum: string,
      plate: string,
      lng: number,
      lat: number,
    ) => {
      const token = await registerUser(email);
      await request(server())
        .post("/v1/consents")
        .set("Authorization", `Bearer ${token}`)
        .send({ legalDocumentId: docLegalId, purpose: "DOCUMENT_STORAGE", channel: "MOBILE" })
        .expect(201);
      const gpsConsent = await request(server())
        .post("/v1/consents")
        .set("Authorization", `Bearer ${token}`)
        .send({ legalDocumentId: gpsLegalId, purpose: "GEOLOCATION", channel: "MOBILE" })
        .expect(201);
      const consentId = String(record(gpsConsent.body)["id"]);
      await request(server())
        .post("/v1/couriers")
        .set("Authorization", `Bearer ${token}`)
        .send({ documentType: "CC", documentNumber: docNum, firstName: "Sim", lastName: "Courier" })
        .expect(201);
      for (const type of documentTypes) {
        await request(server())
          .post("/v1/couriers/me/documents")
          .set("Authorization", `Bearer ${token}`)
          .field("type", type)
          .attach("file", pdf, { filename: "sim.pdf", contentType: "application/pdf" })
          .expect(201);
      }
      await request(server())
        .post("/v1/couriers/me/vehicle")
        .set("Authorization", `Bearer ${token}`)
        .send({ plate, soatExpiresOn: "2028-04-01", techExpiresOn: "2028-08-01" })
        .expect(201);
      const opened = await request(server())
        .post("/v1/couriers/me/verification-cases")
        .set("Authorization", `Bearer ${token}`)
        .expect(201);
      await request(server())
        .post(`/v1/admin/verification-cases/${String(record(opened.body)["id"])}/decision`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ outcome: "APPROVED", reasonCode: "OK", comment: "Simulacro aprobado" })
        .expect(201);
      await request(server())
        .post("/v1/couriers/me/availability")
        .set("Authorization", `Bearer ${token}`)
        .send({ state: "AVAILABLE", consentId })
        .expect(201);
      await request(server())
        .post("/v1/couriers/me/location")
        .set("Authorization", `Bearer ${token}`)
        .send({ longitude: lng, latitude: lat, accuracyM: 10 })
        .expect(201);
      return token;
    };

    const courier1Token = await approveOne(
      "sim-m52-domiciliario1@ejemplo.com",
      "9005200001",
      "SIM52A",
      -73.914,
      4.966,
    );
    const courier2Token = await approveOne(
      "sim-m52-domiciliario2@ejemplo.com",
      "9005200002",
      "SIM52B",
      -73.915,
      4.967,
    );

    return {
      pool,
      adminToken,
      ownerToken,
      otherOwnerToken,
      clientToken,
      courier1Token,
      courier2Token,
      branchId,
    };
  } catch (err) {
    await pool.end();
    throw err;
  }
}

async function createAndPublishOrder(ownerToken: string, branchId: string) {
  const quote = await request(server())
    .post("/v1/tariffs/quote")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({
      origin: { longitude: -73.9132, latitude: 4.9655 },
      destination: { longitude: -73.918, latitude: 4.97 },
      at: new Date().toISOString(),
    })
    .expect(201);
  const deliveryFeeCop = Number(record(quote.body)["deliveryFeeCop"]);

  const draft = await request(server())
    .post("/v1/orders")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({
      branchId,
      foodAmountCop: 32000,
      deliveryFeeCop,
      paymentMethod: "CASH",
    })
    .expect(201);
  const orderId = String(record(draft.body)["id"]);

  const published = await request(server())
    .post(`/v1/orders/${orderId}/publish`)
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({
      mode: "OPEN",
      customerName: "Cliente Simulacro",
      customerPhone: "+573000005211",
      dropoffAddress: "Carrera Ficticia 7 # 14-22, Tocancipa",
      longitude: -73.918,
      latitude: 4.97,
    })
    .expect(201);

  return {
    orderId,
    offers: record(published.body)["offers"] as Array<{ id: string }>,
  };
}

describe("Simulacros M52 — Escenarios API (a-h)", () => {
  const env = readEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO" });
  let pool: Pool | undefined;

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
    if (pool !== undefined) {
      await pool.end();
      pool = undefined;
    }
  });

  it("a) camino feliz completo + b) rechazo y aceptación por otro + c) concurrencia + g) aislamiento + h) tracking", async () => {
    const world = await setupBaseWorld();
    pool = world.pool;

    // 1. Escenario c): Concurrencia al aceptar oferta abierta
    const { orderId, offers } = await createAndPublishOrder(world.ownerToken, world.branchId);
    expect(offers.length).toBe(2);

    const c1Offers = await request(server())
      .get("/v1/offers/available")
      .set("Authorization", `Bearer ${world.courier1Token}`)
      .expect(200);
    const c2Offers = await request(server())
      .get("/v1/offers/available")
      .set("Authorization", `Bearer ${world.courier2Token}`)
      .expect(200);
    const c1OfferId = String(
      (record(c1Offers.body)["offers"] as Array<{ offerId: string }>)[0]?.offerId,
    );
    const c2OfferId = String(
      (record(c2Offers.body)["offers"] as Array<{ offerId: string }>)[0]?.offerId,
    );

    const [accept1, accept2] = await Promise.all([
      request(server())
        .post(`/v1/offers/${c1OfferId}/accept`)
        .set("Authorization", `Bearer ${world.courier1Token}`)
        .set("Idempotency-Key", "sim-conc-1")
        .send({}),
      request(server())
        .post(`/v1/offers/${c2OfferId}/accept`)
        .set("Authorization", `Bearer ${world.courier2Token}`)
        .set("Idempotency-Key", "sim-conc-2")
        .send({}),
    ]);

    const statuses = [accept1.status, accept2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winnerToken = accept1.status === 201 ? world.courier1Token : world.courier2Token;
    const loserToken = accept1.status === 201 ? world.courier2Token : world.courier1Token;
    const loserRes = accept1.status === 409 ? accept1 : accept2;
    expect(String(record(loserRes.body)["message"])).toMatch(/ya no se puede aceptar/i);

    // 2. Escenario g): Aislamiento (403/404 sin filtrar datos del pedido)
    const assertIsolated = (res: request.Response) => {
      expect([403, 404]).toContain(res.status);
      const body = record(res.body);
      expect(body["id"]).toBeUndefined();
      expect(body["pickupPin"]).toBeUndefined();
      expect(body["deliveryPin"]).toBeUndefined();
      expect(body["dropoffAddress"]).toBeUndefined();
    };

    assertIsolated(
      await request(server())
        .get(`/v1/orders/${orderId}`)
        .set("Authorization", `Bearer ${world.clientToken}`),
    );
    assertIsolated(
      await request(server())
        .get(`/v1/orders/${orderId}`)
        .set("Authorization", `Bearer ${world.otherOwnerToken}`),
    );
    assertIsolated(
      await request(server())
        .get(`/v1/orders/${orderId}`)
        .set("Authorization", `Bearer ${loserToken}`),
    );
    assertIsolated(
      await request(server())
        .post(`/v1/orders/${orderId}/arrive-pickup`)
        .set("Authorization", `Bearer ${loserToken}`),
    );
    assertIsolated(
      await request(server())
        .post(`/v1/orders/${orderId}/cancel`)
        .set("Authorization", `Bearer ${loserToken}`)
        .send({ reason: "Intento no autorizado" }),
    );

    // 3. Emitir tracking link y verificar flujo completo (Escenario a)
    const trkRes = await request(server())
      .post(`/v1/orders/${orderId}/tracking-link`)
      .set("Authorization", `Bearer ${world.ownerToken}`)
      .send({})
      .expect(201);
    const trackingToken = String(record(trkRes.body)["token"]);

    const restView = await request(server())
      .get(`/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${world.ownerToken}`)
      .expect(200);
    const pickupPin = String(record(restView.body)["pickupPin"]);
    expect(pickupPin).toMatch(/^\d{6}$/);

    await request(server())
      .post(`/v1/orders/${orderId}/arrive-pickup`)
      .set("Authorization", `Bearer ${winnerToken}`)
      .expect(201);
    await request(server())
      .post(`/v1/orders/${orderId}/at-pickup`)
      .set("Authorization", `Bearer ${winnerToken}`)
      .expect(201);
    await request(server())
      .post(`/v1/orders/${orderId}/pickup-pin`)
      .set("Authorization", `Bearer ${winnerToken}`)
      .send({ pin: pickupPin })
      .expect(201);

    const trkPickedUp = await request(server()).get(`/v1/tracking/${trackingToken}`).expect(200);
    expect(record(trkPickedUp.body)["status"]).toBe("PICKED_UP");
    const deliveryPin = String(record(trkPickedUp.body)["deliveryPin"]);
    expect(deliveryPin).toMatch(/^\d{6}$/);

    await request(server())
      .post(`/v1/orders/${orderId}/at-dropoff`)
      .set("Authorization", `Bearer ${winnerToken}`)
      .expect(201);
    await request(server())
      .post(`/v1/orders/${orderId}/delivery-pin`)
      .set("Authorization", `Bearer ${winnerToken}`)
      .send({ pin: deliveryPin })
      .expect(201);

    const trkDelivered = await request(server()).get(`/v1/tracking/${trackingToken}`).expect(200);
    expect(record(trkDelivered.body)["status"]).toBe("DELIVERED");

    // 4. Escenario h): Enlace público inválido o revocado
    await request(server()).get("/v1/tracking/token-invalido-m52").expect(404);
    await request(server())
      .post(`/v1/orders/${orderId}/tracking-link/revoke`)
      .set("Authorization", `Bearer ${world.ownerToken}`)
      .send({})
      .expect(201);
    await request(server()).get(`/v1/tracking/${trackingToken}`).expect(404);

    // 5. Escenario b): Domiciliario 1 rechaza, Domiciliario 2 acepta
    const order2 = await createAndPublishOrder(world.ownerToken, world.branchId);
    const o2c1 = await request(server())
      .get("/v1/offers/available")
      .set("Authorization", `Bearer ${world.courier1Token}`)
      .expect(200);
    const o2c2 = await request(server())
      .get("/v1/offers/available")
      .set("Authorization", `Bearer ${world.courier2Token}`)
      .expect(200);
    const offerIdC1 = String(
      (record(o2c1.body)["offers"] as Array<{ offerId: string }>)[0]?.offerId,
    );
    const offerIdC2 = String(
      (record(o2c2.body)["offers"] as Array<{ offerId: string }>)[0]?.offerId,
    );

    await request(server())
      .post(`/v1/offers/${offerIdC1}/decline`)
      .set("Authorization", `Bearer ${world.courier1Token}`)
      .expect(201);

    const restAfterDecline = await request(server())
      .get(`/v1/orders/${order2.orderId}`)
      .set("Authorization", `Bearer ${world.ownerToken}`)
      .expect(200);
    expect(record(restAfterDecline.body)["status"]).toBe("SEEKING_COURIER");

    await request(server())
      .post(`/v1/offers/${offerIdC2}/accept`)
      .set("Authorization", `Bearer ${world.courier2Token}`)
      .set("Idempotency-Key", "sim-b-accept")
      .send({})
      .expect(201);
  });

  it("d) PIN incorrecto rechaza y bloquea tras límite de intentos + e) cancelación y bloqueo posterior + f) sin domiciliarios", async () => {
    const world = await setupBaseWorld();
    pool = world.pool;

    // Escenario d): PIN incorrecto y límite de 5 intentos
    const orderD = await createAndPublishOrder(world.ownerToken, world.branchId);
    const c1Offers = await request(server())
      .get("/v1/offers/available")
      .set("Authorization", `Bearer ${world.courier1Token}`)
      .expect(200);
    const offerId = String(
      (record(c1Offers.body)["offers"] as Array<{ offerId: string }>)[0]?.offerId,
    );
    await request(server())
      .post(`/v1/offers/${offerId}/accept`)
      .set("Authorization", `Bearer ${world.courier1Token}`)
      .set("Idempotency-Key", "sim-d-accept")
      .send({})
      .expect(201);

    await request(server())
      .post(`/v1/orders/${orderD.orderId}/arrive-pickup`)
      .set("Authorization", `Bearer ${world.courier1Token}`)
      .expect(201);
    await request(server())
      .post(`/v1/orders/${orderD.orderId}/at-pickup`)
      .set("Authorization", `Bearer ${world.courier1Token}`)
      .expect(201);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const bad = await request(server())
        .post(`/v1/orders/${orderD.orderId}/pickup-pin`)
        .set("Authorization", `Bearer ${world.courier1Token}`)
        .send({ pin: "000000" })
        .expect(422);
      expect(record(bad.body)["attempts"]).toBe(attempt);
    }

    // 6to intento queda bloqueado (422/423) incluso con PIN real y no avanza el estado
    const restD = await request(server())
      .get(`/v1/orders/${orderD.orderId}`)
      .set("Authorization", `Bearer ${world.ownerToken}`)
      .expect(200);
    expect(record(restD.body)["status"]).toBe("AT_PICKUP");
    const lockedRes = await request(server())
      .post(`/v1/orders/${orderD.orderId}/pickup-pin`)
      .set("Authorization", `Bearer ${world.courier1Token}`)
      .send({ pin: String(record(restD.body)["pickupPin"]) });
    expect([422, 423]).toContain(lockedRes.status);
    const afterLockD = await request(server())
      .get(`/v1/orders/${orderD.orderId}`)
      .set("Authorization", `Bearer ${world.ownerToken}`)
      .expect(200);
    expect(record(afterLockD.body)["status"]).toBe("AT_PICKUP");

    // Escenario e): Cancelación por domiciliario en AT_PICKUP libera disponibilidad y bloquea avances
    await request(server())
      .post(`/v1/orders/${orderD.orderId}/cancel`)
      .set("Authorization", `Bearer ${world.courier1Token}`)
      .send({ reason: "Cancelacion por bloqueo de PIN en simulacro" })
      .expect(201);
    await request(server())
      .post(`/v1/orders/${orderD.orderId}/at-dropoff`)
      .set("Authorization", `Bearer ${world.courier1Token}`)
      .expect(422);

    // Escenario f): Sin domiciliarios disponibles (por rechazo de todos o sin elegibles)
    const orderF = await createAndPublishOrder(world.ownerToken, world.branchId);
    const fTrk = await request(server())
      .post(`/v1/orders/${orderF.orderId}/tracking-link`)
      .set("Authorization", `Bearer ${world.ownerToken}`)
      .send({})
      .expect(201);
    const fToken = String(record(fTrk.body)["token"]);

    const f1 = await request(server())
      .get("/v1/offers/available")
      .set("Authorization", `Bearer ${world.courier1Token}`)
      .expect(200);
    const f2 = await request(server())
      .get("/v1/offers/available")
      .set("Authorization", `Bearer ${world.courier2Token}`)
      .expect(200);
    await request(server())
      .post(
        `/v1/offers/${String((record(f1.body)["offers"] as Array<{ offerId: string }>)[0]?.offerId)}/decline`,
      )
      .set("Authorization", `Bearer ${world.courier1Token}`)
      .expect(201);
    await request(server())
      .post(
        `/v1/offers/${String((record(f2.body)["offers"] as Array<{ offerId: string }>)[0]?.offerId)}/decline`,
      )
      .set("Authorization", `Bearer ${world.courier2Token}`)
      .expect(201);

    const restF = await request(server())
      .get(`/v1/orders/${orderF.orderId}`)
      .set("Authorization", `Bearer ${world.ownerToken}`)
      .expect(200);
    expect(record(restF.body)["status"]).toBe("SEEKING_COURIER");
    const pubF = await request(server()).get(`/v1/tracking/${fToken}`).expect(200);
    expect(record(pubF.body)["status"]).toBe("SEEKING_COURIER");
  });
});
