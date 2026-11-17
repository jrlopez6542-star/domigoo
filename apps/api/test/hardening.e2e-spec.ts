import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, type AppEnv } from "../src/config/env.js";
import { applyHttpSecurity } from "../src/http.js";
import { resetLoginThrottle } from "../src/identity/login-throttle.js";
import { setupOpenApi } from "../src/openapi.js";
import { migrateDatabase } from "./migrate.js";
import { resetDatabase } from "./reset-db.js";
import { testEnv } from "./test-env.js";

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

async function registerUser(email: string): Promise<{ token: string; userId: string }> {
  const res = await request(server())
    .post("/v1/auth/register")
    .send({
      email,
      password,
      client: "MOBILE",
      consents: { termsAccepted: true, privacyAccepted: true },
    })
    .expect(201);
  const body = record(res.body);
  return {
    token: String(body["token"]),
    userId: String(body["id"]),
  };
}

describe("endurecimiento M47 (rate limit, login throttling, storage privado, cron)", () => {
  const originalAuthMax = process.env["RATE_LIMIT_AUTH_MAX"];
  const originalCronSecret = process.env["CRON_SECRET"];
  const originalStorageDriver = process.env["STORAGE_DRIVER"];

  beforeAll(() => {
    migrateDatabase(databaseUrl);
  });

  beforeEach(async () => {
    resetLoginThrottle();
    delete process.env["STORAGE_DRIVER"];
    process.env["RATE_LIMIT_AUTH_MAX"] = "60";
    process.env["CRON_SECRET"] = "test-cron-secret-m47";
    await resetDatabase(databaseUrl);
    currentApp = await createApp(testEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO" }));
  });

  afterEach(async () => {
    await currentApp?.close();
    currentApp = undefined;
    if (originalAuthMax === undefined) {
      delete process.env["RATE_LIMIT_AUTH_MAX"];
    } else {
      process.env["RATE_LIMIT_AUTH_MAX"] = originalAuthMax;
    }
    if (originalCronSecret === undefined) {
      delete process.env["CRON_SECRET"];
    } else {
      process.env["CRON_SECRET"] = originalCronSecret;
    }
    if (originalStorageDriver === undefined) {
      delete process.env["STORAGE_DRIVER"];
    } else {
      process.env["STORAGE_DRIVER"] = originalStorageDriver;
    }
  });

  it("aplica rate limiting en /v1/auth/* con 429 y Retry-After", async () => {
    process.env["RATE_LIMIT_AUTH_MAX"] = "4";

    for (let i = 0; i < 4; i += 1) {
      await request(server())
        .get("/v1/auth/me")
        .set("X-Forwarded-For", "198.51.100.10")
        .expect(401);
    }

    const limited = await request(server())
      .get("/v1/auth/me")
      .set("X-Forwarded-For", "198.51.100.10")
      .expect(429);

    expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });

  it("bloquea intentos fallidos de login sin revelar si el correo existe", async () => {
    await registerUser("usuario-bloqueo@example.invalid");

    const unknownRes = await request(server())
      .post("/v1/auth/login")
      .set("X-Forwarded-For", "198.51.100.21")
      .send({
        email: "no-existe@example.invalid",
        password: "clave-incorrecta-1",
        client: "WEB",
      })
      .expect(401);

    const existingFirst = await request(server())
      .post("/v1/auth/login")
      .set("X-Forwarded-For", "198.51.100.22")
      .send({
        email: "usuario-bloqueo@example.invalid",
        password: "clave-incorrecta-1",
        client: "WEB",
      })
      .expect(401);

    expect(record(existingFirst.body)["message"]).toBe(record(unknownRes.body)["message"]);

    for (let i = 0; i < 4; i += 1) {
      await request(server()).post("/v1/auth/login").set("X-Forwarded-For", "198.51.100.22").send({
        email: "usuario-bloqueo@example.invalid",
        password: "clave-incorrecta-1",
        client: "WEB",
      });
    }

    const locked = await request(server())
      .post("/v1/auth/login")
      .set("X-Forwarded-For", "198.51.100.22")
      .send({
        email: "usuario-bloqueo@example.invalid",
        password: "clave-incorrecta-1",
        client: "WEB",
      })
      .expect(429);

    expect(Number(locked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });

  it("almacena documentos en PostgreSQL y deniega acceso a otros usuarios", async () => {
    const admin = await registerUser("revisor-storage@example.invalid");
    const owner = await registerUser("domi-owner@example.invalid");
    const other = await registerUser("domi-other@example.invalid");

    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query(
        `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
         VALUES ($1, 'Revisor', 'REVIEWER', now(), now())`,
        [admin.userId],
      );
    } finally {
      await pool.end();
    }

    const published = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        kind: "DOCUMENT_PROCESSING",
        version: "2026-m47",
        content: "Texto de prueba para almacenamiento privado",
      })
      .expect(201);

    const legalDocumentId = String(record(published.body)["id"]);
    for (const token of [owner.token, other.token]) {
      await request(server())
        .post("/v1/consents")
        .set("Authorization", `Bearer ${token}`)
        .send({ legalDocumentId, purpose: "DOCUMENT_STORAGE", channel: "MOBILE" })
        .expect(201);
    }

    await request(server())
      .post("/v1/couriers")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        documentType: "CC",
        documentNumber: "9000000081",
        firstName: "Propietario",
        lastName: "Prueba",
      })
      .expect(201);

    await request(server())
      .post("/v1/couriers")
      .set("Authorization", `Bearer ${other.token}`)
      .send({
        documentType: "CC",
        documentNumber: "9000000082",
        firstName: "Otro",
        lastName: "Prueba",
      })
      .expect(201);

    const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "ascii");
    const uploaded = await request(server())
      .post("/v1/couriers/me/documents")
      .set("Authorization", `Bearer ${owner.token}`)
      .field("type", "NATIONAL_ID")
      .attach("file", pdfBytes, { filename: "cedula.pdf", contentType: "application/pdf" })
      .expect(201);

    const docId = String(record(uploaded.body)["id"]);

    const ownDownload = await request(server())
      .get(`/v1/couriers/me/documents/${docId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);
    expect(ownDownload.headers["cache-control"]).toBe("private, no-store");
    expect(ownDownload.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(ownDownload.body as Buffer, pdfBytes)).toBe(0);

    await request(server())
      .get(`/v1/couriers/me/documents/${docId}`)
      .set("Authorization", `Bearer ${other.token}`)
      .expect(404);
  });

  it("ejecuta el cron de mantenimiento de forma autenticada e idempotente", async () => {
    await request(server()).get("/v1/internal/cron/maintenance").expect(401);

    const user = await registerUser("cron-user@example.invalid");
    const courierId = randomUUID();

    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query(
        `INSERT INTO courier_invitations (id, "createdById", "tokenHash", status, "expiresAt", "createdAt")
         VALUES ($1, $2, $3, 'PENDING', now() - interval '2 days', now() - interval '3 days')`,
        [randomUUID(), user.userId, randomUUID().replaceAll("-", "") + "0".repeat(32)],
      );
      await pool.query(
        `INSERT INTO sessions (id, "userId", "tokenHash", client, "expiresAt", "createdAt")
         VALUES ($1, $2, $3, 'WEB', now() - interval '1 day', now() - interval '2 days')`,
        [randomUUID(), user.userId, randomUUID().replaceAll("-", "") + "1".repeat(32)],
      );
      await pool.query(
        `INSERT INTO idempotency_keys (id, "userId", key, "requestHash", "responseStatus", "createdAt", "expiresAt")
         VALUES ($1, $2, 'old-key', $3, 200, now() - interval '2 days', now() - interval '1 day')`,
        [randomUUID(), user.userId, "a".repeat(64)],
      );
      await pool.query(
        `INSERT INTO rate_limit_buckets (key, count, "windowStart", "blockedUntil")
         VALUES ('rl:auth:old', 3, now() - interval '48 hours', NULL)`,
      );
      await pool.query(
        `INSERT INTO couriers (id, "userId", "documentType", "documentNumber", "firstName", "lastName", status, "createdAt", "updatedAt")
         VALUES ($1, $2, 'CC', '9000000099', 'Cron', 'Courier', 'REGISTERING', now(), now())`,
        [courierId, user.userId],
      );
      await pool.query(
        `INSERT INTO location_pings (id, "courierId", "orderId", purpose, location, "recordedAt")
         VALUES
           ($1, $2, NULL, 'AVAILABILITY', ST_GeogFromText('SRID=4326;POINT(-73.91 4.96)'), now() - interval '91 days'),
           ($3, $2, NULL, 'AVAILABILITY', ST_GeogFromText('SRID=4326;POINT(-73.91 4.96)'), now() - interval '1 day')`,
        [randomUUID(), courierId, randomUUID()],
      );
    } finally {
      await pool.end();
    }

    const firstRun = await request(server())
      .post("/v1/internal/cron/maintenance")
      .set("Authorization", "Bearer test-cron-secret-m47")
      .expect(200);

    const firstSummary = record(record(firstRun.body)["summary"]);
    expect(firstSummary["expiredCourierInvitations"]).toBe(1);
    expect(firstSummary["purgedSessions"]).toBe(1);
    expect(firstSummary["purgedIdempotencyKeys"]).toBe(1);
    expect(firstSummary["purgedRateLimitBuckets"]).toBe(1);
    expect(firstSummary["purgedLocationPings"]).toBe(1);

    const secondRun = await request(server())
      .post("/v1/internal/cron/maintenance")
      .set("x-cron-secret", "test-cron-secret-m47")
      .expect(200);

    const secondSummary = record(record(secondRun.body)["summary"]);
    expect(secondSummary["expiredCourierInvitations"]).toBe(0);
    expect(secondSummary["purgedSessions"]).toBe(0);
    expect(secondSummary["purgedIdempotencyKeys"]).toBe(0);
    expect(secondSummary["purgedRateLimitBuckets"]).toBe(0);
    expect(secondSummary["purgedLocationPings"]).toBe(0);

    const checkPool = new Pool({ connectionString: databaseUrl });
    try {
      const remaining = await checkPool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM location_pings WHERE "courierId" = $1`,
        [courierId],
      );
      expect(remaining.rows[0]?.count).toBe("1");
    } finally {
      await checkPool.end();
    }
  });
});
