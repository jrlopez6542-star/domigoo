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
const polygon =
  "SRID=4326;MULTIPOLYGON(((-73.95 4.94,-73.88 4.94,-73.88 4.99,-73.95 4.99,-73.95 4.94)))";

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

describe("tarifas", () => {
  beforeAll(() => {
    migrateDatabase(databaseUrl);
  });

  beforeEach(async () => {
    resetLoginThrottle();
    await resetDatabase(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`DELETE FROM tariff_rules`);
    await pool.query(`DELETE FROM tariff_zones`);
    await pool.query(`DELETE FROM tariff_versions`);
    await pool.end();
    currentApp = await createApp(testEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO" }));
  });

  afterEach(async () => {
    await currentApp?.close();
    currentApp = undefined;
  });

  it("cotiza dentro de la zona y fuera con la regla por defecto, en pesos enteros", async () => {
    const admin = await request(server())
      .post("/v1/auth/register")
      .send({ email: "tarifa@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const pool = new Pool({ connectionString: databaseUrl });
    const user = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'tarifa@example.invalid'`,
    );
    await pool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Tarifas', 'OPERATIONS', now(), now())`,
      [user.rows[0]?.id],
    );
    await pool.end();
    const token = String(record(admin.body)["token"]);
    const auth = { Authorization: `Bearer ${token}` };

    const version = await request(server())
      .post("/v1/admin/tariffs/versions")
      .set(auth)
      .send({ name: "Tocancipa desarrollo" })
      .expect(201);
    const versionId = String(record(version.body)["id"]);
    const zone = await request(server())
      .post("/v1/admin/tariffs/zones")
      .set(auth)
      .send({ versionId, code: "urbano", name: "Envolvente", polygonWkt: polygon, priority: 10 })
      .expect(201);
    await request(server())
      .post("/v1/admin/tariffs/rules")
      .set(auth)
      .send({
        versionId,
        zoneId: record(zone.body)["id"],
        baseFeeCop: 2000,
        perKmCop: 0,
        minimumFeeCop: 2000,
        nightMultiplierBps: 10000,
        nightStartsMinute: 0,
        nightEndsMinute: 0,
      })
      .expect(201);
    await request(server())
      .post("/v1/admin/tariffs/rules")
      .set(auth)
      .send({
        versionId,
        zoneId: null,
        baseFeeCop: 8000,
        perKmCop: 0,
        minimumFeeCop: 8000,
        nightMultiplierBps: 10000,
        nightStartsMinute: 0,
        nightEndsMinute: 0,
      })
      .expect(201);
    await request(server())
      .post("/v1/admin/tariffs/publish")
      .set(auth)
      .send({ versionId })
      .expect(201);

    const inside = await request(server())
      .post("/v1/admin/tariffs/quote")
      .set(auth)
      .send({
        origin: { longitude: -73.9132, latitude: 4.9655 },
        destination: { longitude: -73.92, latitude: 4.97 },
        at: "2026-01-15T18:00:00.000Z",
      })
      .expect(201);
    const outside = await request(server())
      .post("/v1/admin/tariffs/quote")
      .set(auth)
      .send({
        origin: { longitude: -73.9132, latitude: 4.9655 },
        destination: { longitude: -74.3, latitude: 5.3 },
        at: "2026-01-15T18:00:00.000Z",
      })
      .expect(201);
    expect(record(inside.body)["zoneCode"]).toBe("urbano");
    expect(record(inside.body)["deliveryFeeCop"]).toBe(2000);
    expect(Number.isInteger(record(inside.body)["deliveryFeeCop"])).toBe(true);
    expect(Number(record(inside.body)["distanceMeters"])).toBeGreaterThan(0);
    expect(record(outside.body)["zoneCode"]).toBeNull();
    expect(record(outside.body)["deliveryFeeCop"]).toBe(8000);

    const second = await request(server())
      .post("/v1/admin/tariffs/versions")
      .set(auth)
      .send({ name: "Siguiente" })
      .expect(201);
    await request(server())
      .post("/v1/admin/tariffs/publish")
      .set(auth)
      .send({ versionId: record(second.body)["id"] })
      .expect(201);
    const published = new Pool({ connectionString: databaseUrl });
    const count = await published.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM tariff_versions WHERE status = 'PUBLISHED'`,
    );
    await published.end();
    expect(count.rows[0]?.count).toBe("1");
  });
});
