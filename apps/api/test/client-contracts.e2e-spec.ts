import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, readEnv, type AppEnv } from "../src/config/env.js";
import { applyHttpSecurity } from "../src/http.js";
import { resetLoginThrottle } from "../src/identity/login-throttle.js";
import { migrateDatabase } from "./migrate.js";
import { resetDatabase } from "./reset-db.js";

async function createApp(env: AppEnv): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_ENV)
    .useValue(env)
    .compile();
  const app = moduleRef.createNestApplication();
  applyHttpSecurity(app);
  await app.init();
  return app;
}

const databaseUrl = process.env["DATABASE_URL"];
const describeDb = databaseUrl ? describe : describe.skip;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("Cuerpo inesperado");
  }
  return value as Record<string, unknown>;
}

describeDb("Contratos HTTP reales para Web, Admin y Móvil (M39)", () => {
  let currentApp: INestApplication | undefined;
  const password = "ClaveSeguraContratos123";

  function server(): Parameters<typeof request>[0] {
    if (!currentApp) {
      throw new Error("Aplicación no iniciada");
    }
    return currentApp.getHttpServer() as Parameters<typeof request>[0];
  }

  beforeAll(() => {
    if (databaseUrl) {
      migrateDatabase(databaseUrl);
    }
  });

  beforeEach(async () => {
    if (!databaseUrl) return;
    resetLoginThrottle();
    await resetDatabase(databaseUrl);
    currentApp = await createApp(readEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO" }));
  });

  afterEach(async () => {
    await currentApp?.close();
    currentApp = undefined;
  });

  it("valida contratos de login (email y phoneE164), restaurante (10 campos), cotización, decisión admin y disponibilidad/ubicación móvil", async () => {
    if (!databaseUrl) return;

    // 1. Login con email (WEB) y teléfono E.164 (MOBILE) + rechazo 400 si falta identificador
    await request(server())
      .post("/v1/auth/register")
      .send({ email: "rest-m39@example.invalid", password, client: "WEB" })
      .expect(201);

    const webLogin = await request(server())
      .post("/v1/auth/login")
      .send({ email: "rest-m39@example.invalid", password, client: "WEB" })
      .expect(200);
    const webCookie = webLogin.headers["set-cookie"]?.[0] ?? "";
    expect(webCookie).toContain("domigoo_session=");

    await request(server())
      .post("/v1/auth/register")
      .send({ phoneE164: "+573001119939", password, client: "MOBILE" })
      .expect(201);

    const mobileLogin = await request(server())
      .post("/v1/auth/login")
      .send({ phoneE164: "+573001119939", password, client: "MOBILE" })
      .expect(200);
    const mobileToken = String(record(mobileLogin.body)["token"]);
    expect(mobileToken.length).toBeGreaterThan(10);

    await request(server())
      .post("/v1/auth/login")
      .send({ phone: "+573001119939", password, client: "MOBILE" })
      .expect(400);

    // 2. Registro de restaurante: 10 campos requeridos (legacy 'address' debe fallar con 404)
    await request(server())
      .post("/v1/restaurants")
      .set("Cookie", webCookie)
      .send({
        legalName: "Restaurante M39 SAS",
        tradeName: "M39 Burger",
        nit: "900111222",
        branchName: "Principal",
        address: "Calle vieja",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(404);

    const createdSite = await request(server())
      .post("/v1/restaurants")
      .set("Cookie", webCookie)
      .send({
        legalName: "Restaurante M39 SAS",
        tradeName: "M39 Burger",
        nit: "900111222",
        email: "contacto-m39@example.invalid",
        phoneE164: "+573002223344",
        establishmentName: "Sede M39",
        branchName: "Principal",
        addressLine: "Calle 10 # 5-20",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(201);
    expect(record(createdSite.body)["status"]).toBe("DRAFT");

    // 3. Admin login (ADMIN), tarifa publicada y cotización desde sesión de restaurante (/v1/tariffs/quote)
    await request(server())
      .post("/v1/auth/register")
      .send({ email: "admin-m39@example.invalid", password, client: "ADMIN" })
      .expect(201);
    const adminLogin = await request(server())
      .post("/v1/auth/login")
      .send({ email: "admin-m39@example.invalid", password, client: "ADMIN" })
      .expect(200);
    const adminCookie = adminLogin.headers["set-cookie"]?.[0] ?? "";

    const db = new Pool({ connectionString: databaseUrl });
    try {
      await db.query(
        `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
         SELECT id, 'Admin M39', 'SUPERADMIN', now(), now()
         FROM users WHERE email = 'admin-m39@example.invalid'`,
      );

      const ver = await request(server())
        .post("/v1/admin/tariffs/versions")
        .set("Cookie", adminCookie)
        .send({ name: "Tarifa M39" })
        .expect(201);
      const versionId = String(record(ver.body)["id"]);
      await request(server())
        .post("/v1/admin/tariffs/rules")
        .set("Cookie", adminCookie)
        .send({
          versionId,
          zoneId: null,
          baseFeeCop: 5000,
          perKmCop: 1000,
          minimumFeeCop: 5000,
          nightMultiplierBps: 10000,
          nightStartsMinute: 1320,
          nightEndsMinute: 300,
        })
        .expect(201);
      await request(server())
        .post("/v1/admin/tariffs/publish")
        .set("Cookie", adminCookie)
        .send({ versionId })
        .expect(201);

      // Restaurante autenticado puede cotizar en /v1/tariffs/quote, pero recibe 404 en /v1/admin/tariffs/quote (AdminGuard oculta existencia)
      await request(server())
        .post("/v1/admin/tariffs/quote")
        .set("Cookie", webCookie)
        .send({
          origin: { longitude: -73.9132, latitude: 4.9655 },
          destination: { longitude: -73.915, latitude: 4.967 },
          at: new Date().toISOString(),
        })
        .expect(404);

      const quote = await request(server())
        .post("/v1/tariffs/quote")
        .set("Cookie", webCookie)
        .send({
          origin: { longitude: -73.9132, latitude: 4.9655 },
          destination: { longitude: -73.915, latitude: 4.967 },
          at: new Date().toISOString(),
        })
        .expect(201);
      expect(typeof record(quote.body)["deliveryFeeCop"]).toBe("number");

      // 4. Decisión administrativa: legacy { decision, reason } debe fallar 422; { outcome, reasonCode, comment } pasa
      const courierInsert = await db.query<{ id: string }>(
        `INSERT INTO couriers (
           id, "userId", "documentType", "documentNumber", "firstName", "lastName",
           status, "registrationSource", "createdAt", "updatedAt"
         )
         SELECT gen_random_uuid(), id, 'CC', '80039001', 'Domiciliario', 'M39',
                'PENDING_VERIFICATION', 'OPEN', now(), now()
         FROM users WHERE "phoneE164" = '+573001119939'
         RETURNING id`,
      );
      const courierId = String(courierInsert.rows[0]?.id);
      const caseInsert = await db.query<{ id: string }>(
        `INSERT INTO verification_cases (id, "courierId", status, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, 'PENDING_HUMAN', now(), now())
         RETURNING id`,
        [courierId],
      );
      const caseId = String(caseInsert.rows[0]?.id);

      await request(server())
        .post(`/v1/admin/verification-cases/${caseId}/decision`)
        .set("Cookie", adminCookie)
        .send({ decision: "APPROVED", reason: "Legacy" })
        .expect(422);

      const decided = await request(server())
        .post(`/v1/admin/verification-cases/${caseId}/decision`)
        .set("Cookie", adminCookie)
        .send({
          outcome: "APPROVED",
          reasonCode: "DOCS_VERIFIED",
          comment: "Documentos completos y legibles",
        })
        .expect(201);
      expect(record(decided.body)["decided"]).toBe(true);

      // 5. Disponibilidad móvil ({ state }, no { status }) y ubicación ({ longitude, latitude, accuracyM })
      await request(server())
        .post("/v1/couriers/me/availability")
        .set("Authorization", `Bearer ${mobileToken}`)
        .send({ status: "AVAILABLE" })
        .expect(404);

      const avail = await request(server())
        .post("/v1/couriers/me/availability")
        .set("Authorization", `Bearer ${mobileToken}`)
        .send({ state: "AVAILABLE" })
        .expect(201);
      expect(record(avail.body)["state"]).toBe("AVAILABLE");

      // Sin consentimiento GEOLOCATION -> 422
      await request(server())
        .post("/v1/couriers/me/location")
        .set("Authorization", `Bearer ${mobileToken}`)
        .send({ longitude: -73.9132, latitude: 4.9655, accuracyM: 12 })
        .expect(422);

      const legalDoc = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({
          kind: "GEOLOCATION_CONSENT",
          version: "2026-m39-gps",
          content: "Consentimiento GPS M39",
        })
        .expect(201);
      await request(server())
        .post("/v1/consents")
        .set("Authorization", `Bearer ${mobileToken}`)
        .send({
          legalDocumentId: record(legalDoc.body)["id"],
          purpose: "GEOLOCATION",
          channel: "MOBILE",
        })
        .expect(201);

      const ping = await request(server())
        .post("/v1/couriers/me/location")
        .set("Authorization", `Bearer ${mobileToken}`)
        .send({ longitude: -73.9132, latitude: 4.9655, accuracyM: 12 })
        .expect(201);
      expect(record(ping.body)["recorded"]).toBe(true);
    } finally {
      await db.end();
    }
  });
});
