import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

async function courier(email: string, documentNumber: string, admin: string): Promise<string> {
  const token = await register(email);
  const published = await request(server())
    .post("/v1/legal-documents")
    .set("Authorization", `Bearer ${admin}`)
    .send({
      kind: "DOCUMENT_PROCESSING",
      version: documentNumber,
      content: `Texto sintetico ${documentNumber}`,
    })
    .expect(201);
  await request(server())
    .post("/v1/consents")
    .set("Authorization", `Bearer ${token}`)
    .send({
      legalDocumentId: record(published.body)["id"],
      purpose: "DOCUMENT_STORAGE",
      channel: "MOBILE",
    })
    .expect(201);
  await request(server())
    .post("/v1/couriers")
    .set("Authorization", `Bearer ${token}`)
    .send({ documentType: "CC", documentNumber, firstName: "Persona", lastName: "Sintetica" })
    .expect(201);
  return token;
}

async function upload(token: string, types: string[]): Promise<void> {
  for (const type of types) {
    await request(server())
      .post("/v1/couriers/me/documents")
      .set("Authorization", `Bearer ${token}`)
      .field("type", type)
      .attach("file", pdf, { filename: "sintetico.pdf", contentType: "application/pdf" })
      .expect(201);
  }
}

async function vehicle(token: string, plate: string, soatExpiresOn: string): Promise<void> {
  await request(server())
    .post("/v1/couriers/me/vehicle")
    .set("Authorization", `Bearer ${token}`)
    .send({ plate, soatExpiresOn, techExpiresOn: "2027-06-01" })
    .expect(201);
}

async function stored(
  caseId: string,
): Promise<{ caseStatus: string; courierStatus: string; failed: string[] }> {
  const pool = new Pool({ connectionString: databaseUrl });
  const row = await pool.query<{ caseStatus: string; courierStatus: string }>(
    `SELECT v.status::text AS "caseStatus", c.status::text AS "courierStatus"
     FROM verification_cases v
     JOIN couriers c ON c.id = v."courierId"
     WHERE v.id = $1`,
    [caseId],
  );
  const failed = await pool.query<{ code: string }>(
    `SELECT code FROM verification_checks WHERE "caseId" = $1 AND outcome = 'FAIL' ORDER BY code`,
    [caseId],
  );
  const approved = await pool.query(
    `SELECT 1 FROM verification_cases WHERE status = 'APPROVED'
     UNION ALL SELECT 1 FROM couriers WHERE status = 'APPROVED'`,
  );
  await pool.end();
  expect(approved.rowCount).toBe(0);
  const found = row.rows[0];
  if (found === undefined) {
    throw new Error("No quedó el caso");
  }
  return { ...found, failed: failed.rows.map((item) => item.code) };
}

describe("reglas automáticas de verificación", () => {
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
    await pool.query(
      `DELETE FROM vehicles a USING vehicles b WHERE a.plate = b.plate AND a.id::text > b.id::text`,
    );
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS vehicles_plate_key ON vehicles (plate)`);
    await pool.end();
  });

  it("pasa a revisión humana o a cambios, y nunca aprueba", async () => {
    const admin = await register("revisor-reglas@example.invalid");
    const pool = new Pool({ connectionString: databaseUrl });
    const adminUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'revisor-reglas@example.invalid'`,
    );
    await pool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Revisor', 'REVIEWER', now(), now())`,
      [adminUser.rows[0]?.id],
    );
    await pool.end();

    const missing = await courier("falta-doc@example.invalid", "9000000118", admin);
    await upload(
      missing,
      documentTypes.filter((type) => type !== "PROFILE_PHOTO"),
    );
    await vehicle(missing, "ABC18A", "2027-01-15");
    const missingCase = await request(server())
      .post("/v1/couriers/me/verification-cases")
      .set("Authorization", `Bearer ${missing}`)
      .expect(201);
    expect(record(missingCase.body)["status"]).toBe("NEEDS_CHANGES");
    const missingStored = await stored(String(record(missingCase.body)["id"]));
    expect(missingStored.caseStatus).toBe("NEEDS_CHANGES");
    expect(missingStored.courierStatus).toBe("NEEDS_CHANGES");
    expect(missingStored.failed).toContain("REQUIRED_DOCUMENTS");

    const expired = await courier("soat-vence@example.invalid", "9000000119", admin);
    await upload(expired, documentTypes);
    await vehicle(expired, "ABC18B", "2020-01-01");
    const expiredCase = await request(server())
      .post("/v1/couriers/me/verification-cases")
      .set("Authorization", `Bearer ${expired}`)
      .expect(201);
    const expiredStored = await stored(String(record(expiredCase.body)["id"]));
    expect(expiredStored.caseStatus).toBe("NEEDS_CHANGES");
    expect(expiredStored.failed).toContain("SOAT_VALID");

    const ready = await courier("expediente@example.invalid", "9000000120", admin);
    await upload(ready, documentTypes);
    await vehicle(ready, "ABC18C", "2027-01-15");
    const readyCase = await request(server())
      .post("/v1/couriers/me/verification-cases")
      .set("Authorization", `Bearer ${ready}`)
      .expect(201);
    expect(record(readyCase.body)["status"]).toBe("PENDING_HUMAN");
    const readyStored = await stored(String(record(readyCase.body)["id"]));
    expect(readyStored.caseStatus).toBe("PENDING_HUMAN");
    expect(readyStored.courierStatus).toBe("PENDING_VERIFICATION");
    expect(readyStored.failed).toEqual([]);

    const holder = await courier("placa-uno@example.invalid", "9000000121", admin);
    await vehicle(holder, "ABC18D", "2027-01-15");
    const repeated = await courier("placa-dos@example.invalid", "9000000122", admin);
    await upload(repeated, documentTypes);
    const index = new Pool({ connectionString: databaseUrl });
    try {
      await index.query(`DROP INDEX IF EXISTS vehicles_plate_key`);
      const courierId = await index.query<{ id: string }>(
        `SELECT c.id FROM couriers c JOIN users u ON u.id = c."userId" WHERE u.email = 'placa-dos@example.invalid'`,
      );
      await index.query(
        `INSERT INTO vehicles (
           id, "courierId", type, plate, "soatExpiresOn", "techExpiresOn", status, "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), $1, 'MOTORCYCLE', 'ABC18D', '2027-01-15', '2027-06-01', 'ACTIVE', now(), now()
         )`,
        [courierId.rows[0]?.id],
      );
    } finally {
      await index.end();
    }
    const repeatedCase = await request(server())
      .post("/v1/couriers/me/verification-cases")
      .set("Authorization", `Bearer ${repeated}`)
      .expect(201);
    const repeatedStored = await stored(String(record(repeatedCase.body)["id"]));
    expect(repeatedStored.failed).toContain("PLATE_UNIQUE");
    expect(repeatedStored.caseStatus).toBe("NEEDS_CHANGES");

    const restore = new Pool({ connectionString: databaseUrl });
    await restore.query(`DELETE FROM vehicles WHERE plate = 'ABC18D'`);
    await restore.query(`CREATE UNIQUE INDEX IF NOT EXISTS vehicles_plate_key ON vehicles (plate)`);
    await restore.end();

    const sourceDir = join(dirname(fileURLToPath(import.meta.url)), "../src/verification");
    const source = readdirSync(sourceDir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(join(sourceDir, name), "utf8"))
      .join("\n");
    for (const client of ["node:http", "node:https", "undici", "axios"]) {
      expect(source.includes(client)).toBe(false);
    }
    expect(source.includes("fetch(")).toBe(false);
  });
});
