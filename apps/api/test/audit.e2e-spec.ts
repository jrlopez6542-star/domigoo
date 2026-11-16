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
const restaurantId = "77777777-7777-4777-8777-777777777777";

type HttpServer = Parameters<typeof request>[0];
let currentApp: INestApplication | undefined;

function server(): HttpServer {
  if (currentApp === undefined) {
    throw new Error("La aplicación no arrancó");
  }
  return currentApp.getHttpServer() as HttpServer;
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

async function rows<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    return (await pool.query<T>(sql, params)).rows;
  } finally {
    await pool.end();
  }
}

describe("auditoría de identidad", () => {
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

  it("no guarda la contraseña cuando el ingreso falla y el update de auditoría revienta", async () => {
    await request(server()).post("/v1/auth/register").send({
      email: "auditado@example.invalid",
      password,
      client: "WEB",
    });
    await request(server()).post("/v1/auth/login").send({
      email: "auditado@example.invalid",
      password: "clave-incorrecta-12",
      client: "WEB",
    });
    const audits = await rows<{ diff: unknown; reason: string | null }>(
      `SELECT diff, reason, action FROM audit_logs`,
    );
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain("clave-incorrecta-12");
    expect(serialized).not.toContain("passwordHash");
    expect(audits.length).toBe(1);

    await expect(rows(`UPDATE audit_logs SET action = 'cambiado'`)).rejects.toThrow(/append-only/);
  });

  it("audita el cambio de papel sin secretos", async () => {
    const owner = await request(server())
      .post("/v1/auth/register")
      .send({ email: "dueno-audit@example.invalid", password, client: "MOBILE" });
    const operator = await request(server())
      .post("/v1/auth/register")
      .send({ email: "opera@example.invalid", password, client: "MOBILE" });
    const ownerId = (owner.body as { id: string }).id;
    const operatorId = (operator.body as { id: string }).id;
    await rows(
      `INSERT INTO restaurants (id, "legalName", "tradeName", nit, email, "phoneE164", "createdAt", "updatedAt")
       VALUES ($1, 'Local', 'Local', '900000077', 'local-audit@example.invalid', '+573001110077', now(), now())`,
      [restaurantId],
    );
    await rows(
      `INSERT INTO restaurant_memberships (id, "restaurantId", "userId", role, status, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'OWNER', 'ACTIVE', now(), now()),
              (gen_random_uuid(), $1, $3, 'OPERATOR', 'ACTIVE', now(), now())`,
      [restaurantId, ownerId, operatorId],
    );

    await request(server())
      .patch(`/v1/restaurants/${restaurantId}/members/${operatorId}`)
      .set("Authorization", `Bearer ${(owner.body as { token: string }).token}`)
      .send({ role: "MANAGER" })
      .expect(200);

    const audits = await rows<{ diff: { role: { from: string; to: string } } }>(
      `SELECT diff FROM audit_logs WHERE action = 'membership.role_changed'`,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.diff).toEqual({ role: { from: "OPERATOR", to: "MANAGER" } });
    expect(JSON.stringify(audits)).not.toContain(password);
  });
});
