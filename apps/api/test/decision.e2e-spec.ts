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

describe("decisión humana", () => {
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
  });

  it("la escribe un revisor, audita su identidad y rechaza a un operador sin motivo", async () => {
    const reviewer = await register("revisor-decision@example.invalid");
    const operator = await register("operador-decision@example.invalid");
    const courier = await register("domi-decision@example.invalid");
    const pool = new Pool({ connectionString: databaseUrl });
    const users = await pool.query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE email = ANY($1::text[])`,
      [
        [
          "revisor-decision@example.invalid",
          "operador-decision@example.invalid",
          "domi-decision@example.invalid",
        ],
      ],
    );
    const reviewerId = users.rows.find((row) => row.email.startsWith("revisor"))?.id;
    const operatorId = users.rows.find((row) => row.email.startsWith("operador"))?.id;
    if (reviewerId === undefined || operatorId === undefined) {
      throw new Error("No aparecieron las cuentas de prueba");
    }
    await pool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Revisor', 'REVIEWER', now(), now())`,
      [reviewerId],
    );
    const restaurant = await pool.query<{ id: string }>(
      `INSERT INTO restaurants (
         id, "legalName", "tradeName", nit, email, "phoneE164", status, "createdAt", "updatedAt"
       ) VALUES (
         gen_random_uuid(), 'Razon decision', 'Local decision', '900000199',
         'local-decision@example.invalid', '+573001110199', 'DRAFT', now(), now()
       ) RETURNING id`,
    );
    await pool.query(
      `INSERT INTO restaurant_memberships (
         id, "restaurantId", "userId", role, status, "createdAt", "updatedAt"
       ) VALUES (
         gen_random_uuid(), $1, $2, 'OPERATOR', 'ACTIVE', now(), now()
       )`,
      [restaurant.rows[0]?.id, operatorId],
    );
    await pool.end();

    const published = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${reviewer}`)
      .send({
        kind: "DOCUMENT_PROCESSING",
        version: "2026-decision",
        content: "Texto sintetico de tratamiento de documentos de prueba",
      })
      .expect(201);
    await request(server())
      .post("/v1/consents")
      .set("Authorization", `Bearer ${courier}`)
      .send({
        legalDocumentId: record(published.body)["id"],
        purpose: "DOCUMENT_STORAGE",
        channel: "MOBILE",
      })
      .expect(201);
    await request(server())
      .post("/v1/couriers")
      .set("Authorization", `Bearer ${courier}`)
      .send({
        documentType: "CC",
        documentNumber: "9000000199",
        firstName: "Persona",
        lastName: "Sintetica",
      })
      .expect(201);
    for (const type of documentTypes) {
      await request(server())
        .post("/v1/couriers/me/documents")
        .set("Authorization", `Bearer ${courier}`)
        .field("type", type)
        .attach("file", pdf, { filename: "sintetico.pdf", contentType: "application/pdf" })
        .expect(201);
    }
    await request(server())
      .post("/v1/couriers/me/vehicle")
      .set("Authorization", `Bearer ${courier}`)
      .send({ plate: "ABC19A", soatExpiresOn: "2027-04-01", techExpiresOn: "2027-08-01" })
      .expect(201);
    const opened = await request(server())
      .post("/v1/couriers/me/verification-cases")
      .set("Authorization", `Bearer ${courier}`)
      .expect(201);
    const caseId = String(record(opened.body)["id"]);
    expect(record(opened.body)["status"]).toBe("PENDING_HUMAN");

    const queue = await request(server())
      .get("/v1/admin/verification-cases")
      .set("Authorization", `Bearer ${reviewer}`)
      .expect(200);
    const listed = queue.body as unknown[];
    expect(listed.some((item) => record(item)["id"] === caseId)).toBe(true);

    await request(server())
      .post(`/v1/admin/verification-cases/${caseId}/decision`)
      .set("Authorization", `Bearer ${operator}`)
      .send({ outcome: "APPROVED", reasonCode: "EXPEDIENTE_OK", comment: "No debe poder" })
      .expect(403);
    await request(server())
      .post(`/v1/admin/verification-cases/${caseId}/decision`)
      .set("Authorization", `Bearer ${reviewer}`)
      .send({ outcome: "APPROVED", comment: "Sin motivo" })
      .expect(422);

    await request(server())
      .post(`/v1/admin/verification-cases/${caseId}/decision`)
      .set("Authorization", `Bearer ${reviewer}`)
      .send({
        outcome: "APPROVED",
        reasonCode: "EXPEDIENTE_OK",
        comment: "Revision humana de un expediente sintetico",
      })
      .expect(201);

    const check = new Pool({ connectionString: databaseUrl });
    const decision = await check.query<{ reviewerId: string; actorId: string; courier: string }>(
      `SELECT d."reviewerId", a."actorId", c.status::text AS courier
       FROM verification_decisions d
       JOIN audit_logs a ON a."actorId" = d."reviewerId" AND a."entityId" = d."caseId"
       JOIN verification_cases v ON v.id = d."caseId"
       JOIN couriers c ON c.id = v."courierId"
       WHERE d."caseId" = $1 AND a.action = 'verification.decided' AND v.status = 'APPROVED'`,
      [caseId],
    );
    await check.end();
    expect(decision.rows[0]?.reviewerId).toBe(reviewerId);
    expect(decision.rows[0]?.actorId).toBe(reviewerId);
    expect(decision.rows[0]?.courier).toBe("APPROVED");

    const after = await request(server())
      .get("/v1/admin/verification-cases")
      .set("Authorization", `Bearer ${reviewer}`)
      .expect(200);
    const remaining = after.body as unknown[];
    expect(remaining.some((item) => record(item)["id"] === caseId)).toBe(false);
  });
});
