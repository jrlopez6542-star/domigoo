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
const restaurantId = "55555555-5555-4555-8555-555555555555";

type HttpServer = Parameters<typeof request>[0];

function httpServer(app: INestApplication): HttpServer {
  return app.getHttpServer() as HttpServer;
}

let currentApp: INestApplication | undefined;

function server(): HttpServer {
  if (currentApp === undefined) {
    throw new Error("La aplicación no arrancó");
  }
  return httpServer(currentApp);
}

async function createApp(env: AppEnv): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_ENV)
    .useValue(env)
    .compile();
  const app = moduleRef.createNestApplication();
  applyHttpSecurity(app);
  setupOpenApi(app, env.appName);
  await app.init();
  return app;
}

async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query<T>(sql, params);
    return result.rows;
  } finally {
    await pool.end();
  }
}

async function tokenFor(email: string): Promise<string> {
  const response = await request(server()).post("/v1/auth/register").send({
    email,
    password,
    client: "MOBILE",
  });
  if (response.status !== 201) {
    throw new Error(`No se pudo registrar ${email}`);
  }
  const body = response.body as { token?: string };
  if (body.token === undefined) {
    throw new Error("El registro no devolvió token");
  }
  return body.token;
}

describe("autorización", () => {
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

  it("deja leer al miembro y responde 404 al ajeno y al id inexistente", async () => {
    const member = await tokenFor("dueno@example.invalid");
    const stranger = await tokenFor("ajeno@example.invalid");
    const users = await query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'dueno@example.invalid'`,
    );
    const ownerId = users[0]?.id;
    if (ownerId === undefined) {
      throw new Error("No apareció el usuario");
    }
    await query(
      `INSERT INTO restaurants (id, "legalName", "tradeName", nit, email, "phoneE164", "createdAt", "updatedAt")
       VALUES ($1, 'Local', 'Local de prueba', '900000010', 'local@example.invalid', '+573001110000', now(), now())`,
      [restaurantId],
    );
    await query(
      `INSERT INTO restaurant_memberships (id, "restaurantId", "userId", role, status, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'OWNER', 'ACTIVE', now(), now())`,
      [restaurantId, ownerId],
    );

    const allowed = await request(server())
      .get(`/v1/restaurants/${restaurantId}`)
      .set("Authorization", `Bearer ${member}`)
      .expect(200);
    expect(allowed.body).toEqual({ id: restaurantId, tradeName: "Local de prueba" });

    const forbidden = await request(server())
      .get(`/v1/restaurants/${restaurantId}`)
      .set("Authorization", `Bearer ${stranger}`)
      .expect(404);
    const missing = await request(server())
      .get("/v1/restaurants/66666666-6666-4666-8666-666666666666")
      .set("Authorization", `Bearer ${member}`)
      .expect(404);
    expect(forbidden.status).toBe(missing.status);
  });

  it("exige perfil admin y responde 404 si la sesión no lo tiene", async () => {
    const adminToken = await tokenFor("revisor@example.invalid");
    const plainToken = await tokenFor("persona@example.invalid");
    const admins = await query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'revisor@example.invalid'`,
    );
    const adminId = admins[0]?.id;
    if (adminId === undefined) {
      throw new Error("No apareció el admin");
    }
    await query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Revisor de prueba', 'REVIEWER', now(), now())`,
      [adminId],
    );

    await request(server())
      .get("/v1/admin/me")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)
      .expect({ role: "REVIEWER" });
    await request(server())
      .get("/v1/admin/me")
      .set("Authorization", `Bearer ${plainToken}`)
      .expect(404);
  });
});
