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

async function countUsers(pool: Pool): Promise<number> {
  const res = await pool.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM users`);
  return res.rows[0]?.total ?? 0;
}

async function promoteSuperadmin(pool: Pool, email: string): Promise<void> {
  await pool.query(
    `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
     SELECT id, 'Admin 020', 'SUPERADMIN', now(), now()
     FROM users WHERE email = $1`,
    [email],
  );
}

describe("ORDEN 020: integridad de documentos legales en registro, 22P02 -> 404 y alta de restaurante", () => {
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

  it("BD limpia: registro con versión inexistente responde 422 sin crear usuario ni documentos; sin versión crea 0.1-borrador", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      // 1) Versión inexistente en BD limpia -> 422 sin usuario ni legal_documents nuevos
      const badRes = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "inexistente-limpia@example.invalid",
          password,
          client: "WEB",
          consents: { termsAccepted: true, privacyAccepted: true, version: "x-123" },
        })
        .expect(422);
      expect(record(badRes.body)).toEqual({
        message: "La versión de los documentos legales no existe",
      });
      expect(await countUsers(pool)).toBe(0);

      const currentEmpty = await request(server()).get("/v1/legal-documents/current").expect(200);
      expect(record(currentEmpty.body)["documents"]).toEqual([]);

      // 2) BD limpia sin consents.version -> sigue dando legalVersion "0.1-borrador"
      const okRes = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "arranque@example.invalid",
          password,
          client: "WEB",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      expect(record(okRes.body)["legalVersion"]).toBe("0.1-borrador");
    } finally {
      await pool.end();
    }
  });

  it("tras publicar versión nueva en admin: versión inexistente da 422 sin tocar current; sin versión usa vigente sin desplazarlo", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const adminReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "admin-legal-020@example.invalid",
          password,
          client: "ADMIN",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const adminCookie = sessionCookie(adminReg.headers);
      await promoteSuperadmin(pool, "admin-legal-020@example.invalid");

      const publishedPrivacy = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({
          kind: "PRIVACY_NOTICE",
          version: "2026-02",
          content: "Política de privacidad oficial 2026-02",
        })
        .expect(201);
      const publishedPrivacyId = String(record(publishedPrivacy.body)["id"]);

      const publishedTerms = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", adminCookie)
        .send({
          kind: "TERMS",
          version: "2026-02",
          content: "Términos y condiciones oficiales 2026-02",
        })
        .expect(201);
      const publishedTermsId = String(record(publishedTerms.body)["id"]);

      const currentBefore = await request(server()).get("/v1/legal-documents/current").expect(200);
      const usersBefore = await countUsers(pool);

      // 1) Registro sin sesión con consents.version inexistente -> 422, sin usuario, current intacto
      const badVersion = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "spoof-020@example.invalid",
          password,
          client: "WEB",
          consents: { termsAccepted: true, privacyAccepted: true, version: "x-123" },
        })
        .expect(422);
      expect(record(badVersion.body)).toEqual({
        message: "La versión de los documentos legales no existe",
      });
      expect(await countUsers(pool)).toBe(usersBefore);

      const currentAfterBad = await request(server())
        .get("/v1/legal-documents/current")
        .expect(200);
      expect(currentAfterBad.body).toEqual(currentBefore.body);

      // 2) Registro sin consents.version -> usa los documentos vigentes (2026-02) sin desplazarlos
      const nextUser = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "cliente-020@example.invalid",
          password,
          client: "WEB",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const nextUserId = String(record(nextUser.body)["id"]);
      expect(record(nextUser.body)["legalVersion"]).toBe("2026-02");

      const currentAfterGood = await request(server())
        .get("/v1/legal-documents/current")
        .expect(200);
      expect(currentAfterGood.body).toEqual(currentBefore.body);

      const consentsRes = await pool.query<{ purpose: string; legalDocumentId: string }>(
        `SELECT purpose::text AS purpose, "legalDocumentId"
         FROM consent_records
         WHERE "userId" = $1
         ORDER BY purpose::text`,
        [nextUserId],
      );
      expect(consentsRes.rows).toEqual([
        { purpose: "ACCOUNT", legalDocumentId: publishedPrivacyId },
        { purpose: "TERMS_ACCEPTANCE", legalDocumentId: publishedTermsId },
      ]);
    } finally {
      await pool.end();
    }
  });

  it("identificadores no UUID devuelven 404 (nunca 500) en consents, orders, branches y restaurants", async () => {
    const userRes = await request(server())
      .post("/v1/auth/register")
      .send({
        email: "uuid-check-020@example.invalid",
        password,
        client: "WEB",
        consents: { termsAccepted: true, privacyAccepted: true },
      })
      .expect(201);
    const cookie = sessionCookie(userRes.headers);

    const expected404 = { message: "Not Found", statusCode: 404 };

    const revokeRes = await request(server())
      .post("/v1/consents/abc/revoke")
      .set("Cookie", cookie)
      .send({})
      .expect(404);
    expect(revokeRes.body).toEqual(expected404);

    const orderRes = await request(server())
      .get("/v1/orders/abc")
      .set("Cookie", cookie)
      .expect(404);
    expect(orderRes.body).toEqual(expected404);

    const hoursRes = await request(server())
      .put("/v1/branches/abc/hours")
      .set("Cookie", cookie)
      .send({ slots: [{ weekday: 1, opensMinute: 480, closesMinute: 1200, closed: false }] })
      .expect(404);
    expect(hoursRes.body).toEqual(expected404);

    const activateRes = await request(server())
      .post("/v1/branches/abc/activate")
      .set("Cookie", cookie)
      .send({})
      .expect(404);
    expect(activateRes.body).toEqual(expected404);

    const submitRes = await request(server())
      .post("/v1/restaurants/abc/submit")
      .set("Cookie", cookie)
      .send({})
      .expect(404);
    expect(submitRes.body).toEqual(expected404);
  });

  it("recorrido completo de alta: crear restaurante -> horario -> activar sucursal -> enviar a revisión -> admin activa -> branches/mine trae restaurantStatus ACTIVE", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const adminReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "admin-alta-020@example.invalid",
          password,
          client: "ADMIN",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const adminCookie = sessionCookie(adminReg.headers);
      await promoteSuperadmin(pool, "admin-alta-020@example.invalid");

      const ownerReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "restaurante-alta-020@example.invalid",
          password,
          client: "WEB",
          role: "RESTAURANT",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const ownerCookie = sessionCookie(ownerReg.headers);

      // 1) Crear restaurante + sucursal (DRAFT / DRAFT)
      const siteRes = await request(server())
        .post("/v1/restaurants")
        .set("Cookie", ownerCookie)
        .send({
          legalName: "Sabores de Tocancipá SAS",
          tradeName: "Sabores 020",
          nit: "901202020-1",
          email: "contacto-020@example.invalid",
          phoneE164: "+573001110020",
          establishmentName: "Sede Principal",
          branchName: "Centro Tocancipá",
          addressLine: "Calle 8 # 5-20, Tocancipá",
          longitude: -73.9125,
          latitude: 4.9652,
        })
        .expect(201);
      const restaurantId = String(record(siteRes.body)["id"]);
      const branchId = String(record(siteRes.body)["branchId"]);

      const mineDraft = await request(server())
        .get("/v1/branches/mine")
        .set("Cookie", ownerCookie)
        .expect(200);
      expect(record(mineDraft.body)["branches"]).toEqual([
        expect.objectContaining({
          id: branchId,
          restaurantId,
          status: "DRAFT",
          restaurantStatus: "DRAFT",
        }),
      ]);

      // 2) Cargar horario
      await request(server())
        .put(`/v1/branches/${branchId}/hours`)
        .set("Cookie", ownerCookie)
        .send({
          slots: [
            { weekday: 1, opensMinute: 480, closesMinute: 1260, closed: false },
            { weekday: 2, opensMinute: 480, closesMinute: 1260, closed: false },
          ],
        })
        .expect(200);

      // 3) Activar sucursal -> status ACTIVE, restaurantStatus sigue DRAFT
      await request(server())
        .post(`/v1/branches/${branchId}/activate`)
        .set("Cookie", ownerCookie)
        .send({})
        .expect(201);

      const mineBranchActive = await request(server())
        .get("/v1/branches/mine")
        .set("Cookie", ownerCookie)
        .expect(200);
      expect(record(mineBranchActive.body)["branches"]).toEqual([
        expect.objectContaining({
          id: branchId,
          restaurantId,
          status: "ACTIVE",
          restaurantStatus: "DRAFT",
        }),
      ]);

      // 4) Enviar registro a revisión -> restaurantStatus PENDING_REVIEW
      await request(server())
        .post(`/v1/restaurants/${restaurantId}/submit`)
        .set("Cookie", ownerCookie)
        .send({})
        .expect(201);

      const minePending = await request(server())
        .get("/v1/branches/mine")
        .set("Cookie", ownerCookie)
        .expect(200);
      expect(record(minePending.body)["branches"]).toEqual([
        expect.objectContaining({
          id: branchId,
          restaurantId,
          status: "ACTIVE",
          restaurantStatus: "PENDING_REVIEW",
        }),
      ]);

      // 5) Admin activa restaurante -> restaurantStatus ACTIVE
      await request(server())
        .post(`/v1/admin/restaurants/${restaurantId}/activate`)
        .set("Cookie", adminCookie)
        .send({})
        .expect(201);

      const mineActive = await request(server())
        .get("/v1/branches/mine")
        .set("Cookie", ownerCookie)
        .expect(200);
      expect(record(mineActive.body)["branches"]).toEqual([
        expect.objectContaining({
          id: branchId,
          restaurantId,
          status: "ACTIVE",
          restaurantStatus: "ACTIVE",
        }),
      ]);
    } finally {
      await pool.end();
    }
  });
});
