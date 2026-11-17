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
  const response = await request(server())
    .post("/v1/auth/register")
    .send({
      email,
      password,
      client: "MOBILE",
      consents: { termsAccepted: true, privacyAccepted: true },
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

  it("aisla cliente, restaurante, domiciliario y admin y revoca token al cerrar sesión o expirar", async () => {
    const clientToken = await tokenFor("cliente-cruzado@example.invalid");
    const restaurantToken = await tokenFor("restaurante-cruzado@example.invalid");
    const courierToken = await tokenFor("domiciliario-cruzado@example.invalid");

    const restUsers = await query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'restaurante-cruzado@example.invalid'`,
    );
    const courierUsers = await query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'domiciliario-cruzado@example.invalid'`,
    );
    const restUserId = restUsers[0]?.id;
    const courierUserId = courierUsers[0]?.id;
    if (restUserId === undefined || courierUserId === undefined) {
      throw new Error("Faltan usuarios de prueba");
    }

    await query(
      `INSERT INTO restaurants (id, "legalName", "tradeName", nit, email, "phoneE164", "createdAt", "updatedAt")
       VALUES ($1, 'Rest Cruzado SAS', 'Rest Cruzado', '900000099', 'rest-cruzado@example.invalid', '+573001119999', now(), now())`,
      [restaurantId],
    );
    await query(
      `INSERT INTO restaurant_memberships (id, "restaurantId", "userId", role, status, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'OWNER', 'ACTIVE', now(), now())`,
      [restaurantId, restUserId],
    );
    await query(
      `INSERT INTO couriers (id, "userId", "documentType", "documentNumber", "firstName", "lastName", status, "registrationSource", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'CC', '99998888', 'Repartidor', 'Cruzado', 'APPROVED', 'OPEN', now(), now())`,
      [courierUserId],
    );

    // 1. Cliente no puede acceder a endpoints de admin, restaurante ni domiciliario
    await request(server())
      .get("/v1/admin/stats")
      .set("Authorization", `Bearer ${clientToken}`)
      .expect(403);
    await request(server())
      .get("/v1/admin/verification-cases")
      .set("Authorization", `Bearer ${clientToken}`)
      .expect(403);
    await request(server())
      .get("/v1/couriers/me")
      .set("Authorization", `Bearer ${clientToken}`)
      .expect(404);
    await request(server())
      .get("/v1/offers/available")
      .set("Authorization", `Bearer ${clientToken}`)
      .expect(403);
    await request(server())
      .get("/v1/branches/mine")
      .set("Authorization", `Bearer ${clientToken}`)
      .expect(403);
    await request(server())
      .get("/v1/orders/mine")
      .set("Authorization", `Bearer ${clientToken}`)
      .expect(403);
    await request(server())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({
        branchId: "77777777-7777-4777-8777-777777777777",
        foodAmountCop: 20000,
        deliveryFeeCop: 5000,
        paymentMethod: "CASH",
      })
      .expect(404);

    // 2. Restaurante no puede acceder a endpoints de domiciliario ni admin
    await request(server())
      .get("/v1/offers/available")
      .set("Authorization", `Bearer ${restaurantToken}`)
      .expect(403);
    await request(server())
      .get("/v1/couriers/me")
      .set("Authorization", `Bearer ${restaurantToken}`)
      .expect(404);
    await request(server())
      .post("/v1/offers/88888888-8888-4888-8888-888888888888/accept")
      .set("Authorization", `Bearer ${restaurantToken}`)
      .set("idempotency-key", "rest-cross-accept-1")
      .send({})
      .expect(404);
    await request(server())
      .get("/v1/admin/stats")
      .set("Authorization", `Bearer ${restaurantToken}`)
      .expect(403);
    await request(server())
      .get("/v1/admin/me")
      .set("Authorization", `Bearer ${restaurantToken}`)
      .expect(404);

    // 3. Domiciliario no puede acceder a endpoints de restaurante ni admin
    await request(server())
      .get("/v1/branches/mine")
      .set("Authorization", `Bearer ${courierToken}`)
      .expect(403);
    await request(server())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${courierToken}`)
      .send({
        branchId: "77777777-7777-4777-8777-777777777777",
        foodAmountCop: 20000,
        deliveryFeeCop: 5000,
        paymentMethod: "CASH",
      })
      .expect(404);
    await request(server())
      .get(`/v1/restaurants/${restaurantId}`)
      .set("Authorization", `Bearer ${courierToken}`)
      .expect(404);
    await request(server())
      .get("/v1/admin/stats")
      .set("Authorization", `Bearer ${courierToken}`)
      .expect(403);
    await request(server())
      .get("/v1/admin/me")
      .set("Authorization", `Bearer ${courierToken}`)
      .expect(404);

    // 4. Logout revoca el token inmediatamente
    await request(server())
      .post("/v1/auth/logout")
      .set("Authorization", `Bearer ${clientToken}`)
      .expect(204);
    await request(server())
      .get("/v1/auth/me")
      .set("Authorization", `Bearer ${clientToken}`)
      .expect(401);
    await request(server())
      .get("/v1/branches/mine")
      .set("Authorization", `Bearer ${clientToken}`)
      .expect(401);
    await request(server())
      .get("/v1/offers/available")
      .set("Authorization", `Bearer ${clientToken}`)
      .expect(401);

    // 5. Expiración de token en base de datos invalida la sesión
    await query(
      `UPDATE sessions SET "expiresAt" = now() - interval '1 minute'
       WHERE "userId" = (SELECT id FROM users WHERE email = 'restaurante-cruzado@example.invalid')`,
    );
    await request(server())
      .get("/v1/auth/me")
      .set("Authorization", `Bearer ${restaurantToken}`)
      .expect(401);
  });
});
