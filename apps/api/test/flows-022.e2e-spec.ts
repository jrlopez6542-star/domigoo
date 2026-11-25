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
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const documentTypes = [
  "NATIONAL_ID",
  "DRIVER_LICENSE",
  "SOAT",
  "TECH_INSPECTION",
  "VEHICLE_PHOTO",
  "PROFILE_PHOTO",
] as const;

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

async function promoteAdmin(
  pool: Pool,
  email: string,
  role: "SUPERADMIN" | "REVIEWER" = "SUPERADMIN",
): Promise<void> {
  await pool.query(
    `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
     SELECT id, 'Admin 022', $2::"PlatformRole", now(), now()
     FROM users WHERE email = $1`,
    [email, role],
  );
}

describe("ORDEN 022: push-token atómico, tariffs 404/422 sin 500, verification-cases y GET /v1/couriers/me", () => {
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

  it("POST /v1/devices/push-token reasigna el token al usuario actual con 201 y conserva id para el mismo usuario", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const userA = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "push-a-022@example.invalid",
          password,
          client: "MOBILE",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const userB = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "push-b-022@example.invalid",
          password,
          client: "MOBILE",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const tokenA = String(record(userA.body)["token"]);
      const tokenB = String(record(userB.body)["token"]);
      const userBId = String(record(userB.body)["id"]);
      const sharedToken = "fcm-dispositivo-compartido-022-xyz";

      const first = await request(server())
        .post("/v1/devices/push-token")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ token: sharedToken })
        .expect(201);
      const firstId = String(record(first.body)["id"]);
      expect(record(first.body)["platform"]).toBe("ANDROID");

      // Mismo usuario vuelve a registrar -> mantiene el mismo id
      const repeatA = await request(server())
        .post("/v1/devices/push-token")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ token: sharedToken })
        .expect(201);
      expect(record(repeatA.body)).toEqual({ id: firstId, platform: "ANDROID" });

      // Segundo usuario registra el mismo token -> 201 y reasignación atómica a B
      const reassigned = await request(server())
        .post("/v1/devices/push-token")
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ token: sharedToken })
        .expect(201);
      expect(record(reassigned.body)).toEqual({ id: firstId, platform: "ANDROID" });

      const rows = await pool.query<{ userId: string; revokedAt: Date | null }>(
        `SELECT "userId", "revokedAt" FROM device_push_tokens WHERE token = $1`,
        [sharedToken],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.userId).toBe(userBId);
      expect(rows.rows[0]?.revokedAt).toBeNull();
    } finally {
      await pool.end();
    }
  });

  it("POST /v1/admin/tariffs/zones y /rules nunca devuelven 500 por FK inexistente o polígono WKT inválido", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const adminReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "admin-tariffs-022@example.invalid",
          password,
          client: "ADMIN",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const adminCookie = sessionCookie(adminReg.headers);
      await promoteAdmin(pool, "admin-tariffs-022@example.invalid", "SUPERADMIN");

      const missingUuid = "00000000-0000-4000-8000-000000000099";

      // 4a) zones con versionId UUID inexistente -> 404
      await request(server())
        .post("/v1/admin/tariffs/zones")
        .set("Cookie", adminCookie)
        .send({
          versionId: missingUuid,
          code: "Z_MISSING",
          name: "Zona sin versión",
          polygonWkt: "POLYGON((-73.92 4.96, -73.90 4.96, -73.90 4.98, -73.92 4.98, -73.92 4.96))",
          priority: 1,
        })
        .expect(404);

      const versionRes = await request(server())
        .post("/v1/admin/tariffs/versions")
        .set("Cookie", adminCookie)
        .send({ name: "Tarifa 022" })
        .expect(201);
      const versionId = String(record(versionRes.body)["id"]);

      // 4b) zones con polygonWkt inválido -> 422 sin llegar a PostGIS
      for (const badWkt of [
        "POLYGON((1 2, 3 4))",
        "POLYGON((-73.92 4.96, -73.90 4.96, -73.90 4.98, -73.92 4.98))",
        "POLYGON((-200 4.96, -73.90 4.96, -73.90 4.98, -200 4.96))",
        "POINT(-73.91 4.96)",
      ]) {
        const res = await request(server())
          .post("/v1/admin/tariffs/zones")
          .set("Cookie", adminCookie)
          .send({
            versionId,
            code: "Z_BAD",
            name: "Zona mala",
            polygonWkt: badWkt,
            priority: 1,
          })
          .expect(422);
        expect(record(res.body)).toEqual({ message: "El polígono de la zona no es válido" });
      }

      // 4c) rules con versionId inexistente o zoneId inexistente -> 404 (nunca 500)
      await request(server())
        .post("/v1/admin/tariffs/rules")
        .set("Cookie", adminCookie)
        .send({
          versionId: missingUuid,
          zoneId: null,
          baseFeeCop: 4000,
          perKmCop: 1000,
          minimumFeeCop: 4000,
          nightMultiplierBps: 10000,
          nightStartsMinute: 0,
          nightEndsMinute: 0,
        })
        .expect(404);

      await request(server())
        .post("/v1/admin/tariffs/rules")
        .set("Cookie", adminCookie)
        .send({
          versionId,
          zoneId: missingUuid,
          baseFeeCop: 4000,
          perKmCop: 1000,
          minimumFeeCop: 4000,
          nightMultiplierBps: 10000,
          nightStartsMinute: 0,
          nightEndsMinute: 0,
        })
        .expect(404);
    } finally {
      await pool.end();
    }
  });

  it("GET /v1/admin/verification-cases agrega courierName y submittedAt ISO sin documentos ni datos sensibles", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const reviewerReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "reviewer-022@example.invalid",
          password,
          client: "ADMIN",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const reviewerCookie = sessionCookie(reviewerReg.headers);
      await promoteAdmin(pool, "reviewer-022@example.invalid", "REVIEWER");

      const courierReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "domi-case-022@example.invalid",
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
      const courierToken = String(record(courierReg.body)["token"]);

      const createdCourier = await request(server())
        .post("/v1/couriers")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({
          documentType: "CC",
          documentNumber: "1022000111",
          firstName: "Camila",
          lastName: "Torres",
        })
        .expect(201);
      const courierId = String(record(createdCourier.body)["id"]);

      for (const type of documentTypes) {
        await request(server())
          .post("/v1/couriers/me/documents")
          .set("Authorization", `Bearer ${courierToken}`)
          .field("type", type)
          .attach("file", pdf, { filename: "doc.pdf", contentType: "application/pdf" })
          .expect(201);
      }
      await request(server())
        .post("/v1/couriers/me/vehicle")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ plate: "D022A1", soatExpiresOn: "2028-04-01", techExpiresOn: "2028-08-01" })
        .expect(201);
      const openedCase = await request(server())
        .post("/v1/couriers/me/verification-cases")
        .set("Authorization", `Bearer ${courierToken}`)
        .expect(201);
      const caseId = String(record(openedCase.body)["id"]);

      const listRes = await request(server())
        .get("/v1/admin/verification-cases")
        .set("Cookie", reviewerCookie)
        .expect(200);
      const cases = listRes.body as unknown[];
      expect(cases).toHaveLength(1);
      const row = record(cases[0]);
      expect(row["id"]).toBe(caseId);
      expect(row["courierId"]).toBe(courierId);
      expect(row["status"]).toBe("PENDING_HUMAN");
      expect(row["courierName"]).toBe("Camila Torres");
      expect(typeof row["submittedAt"]).toBe("string");
      expect(Number.isNaN(Date.parse(String(row["submittedAt"])))).toBe(false);
      expect(Object.keys(row).sort()).toEqual([
        "courierId",
        "courierName",
        "id",
        "status",
        "submittedAt",
      ]);
      expect(JSON.stringify(row)).not.toContain("1022000111");
    } finally {
      await pool.end();
    }
  });

  it("GET /v1/couriers/me devuelve perfil propio sin documento, 404 sin perfil y aisla usuarios", async () => {
    await request(server()).get("/v1/couriers/me").expect(401);

    const user1 = await request(server())
      .post("/v1/auth/register")
      .send({
        email: "domi-me-1-022@example.invalid",
        password,
        client: "WEB",
        role: "COURIER",
        consents: {
          termsAccepted: true,
          privacyAccepted: true,
          sensitiveDataAccepted: true,
        },
      })
      .expect(201);
    const cookie1 = sessionCookie(user1.headers);

    const user2 = await request(server())
      .post("/v1/auth/register")
      .send({
        email: "domi-me-2-022@example.invalid",
        password,
        client: "WEB",
        role: "COURIER",
        consents: {
          termsAccepted: true,
          privacyAccepted: true,
          sensitiveDataAccepted: true,
        },
      })
      .expect(201);
    const cookie2 = sessionCookie(user2.headers);

    // Sin perfil aún -> 404 genérico
    await request(server()).get("/v1/couriers/me").set("Cookie", cookie1).expect(404);

    // Crea perfil para usuario 1
    const created1 = await request(server())
      .post("/v1/couriers")
      .set("Cookie", cookie1)
      .send({
        documentType: "CC",
        documentNumber: "1022000999",
        firstName: "Mateo",
        lastName: "Pérez",
      })
      .expect(201);
    const courier1Id = String(record(created1.body)["id"]);

    const me1 = await request(server()).get("/v1/couriers/me").set("Cookie", cookie1).expect(200);
    const me1Body = record(me1.body);
    expect(me1Body).toEqual({
      id: courier1Id,
      status: "REGISTERING",
      firstName: "Mateo",
      lastName: "Pérez",
    });
    expect(Object.keys(me1Body).sort()).toEqual(["firstName", "id", "lastName", "status"]);
    expect(JSON.stringify(me1Body)).not.toContain("1022000999");

    // Usuario 2 sin perfil no ve el perfil del usuario 1 -> 404
    await request(server()).get("/v1/couriers/me").set("Cookie", cookie2).expect(404);
  });
});
