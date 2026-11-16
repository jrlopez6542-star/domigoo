import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
const branchPoint = { longitude: -73.9132, latitude: 4.9655 };
const nearPoint = { longitude: -73.92, latitude: 4.97, accuracyM: 12 };
const farPoint = { longitude: -73.9132, latitude: 5.0105, accuracyM: 12 };

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

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("La lista no es un arreglo");
  }
  return value.map((item) => String(record(item)["id"]));
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
): Promise<string> {
  await request(server())
    .post("/v1/consents")
    .set("Authorization", `Bearer ${token}`)
    .send({ legalDocumentId, purpose: "DOCUMENT_STORAGE", channel: "MOBILE" })
    .expect(201);
  const created = await request(server())
    .post("/v1/couriers")
    .set("Authorization", `Bearer ${token}`)
    .send({
      documentType: "CC",
      documentNumber,
      firstName: "Persona",
      lastName: "Sintetica",
    })
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
  return String(record(created.body)["id"]);
}

describe("disponibilidad y radio", () => {
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
    await pool.query(`DELETE FROM operations_policies WHERE name = 'Radio de prueba'`);
    await pool.end();
  });

  it("devuelve solo al domiciliario fresco dentro de 2 km y no lee el historial", async () => {
    const owner = await register("dueno-radio@example.invalid");
    const reviewer = await register("revisor-radio@example.invalid");
    const near = await register("cerca@example.invalid");
    const far = await register("lejos@example.invalid");
    const stranger = await register("ajeno-radio@example.invalid");
    const pool = new Pool({ connectionString: databaseUrl });
    const reviewerUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'revisor-radio@example.invalid'`,
    );
    await pool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Revisor', 'REVIEWER', now(), now())`,
      [reviewerUser.rows[0]?.id],
    );
    await pool.query(
      `UPDATE operations_policies SET status = 'RETIRED' WHERE status = 'PUBLISHED'`,
    );
    await pool.query(
      `INSERT INTO operations_policies (
         id, name, status, "offerRadiusMeters", "directOfferTtlSeconds", "openOfferTtlSeconds",
         "seekingTtlSeconds", "maxOffersPerWave", "locationFreshnessSeconds", "publishedAt", "createdAt"
       ) VALUES (
         gen_random_uuid(), 'Radio de prueba', 'PUBLISHED', 2000, 60, 60, 600, 5, 120, now(), now()
       )`,
    );
    await pool.end();

    const documents = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${reviewer}`)
      .send({
        kind: "DOCUMENT_PROCESSING",
        version: "2026-radio-docs",
        content: "Texto sintetico de tratamiento de documentos de prueba",
      })
      .expect(201);
    const geolocation = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${reviewer}`)
      .send({
        kind: "GEOLOCATION_CONSENT",
        version: "2026-radio-gps",
        content: "Texto sintetico de geolocalizacion de prueba",
      })
      .expect(201);
    const legalDocumentId = String(record(documents.body)["id"]);
    const nearId = await approveCourier(near, reviewer, legalDocumentId, "9000000201", "ABC20A");
    const farId = await approveCourier(far, reviewer, legalDocumentId, "9000000202", "ABC20B");

    const site = await request(server())
      .post("/v1/restaurants")
      .set("Authorization", `Bearer ${owner}`)
      .send({
        legalName: "Razon radio",
        tradeName: "Local radio",
        nit: "900000200",
        email: "local-radio@example.invalid",
        phoneE164: "+573001110200",
        establishmentName: "Establecimiento",
        branchName: "Principal",
        addressLine: "Calle sintetica",
        ...branchPoint,
      })
      .expect(201);
    const branchId = String(record(site.body)["branchId"]);

    await request(server())
      .post("/v1/couriers/me/availability")
      .set("Authorization", `Bearer ${near}`)
      .send({ state: "AVAILABLE" })
      .expect(422);
    await request(server())
      .post("/v1/couriers/me/location")
      .set("Authorization", `Bearer ${near}`)
      .send(nearPoint)
      .expect(422);

    for (const token of [near, far]) {
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
    }
    await request(server())
      .post("/v1/couriers/me/location")
      .set("Authorization", `Bearer ${near}`)
      .send(nearPoint)
      .expect(201);
    await request(server())
      .post("/v1/couriers/me/location")
      .set("Authorization", `Bearer ${far}`)
      .send(farPoint)
      .expect(201);

    const listed = await request(server())
      .get(`/v1/branches/${branchId}/couriers`)
      .query({ radiusMeters: 2000 })
      .set("Authorization", `Bearer ${owner}`)
      .expect(200);
    expect(ids(listed.body)).toEqual([nearId]);
    expect(JSON.stringify(listed.body)).not.toMatch(/phone|documentNumber/);

    const pings = new Pool({ connectionString: databaseUrl });
    const pingCount = await pings.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM location_pings WHERE "courierId" = $1`,
      [nearId],
    );
    await pings.query(
      `UPDATE courier_availabilities
       SET "recordedAt" = now() - interval '10 minutes'
       WHERE "courierId" = $1`,
      [nearId],
    );
    await pings.end();
    expect(Number(pingCount.rows[0]?.count)).toBeGreaterThan(0);

    const stale = await request(server())
      .get(`/v1/branches/${branchId}/couriers`)
      .query({ radiusMeters: 2000 })
      .set("Authorization", `Bearer ${owner}`)
      .expect(200);
    expect(ids(stale.body)).toEqual([]);
    expect(ids(stale.body)).not.toContain(farId);

    await request(server())
      .get(`/v1/branches/${branchId}/couriers`)
      .query({ radiusMeters: 2000 })
      .set("Authorization", `Bearer ${stranger}`)
      .expect(404);

    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/geo/candidate-query.ts"),
      "utf8",
    );
    expect(source.includes("location_pings")).toBe(false);
    expect(source.includes("ST_DWithin")).toBe(true);
  });
});
