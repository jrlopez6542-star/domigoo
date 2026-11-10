import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const storageDir = mkdtempSync(join(tmpdir(), "domigoo-docs-"));
const pdf = Buffer.from("%PDF-1.4\n% archivo sintetico de prueba\n%%EOF\n");
const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

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
    .send({
      documentType: "CC",
      documentNumber,
      firstName: "Persona",
      lastName: "Sintetica",
    })
    .expect(201);
  return token;
}

describe("motocicleta y documentos", () => {
  beforeAll(() => {
    migrateDatabase(databaseUrl);
  });

  beforeEach(async () => {
    resetLoginThrottle();
    await resetDatabase(databaseUrl);
    currentApp = await createApp(
      readEnv({
        DATABASE_URL: databaseUrl,
        APP_NAME: "DOMIGOO",
        STORAGE_DIR: storageDir,
      }),
    );
  });

  afterEach(async () => {
    await currentApp?.close();
    currentApp = undefined;
  });

  afterAll(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("normaliza la placa y rechaza otra motocicleta activa con la misma", async () => {
    const admin = await register("revisor-moto@example.invalid");
    const pool = new Pool({ connectionString: databaseUrl });
    const adminUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'revisor-moto@example.invalid'`,
    );
    await pool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Revisor', 'REVIEWER', now(), now())`,
      [adminUser.rows[0]?.id],
    );
    const labels = await pool.query<{ enumlabel: string }>(
      `SELECT e.enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'VehicleType'
       ORDER BY e.enumsortorder`,
    );
    await pool.end();
    expect(labels.rows.map((row) => row.enumlabel)).toEqual(["MOTORCYCLE"]);

    const first = await courier("moto-uno@example.invalid", "9000000017", admin);
    const second = await courier("moto-dos@example.invalid", "9000000018", admin);
    const created = await request(server())
      .post("/v1/couriers/me/vehicle")
      .set("Authorization", `Bearer ${first}`)
      .send({ plate: "abc-12d", soatExpiresOn: "2027-01-15", techExpiresOn: "2027-06-01" })
      .expect(201);
    expect(record(created.body)["plate"]).toBe("ABC12D");
    expect(record(created.body)["type"]).toBe("MOTORCYCLE");
    expect(JSON.stringify(created.body)).not.toMatch(/https?:\/\//);
    await request(server())
      .post("/v1/couriers/me/vehicle")
      .set("Authorization", `Bearer ${second}`)
      .send({ plate: "ABC12D", soatExpiresOn: "2027-02-01", techExpiresOn: "2027-07-01" })
      .expect(409);
  });

  it("guarda un PDF y un JPEG sintéticos y rechaza un ejecutable o un archivo de más de 10 MB", async () => {
    const admin = await register("revisor-archivo@example.invalid");
    const pool = new Pool({ connectionString: databaseUrl });
    const adminUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'revisor-archivo@example.invalid'`,
    );
    await pool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Revisor', 'REVIEWER', now(), now())`,
      [adminUser.rows[0]?.id],
    );
    await pool.end();
    const token = await courier("archivo@example.invalid", "9000000019", admin);

    const uploaded = await request(server())
      .post("/v1/couriers/me/documents")
      .set("Authorization", `Bearer ${token}`)
      .field("type", "NATIONAL_ID")
      .attach("file", pdf, { filename: "sintetico.pdf", contentType: "application/pdf" })
      .expect(201);
    const body = record(uploaded.body);
    const sha256 = createHash("sha256").update(pdf).digest("hex");
    expect(body["sha256"]).toBe(sha256);
    expect(body["status"]).toBe("UPLOADED");
    expect(body["url"]).toBeUndefined();
    expect(body["storageKey"]).toBeUndefined();
    expect(JSON.stringify(uploaded.body)).not.toMatch(/https?:\/\//);

    const downloaded = await request(server())
      .get(`/v1/couriers/me/documents/${String(body["id"])}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    if (!Buffer.isBuffer(downloaded.body)) {
      throw new Error("La descarga no devolvió bytes");
    }
    expect(createHash("sha256").update(downloaded.body).digest("hex")).toBe(sha256);

    const photo = await request(server())
      .post("/v1/couriers/me/documents")
      .set("Authorization", `Bearer ${token}`)
      .field("type", "VEHICLE_PHOTO")
      .attach("file", jpeg, { filename: "sintetico.jpg", contentType: "image/jpeg" })
      .expect(201);
    expect(record(photo.body)["sha256"]).toBe(createHash("sha256").update(jpeg).digest("hex"));
    expect(record(photo.body)["mimeType"]).toBe("image/jpeg");

    const executable = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]);
    await request(server())
      .post("/v1/couriers/me/documents")
      .set("Authorization", `Bearer ${token}`)
      .field("type", "DRIVER_LICENSE")
      .attach("file", executable, { filename: "sintetico.pdf", contentType: "application/pdf" })
      .expect(422);

    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
    oversized.write("%PDF-1.4\n");
    await request(server())
      .post("/v1/couriers/me/documents")
      .set("Authorization", `Bearer ${token}`)
      .field("type", "SOAT")
      .attach("file", oversized, { filename: "grande.pdf", contentType: "application/pdf" })
      .expect(413);

    const stored = new Pool({ connectionString: databaseUrl });
    const row = await stored.query<{ storageKey: string }>(
      `SELECT "storageKey" FROM courier_documents WHERE id = $1`,
      [body["id"]],
    );
    await stored.end();
    const key = row.rows[0]?.storageKey;
    if (key === undefined) {
      throw new Error("No quedó la clave privada");
    }
    expect(key.startsWith("http")).toBe(false);
    expect(storageDir.startsWith(tmpdir())).toBe(true);
    expect(storageDir.includes("/workspace/")).toBe(false);
    expect(
      createHash("sha256")
        .update(readFileSync(join(storageDir, key)))
        .digest("hex"),
    ).toBe(sha256);
    await request(server()).get(`/${key}`).expect(404);
  });
});
