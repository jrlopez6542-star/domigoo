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
const longitude = -73.9132;
const latitude = 4.9655;

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

describe("sede del restaurante", () => {
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

  it("crea establecimiento y sucursal con un punto que se lee a menos de un metro", async () => {
    const owner = await request(server())
      .post("/v1/auth/register")
      .send({ email: "sede@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const stranger = await request(server())
      .post("/v1/auth/register")
      .send({ email: "otro-sede@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const created = await request(server())
      .post("/v1/restaurants")
      .set("Authorization", `Bearer ${String(record(owner.body)["token"])}`)
      .send({
        legalName: "Razon de prueba",
        tradeName: "Local de prueba",
        nit: "900000111",
        email: "local@example.invalid",
        phoneE164: "+573001110111",
        establishmentName: "Establecimiento",
        branchName: "Principal",
        addressLine: "Calle sintetica",
        longitude,
        latitude,
      })
      .expect(201);
    const body = record(created.body);
    expect(body["status"]).toBe("DRAFT");
    expect(typeof body["establishmentId"]).toBe("string");
    expect(typeof body["branchId"]).toBe("string");

    const site = await request(server())
      .get(`/v1/restaurants/${String(body["id"])}/site`)
      .set("Authorization", `Bearer ${String(record(owner.body)["token"])}`)
      .expect(200);
    const read = record(site.body);
    expect(Math.abs(Number(read["longitude"]) - longitude)).toBeLessThan(0.00001);
    expect(Math.abs(Number(read["latitude"]) - latitude)).toBeLessThan(0.00001);

    const pool = new Pool({ connectionString: databaseUrl });
    const distance = await pool.query<{ meters: number }>(
      `SELECT ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)::float8 AS meters
       FROM branches WHERE id = $3`,
      [longitude, latitude, body["branchId"]],
    );
    const counts = await pool.query<{ establishments: string; branches: string }>(
      `SELECT
         (SELECT count(*) FROM establishments)::text AS establishments,
         (SELECT count(*) FROM branches)::text AS branches`,
    );
    await pool.end();
    expect(distance.rows[0]?.meters ?? 999).toBeLessThan(1);
    expect(counts.rows[0]).toEqual({ establishments: "1", branches: "1" });

    await request(server())
      .get(`/v1/restaurants/${String(body["id"])}/site`)
      .set("Authorization", `Bearer ${String(record(stranger.body)["token"])}`)
      .expect(404);
  });
});
