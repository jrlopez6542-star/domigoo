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

async function promoteSuperadmin(pool: Pool, email: string): Promise<void> {
  await pool.query(
    `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
     SELECT id, 'Admin 021', 'SUPERADMIN', now(), now()
     FROM users WHERE email = $1`,
    [email],
  );
}

async function tableCount(pool: Pool, table: string): Promise<number> {
  const res = await pool.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM ${table}`);
  return res.rows[0]?.total ?? 0;
}

describe("ORDEN 021: duplicados -> 409 (nunca 500) y hours en GET /v1/branches/mine", () => {
  const env = testEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO" });

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

  it("POST /v1/restaurants con NIT duplicado responde 409 sin crear filas nuevas", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const owner1 = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "dueno-1-021@example.invalid",
          password,
          client: "WEB",
          role: "RESTAURANT",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const cookie1 = sessionCookie(owner1.headers);

      const owner2 = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "dueno-2-021@example.invalid",
          password,
          client: "WEB",
          role: "RESTAURANT",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const cookie2 = sessionCookie(owner2.headers);

      const payload = {
        legalName: "Asados de Tocancipá SAS",
        tradeName: "Asados 021",
        nit: "901210021-9",
        email: "asados-021@example.invalid",
        phoneE164: "+573001110021",
        establishmentName: "Sede Principal",
        branchName: "Centro",
        addressLine: "Calle 8 # 5-21, Tocancipá",
        longitude: -73.9125,
        latitude: 4.9652,
      };

      await request(server())
        .post("/v1/restaurants")
        .set("Cookie", cookie1)
        .send(payload)
        .expect(201);

      const restaurantsBefore = await tableCount(pool, "restaurants");
      const establishmentsBefore = await tableCount(pool, "establishments");
      const branchesBefore = await tableCount(pool, "branches");

      const dup = await request(server())
        .post("/v1/restaurants")
        .set("Cookie", cookie2)
        .send({
          ...payload,
          legalName: "Otro Comercio SAS",
          tradeName: "Otro 021",
          email: "otro-021@example.invalid",
        })
        .expect(409);
      expect(record(dup.body)).toEqual({ message: "Ya existe un restaurante con ese NIT" });

      expect(await tableCount(pool, "restaurants")).toBe(restaurantsBefore);
      expect(await tableCount(pool, "establishments")).toBe(establishmentsBefore);
      expect(await tableCount(pool, "branches")).toBe(branchesBefore);
    } finally {
      await pool.end();
    }
  });

  it("POST /v1/couriers con documento duplicado responde 409 sin crear segundo domiciliario", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const courier1 = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "domi-1-021@example.invalid",
          password,
          client: "MOBILE",
          role: "COURIER",
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            sensitiveDataAccepted: true,
          },
        })
        .expect(201);
      const token1 = String(record(courier1.body)["token"]);

      const courier2 = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "domi-2-021@example.invalid",
          password,
          client: "MOBILE",
          role: "COURIER",
          consents: {
            termsAccepted: true,
            privacyAccepted: true,
            sensitiveDataAccepted: true,
          },
        })
        .expect(201);
      const token2 = String(record(courier2.body)["token"]);

      await request(server())
        .post("/v1/couriers")
        .set("Authorization", `Bearer ${token1}`)
        .send({
          documentType: "CC",
          documentNumber: "1021002100",
          firstName: "Mateo",
          lastName: "Pérez",
        })
        .expect(201);

      const couriersBefore = await tableCount(pool, "couriers");

      const dup = await request(server())
        .post("/v1/couriers")
        .set("Authorization", `Bearer ${token2}`)
        .send({
          documentType: "CC",
          documentNumber: "1021002100",
          firstName: "Camilo",
          lastName: "Rojas",
        })
        .expect(409);
      expect(record(dup.body)).toEqual({ message: "Ya existe un domiciliario con esos datos" });
      expect(await tableCount(pool, "couriers")).toBe(couriersBefore);
    } finally {
      await pool.end();
    }
  });

  it("POST /v1/legal-documents, POST /v1/admin/tariffs/zones y POST /v1/devices/push-token duplicados responden 409", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const adminReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "admin-dup-021@example.invalid",
          password,
          client: "ADMIN",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const adminCookie = sessionCookie(adminReg.headers);
      await promoteSuperadmin(pool, "admin-dup-021@example.invalid");

      // 1) legal-documents (kind, version) duplicado -> 409
      await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "TERMS", version: "2026-021", content: "Términos 021" })
        .expect(201);
      const dupDoc = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({ kind: "TERMS", version: "2026-021", content: "Términos 021 repetido" })
        .expect(409);
      expect(record(dupDoc.body)).toEqual({
        message: "Ya existe un documento legal con ese tipo y versión",
      });

      // 2) tariff_zones (versionId, code) duplicado -> 409
      const versionRes = await request(server())
        .post("/v1/admin/tariffs/versions")
        .set("Cookie", adminCookie)
        .send({ name: "Tarifa 021" })
        .expect(201);
      const versionId = String(record(versionRes.body)["id"]);
      const zoneBody = {
        versionId,
        code: "ZONA_CENTRO",
        name: "Centro Tocancipá",
        polygonWkt: "POLYGON((-73.92 4.96, -73.90 4.96, -73.90 4.98, -73.92 4.98, -73.92 4.96))",
        priority: 1,
      };
      await request(server())
        .post("/v1/admin/tariffs/zones")
        .set("Cookie", adminCookie)
        .send(zoneBody)
        .expect(201);
      const dupZone = await request(server())
        .post("/v1/admin/tariffs/zones")
        .set("Cookie", adminCookie)
        .send(zoneBody)
        .expect(409);
      expect(record(dupZone.body)).toEqual({
        message: "Ya existe una zona con ese código en esta versión",
      });

      // 3) device_push_tokens token duplicado entre usuarios distintos -> 409
      const user1 = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "push-1-021@example.invalid",
          password,
          client: "MOBILE",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const user2 = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "push-2-021@example.invalid",
          password,
          client: "MOBILE",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const token1 = String(record(user1.body)["token"]);
      const token2 = String(record(user2.body)["token"]);
      const sharedPushToken = "fcm-token-compartido-021-abcdef";

      await request(server())
        .post("/v1/devices/push-token")
        .set("Authorization", `Bearer ${token1}`)
        .send({ token: sharedPushToken })
        .expect(201);
      const dupPush = await request(server())
        .post("/v1/devices/push-token")
        .set("Authorization", `Bearer ${token2}`)
        .send({ token: sharedPushToken })
        .expect(409);
      expect(record(dupPush.body)).toEqual({ message: "Ese token push ya está registrado" });
    } finally {
      await pool.end();
    }
  });

  it("GET /v1/branches/mine devuelve hours: [] sin horario y hours ordenado por weekday tras PUT hours", async () => {
    const owner = await request(server())
      .post("/v1/auth/register")
      .send({
        email: "horarios-021@example.invalid",
        password,
        client: "WEB",
        role: "RESTAURANT",
        consents: { termsAccepted: true, privacyAccepted: true },
      })
      .expect(201);
    const cookie = sessionCookie(owner.headers);

    const siteRes = await request(server())
      .post("/v1/restaurants")
      .set("Cookie", cookie)
      .send({
        legalName: "Pizzería Tocancipá SAS",
        tradeName: "Pizzería 021",
        nit: "901219999-2",
        email: "pizza-021@example.invalid",
        phoneE164: "+573001119921",
        establishmentName: "Sede Norte",
        branchName: "Norte",
        addressLine: "Carrera 6 # 10-12, Tocancipá",
        longitude: -73.9125,
        latitude: 4.9652,
      })
      .expect(201);
    const branchId = String(record(siteRes.body)["branchId"]);

    // Antes de cargar horarios -> hours: []
    const mineEmpty = await request(server())
      .get("/v1/branches/mine")
      .set("Cookie", cookie)
      .expect(200);
    expect(record(mineEmpty.body)["branches"]).toEqual([
      expect.objectContaining({
        id: branchId,
        hours: [],
      }),
    ]);

    // Guardar horarios desordenados por weekday
    await request(server())
      .put(`/v1/branches/${branchId}/hours`)
      .set("Cookie", cookie)
      .send({
        slots: [
          { weekday: 5, opensMinute: 600, closesMinute: 1320, closed: false },
          { weekday: 1, opensMinute: 540, closesMinute: 1200, closed: false },
          { weekday: 3, opensMinute: 540, closesMinute: 1200, closed: false },
        ],
      })
      .expect(200);

    // Después -> hours ordenado por weekday ASC
    const mineSaved = await request(server())
      .get("/v1/branches/mine")
      .set("Cookie", cookie)
      .expect(200);
    expect(record(mineSaved.body)["branches"]).toEqual([
      expect.objectContaining({
        id: branchId,
        hours: [
          { weekday: 1, opensMinute: 540, closesMinute: 1200, closed: false },
          { weekday: 3, opensMinute: 540, closesMinute: 1200, closed: false },
          { weekday: 5, opensMinute: 600, closesMinute: 1320, closed: false },
        ],
      }),
    ]);
  });
});
