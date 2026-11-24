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

describe("disponibilidad según couriers.status (ORDEN 013)", () => {
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

  it("impide AVAILABLE a domiciliario PENDING_VERIFICATION o SUSPENDED y permite OFFLINE siempre", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const adminReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "admin-013@example.invalid",
          password,
          client: "ADMIN",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const adminCookie = sessionCookie(adminReg.headers);
      await pool.query(
        `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
         SELECT id, 'Admin 013', 'SUPERADMIN', now(), now()
         FROM users WHERE email = 'admin-013@example.invalid'`,
      );

      const docLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "DOCUMENT_PROCESSING", version: "2026-013-doc", content: "Doc 013" })
        .expect(201);
      const gpsLegal = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "GEOLOCATION_CONSENT", version: "2026-013-gps", content: "GPS 013" })
        .expect(201);

      const courierReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "courier-013@example.invalid",
          password,
          client: "MOBILE",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const courierToken = String(record(courierReg.body)["token"]);

      await request(server())
        .post("/v1/consents")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({
          legalDocumentId: record(docLegal.body)["id"],
          purpose: "DOCUMENT_STORAGE",
          channel: "MOBILE",
        })
        .expect(201);
      await request(server())
        .post("/v1/consents")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({
          legalDocumentId: record(gpsLegal.body)["id"],
          purpose: "GEOLOCATION",
          channel: "MOBILE",
        })
        .expect(201);

      const created = await request(server())
        .post("/v1/couriers")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({
          documentType: "CC",
          documentNumber: "9000130001",
          firstName: "Andres",
          lastName: "Prueba",
        })
        .expect(201);
      const courierId = String(record(created.body)["id"]);

      for (const type of documentTypes) {
        await request(server())
          .post("/v1/couriers/me/documents")
          .set("Authorization", `Bearer ${courierToken}`)
          .field("type", type)
          .attach("file", pdf, { filename: "sintetico.pdf", contentType: "application/pdf" })
          .expect(201);
      }
      await request(server())
        .post("/v1/couriers/me/vehicle")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ plate: "D013A1", soatExpiresOn: "2028-04-01", techExpiresOn: "2028-08-01" })
        .expect(201);

      const vCase = await request(server())
        .post("/v1/couriers/me/verification-cases")
        .set("Authorization", `Bearer ${courierToken}`)
        .expect(201);
      const caseId = String(record(vCase.body)["id"]);

      // En PENDING_VERIFICATION (aun con consentimiento GPS): AVAILABLE -> 422, OFFLINE -> 201
      await request(server())
        .post("/v1/couriers/me/availability")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ state: "AVAILABLE" })
        .expect(422);

      const pendingRow = await pool.query<{ state: string }>(
        `SELECT state::text AS state FROM courier_availabilities WHERE "courierId" = $1`,
        [courierId],
      );
      expect(pendingRow.rows).toEqual([]);

      const pendingOffline = await request(server())
        .post("/v1/couriers/me/availability")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ state: "OFFLINE" })
        .expect(201);
      expect(pendingOffline.body).toEqual({ state: "OFFLINE" });

      // Aprobado por admin -> puede pasar a AVAILABLE
      await request(server())
        .post(`/v1/admin/verification-cases/${caseId}/decision`)
        .set("Cookie", adminCookie)
        .send({ outcome: "APPROVED", reasonCode: "DOCS_VERIFIED", comment: "Aprobado 013" })
        .expect(201);

      const approvedOnline = await request(server())
        .post("/v1/couriers/me/availability")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ state: "AVAILABLE" })
        .expect(201);
      expect(approvedOnline.body).toEqual({ state: "AVAILABLE" });

      // Suspendido por admin -> queda OFFLINE, no puede volver a AVAILABLE, sí puede enviar OFFLINE
      const suspended = await request(server())
        .post(`/v1/admin/couriers/${courierId}/suspend`)
        .set("Cookie", adminCookie)
        .send({ reason: "Suspensión operativa de prueba" })
        .expect(201);
      expect(record(suspended.body)["status"]).toBe("SUSPENDED");

      await request(server())
        .post("/v1/couriers/me/availability")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ state: "AVAILABLE" })
        .expect(422);

      const suspStateRow = await pool.query<{ state: string }>(
        `SELECT state::text AS state FROM courier_availabilities WHERE "courierId" = $1`,
        [courierId],
      );
      expect(suspStateRow.rows[0]?.state).toBe("OFFLINE");

      const suspOffline = await request(server())
        .post("/v1/couriers/me/availability")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ state: "OFFLINE" })
        .expect(201);
      expect(suspOffline.body).toEqual({ state: "OFFLINE" });

      // Rehabilitado -> vuelve a poder pasar a AVAILABLE
      const reinstated = await request(server())
        .post(`/v1/admin/couriers/${courierId}/reinstate`)
        .set("Cookie", adminCookie)
        .send({ reason: "Rehabilitación de prueba" })
        .expect(201);
      expect(record(reinstated.body)["status"]).toBe("APPROVED");

      const reinstatedOnline = await request(server())
        .post("/v1/couriers/me/availability")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ state: "AVAILABLE" })
        .expect(201);
      expect(reinstatedOnline.body).toEqual({ state: "AVAILABLE" });
    } finally {
      await pool.end();
    }
  });
});
