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

describe("horario y activación", () => {
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
  });

  it("exige punto y franja, rechaza el día 0 y deja la sucursal activa con punto", async () => {
    const owner = await request(server())
      .post("/v1/auth/register")
      .send({ email: "horario@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const token = String(record(owner.body)["token"]);
    const created = await request(server())
      .post("/v1/restaurants")
      .set("Authorization", `Bearer ${token}`)
      .send({
        legalName: "Razon horario",
        tradeName: "Horario",
        nit: "900000121",
        email: "horario-local@example.invalid",
        phoneE164: "+573001110121",
        establishmentName: "Sede",
        branchName: "Principal",
        addressLine: "Calle",
        longitude: -73.91,
        latitude: 4.96,
      })
      .expect(201);
    const restaurantId = String(record(created.body)["id"]);
    const branchId = String(record(created.body)["branchId"]);

    await request(server())
      .post(`/v1/branches/${branchId}/activate`)
      .set("Authorization", `Bearer ${token}`)
      .expect(422);
    await request(server())
      .put(`/v1/branches/${branchId}/hours`)
      .set("Authorization", `Bearer ${token}`)
      .send({ slots: [{ weekday: 0, opensMinute: 0, closesMinute: 60, closed: false }] })
      .expect(422);

    const pool = new Pool({ connectionString: databaseUrl });
    await expect(
      pool.query(
        `INSERT INTO branch_hours (id, "branchId", weekday, "opensMinute", "closesMinute", closed)
         VALUES (gen_random_uuid(), $1, 0, 0, 60, false)`,
        [branchId],
      ),
    ).rejects.toThrow(/branch_hours_clock|check constraint/i);
    await pool.end();

    await request(server())
      .put(`/v1/branches/${branchId}/hours`)
      .set("Authorization", `Bearer ${token}`)
      .send({ slots: [{ weekday: 1, opensMinute: 480, closesMinute: 1320, closed: false }] })
      .expect(200);

    const cleared = new Pool({ connectionString: databaseUrl });
    await cleared.query(`UPDATE branches SET location = NULL WHERE id = $1`, [branchId]);
    await cleared.end();
    await request(server())
      .post(`/v1/branches/${branchId}/activate`)
      .set("Authorization", `Bearer ${token}`)
      .expect(422);

    const restored = new Pool({ connectionString: databaseUrl });
    await restored.query(
      `UPDATE branches SET location = ST_SetSRID(ST_MakePoint(-73.91, 4.96), 4326)::geography WHERE id = $1`,
      [branchId],
    );
    await restored.end();
    await request(server())
      .post(`/v1/branches/${branchId}/activate`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const check = new Pool({ connectionString: databaseUrl });
    const branch = await check.query<{ status: string; hasPoint: boolean }>(
      `SELECT status::text AS status, location IS NOT NULL AS "hasPoint" FROM branches WHERE id = $1`,
      [branchId],
    );
    await check.end();
    expect(branch.rows[0]).toEqual({ status: "ACTIVE", hasPoint: true });

    await request(server())
      .post(`/v1/restaurants/${restaurantId}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    const admin = await request(server())
      .post("/v1/auth/register")
      .send({ email: "activa@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const adminIdPool = new Pool({ connectionString: databaseUrl });
    const adminRow = await adminIdPool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'activa@example.invalid'`,
    );
    await adminIdPool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Ops', 'OPERATIONS', now(), now())`,
      [adminRow.rows[0]?.id],
    );
    await adminIdPool.end();
    await request(server())
      .post(`/v1/admin/restaurants/${restaurantId}/activate`)
      .set("Authorization", `Bearer ${String(record(admin.body)["token"])}`)
      .expect(201);
    const audit = new Pool({ connectionString: databaseUrl });
    const events = await audit.query(
      `SELECT action FROM audit_logs WHERE action = 'restaurant.activated'`,
    );
    const status = await audit.query<{ status: string }>(
      `SELECT status::text AS status FROM restaurants WHERE id = $1`,
      [restaurantId],
    );
    await audit.end();
    expect(events.rowCount).toBe(1);
    expect(status.rows[0]?.status).toBe("ACTIVE");
  });
});
