import { createHash } from "node:crypto";
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
    .send({
      email,
      password,
      client: "MOBILE",
      consents: { termsAccepted: true, privacyAccepted: true },
    })
    .expect(201);
  return String(record(created.body)["token"]);
}

async function grantDocuments(token: string, legalDocumentId: string): Promise<void> {
  await request(server())
    .post("/v1/consents")
    .set("Authorization", `Bearer ${token}`)
    .send({ legalDocumentId, purpose: "DOCUMENT_STORAGE", channel: "MOBILE" })
    .expect(201);
}

describe("invitación de domiciliario", () => {
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
  });

  it("guarda el token hasheado, no reutiliza la invitación y no aprueba", async () => {
    const admin = await register("ops-invitacion@example.invalid");
    const guest = await register("invitado@example.invalid");
    const stranger = await register("ajeno-invitacion@example.invalid");
    const pool = new Pool({ connectionString: databaseUrl });
    const adminUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'ops-invitacion@example.invalid'`,
    );
    await pool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Ops', 'OPERATIONS', now(), now())`,
      [adminUser.rows[0]?.id],
    );
    await pool.end();

    await request(server())
      .post("/v1/courier-invitations")
      .set("Authorization", `Bearer ${stranger}`)
      .send({})
      .expect(404);

    const published = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        kind: "DOCUMENT_PROCESSING",
        version: "2026-01",
        content: "Texto sintetico de tratamiento de documentos de prueba",
      })
      .expect(201);
    const created = await request(server())
      .post("/v1/courier-invitations")
      .set("Authorization", `Bearer ${admin}`)
      .send({})
      .expect(201);
    const token = String(record(created.body)["token"]);
    const hash = createHash("sha256").update(token).digest("hex");
    const check = new Pool({ connectionString: databaseUrl });
    const stored = await check.query<{ tokenHash: string }>(
      `SELECT "tokenHash" FROM courier_invitations WHERE id = $1`,
      [record(created.body)["id"]],
    );
    await check.end();
    expect(stored.rows[0]?.tokenHash).toBe(hash);
    expect(stored.rows[0]?.tokenHash).not.toBe(token);

    const profile = {
      documentType: "CC",
      documentNumber: "9000000016",
      firstName: "Invitado",
      lastName: "Sintetico",
    };
    await request(server())
      .post(`/v1/courier-invitations/${token}/accept`)
      .set("Authorization", `Bearer ${guest}`)
      .send(profile)
      .expect(422);
    await grantDocuments(guest, String(record(published.body)["id"]));
    await grantDocuments(stranger, String(record(published.body)["id"]));

    const accepted = await request(server())
      .post(`/v1/courier-invitations/${token}/accept`)
      .set("Authorization", `Bearer ${guest}`)
      .send(profile)
      .expect(201);
    expect(record(accepted.body)["status"]).toBe("REGISTERING");
    expect(record(accepted.body)["registrationSource"]).toBe("INVITATION");
    expect(record(accepted.body)["token"]).toBeUndefined();

    await request(server())
      .post(`/v1/courier-invitations/${token}/accept`)
      .set("Authorization", `Bearer ${stranger}`)
      .send({ ...profile, documentNumber: "9000000017" })
      .expect(404);

    const after = new Pool({ connectionString: databaseUrl });
    const courier = await after.query<{ status: string; source: string; invitation: string }>(
      `SELECT c.status::text AS status, c."registrationSource"::text AS source, i.status::text AS invitation
       FROM couriers c JOIN courier_invitations i ON i.id = c."invitationId"
       WHERE c.id = $1`,
      [record(accepted.body)["id"]],
    );
    await after.end();
    expect(courier.rows[0]?.status).toBe("REGISTERING");
    expect(courier.rows[0]?.source).toBe("INVITATION");
    expect(courier.rows[0]?.invitation).toBe("CONSUMED");
  });

  it("rechaza una invitación vencida", async () => {
    const admin = await register("ops-vence@example.invalid");
    const guest = await register("vence@example.invalid");
    const pool = new Pool({ connectionString: databaseUrl });
    const adminUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'ops-vence@example.invalid'`,
    );
    await pool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Ops', 'OPERATIONS', now(), now())`,
      [adminUser.rows[0]?.id],
    );
    await pool.end();
    const published = await request(server())
      .post("/v1/legal-documents")
      .set("Authorization", `Bearer ${admin}`)
      .send({ kind: "DOCUMENT_PROCESSING", version: "2026-02", content: "Texto sintetico" })
      .expect(201);
    await grantDocuments(guest, String(record(published.body)["id"]));
    const created = await request(server())
      .post("/v1/courier-invitations")
      .set("Authorization", `Bearer ${admin}`)
      .send({})
      .expect(201);
    const expire = new Pool({ connectionString: databaseUrl });
    await expire.query(
      `UPDATE courier_invitations SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`,
      [record(created.body)["id"]],
    );
    await expire.end();
    await request(server())
      .post(`/v1/courier-invitations/${String(record(created.body)["token"])}/accept`)
      .set("Authorization", `Bearer ${guest}`)
      .send({
        documentType: "CC",
        documentNumber: "9000000018",
        firstName: "Vencio",
        lastName: "Sintetico",
      })
      .expect(404);
    const status = new Pool({ connectionString: databaseUrl });
    const row = await status.query<{ status: string }>(
      `SELECT status::text AS status FROM courier_invitations WHERE id = $1`,
      [record(created.body)["id"]],
    );
    await status.end();
    expect(row.rows[0]?.status).toBe("EXPIRED");
  });
});
