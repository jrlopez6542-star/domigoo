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
const polygon =
  "SRID=4326;MULTIPOLYGON(((-73.95 4.94,-73.88 4.94,-73.88 4.99,-73.95 4.99,-73.95 4.94)))";
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const documentTypes = [
  "NATIONAL_ID",
  "DRIVER_LICENSE",
  "SOAT",
  "TECH_INSPECTION",
  "VEHICLE_PHOTO",
  "PROFILE_PHOTO",
] as const;

type PlatformRole = "SUPERADMIN" | "OPERATIONS" | "SECURITY" | "REVIEWER";
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

async function registerAdminWithRole(
  pool: Pool,
  email: string,
  role: PlatformRole,
): Promise<{ userId: string; cookie: string }> {
  const res = await request(server())
    .post("/v1/auth/register")
    .send({
      email,
      password,
      client: "ADMIN",
      consents: { termsAccepted: true, privacyAccepted: true },
    })
    .expect(201);
  const cookie = sessionCookie(res.headers);
  const inserted = await pool.query<{ userId: string }>(
    `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
     SELECT id, $2, $3::"PlatformRole", now(), now()
     FROM users WHERE email = $1
     RETURNING "userId"`,
    [email, `Admin ${role} 018`, role],
  );
  const userId = inserted.rows[0]?.userId;
  if (userId === undefined) {
    throw new Error(`No se pudo crear admin_profiles para ${role}`);
  }
  return { userId, cookie };
}

async function countRows(pool: Pool, table: string): Promise<number> {
  const res = await pool.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM ${table}`);
  return res.rows[0]?.total ?? 0;
}

async function createSubmittedRestaurant(
  ownerCookie: string,
  suffix: string,
): Promise<{ restaurantId: string; branchId: string }> {
  const site = await request(server())
    .post("/v1/restaurants")
    .set("Cookie", ownerCookie)
    .send({
      legalName: `Razon 018 ${suffix}`,
      tradeName: `Comercio 018 ${suffix}`,
      nit: `900018${suffix}`,
      email: `local-018-${suffix}@example.invalid`,
      phoneE164: `+573001180${suffix}`,
      establishmentName: `Sede 018 ${suffix}`,
      branchName: "Principal",
      addressLine: `Calle 18 # 4-${suffix}`,
      longitude: -73.9132,
      latitude: 4.9655,
    })
    .expect(201);
  const restaurantId = String(record(site.body)["id"]);
  const branchId = String(record(site.body)["branchId"]);

  await request(server())
    .put(`/v1/branches/${branchId}/hours`)
    .set("Cookie", ownerCookie)
    .send({ slots: [{ weekday: 1, opensMinute: 480, closesMinute: 1200 }] })
    .expect(200);
  await request(server())
    .post(`/v1/branches/${branchId}/activate`)
    .set("Cookie", ownerCookie)
    .expect(201);
  await request(server())
    .post(`/v1/restaurants/${restaurantId}/submit`)
    .set("Cookie", ownerCookie)
    .expect(201);

  return { restaurantId, branchId };
}

describe("matriz de acceso del rol admin REVIEWER y preservación de otros roles (ORDEN 018)", () => {
  const env = readEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO" });

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

  it("bloquea REVIEWER con 403 sin efecto en BD en los 10 endpoints restringidos, preserva acceso de flujo de revisión y mantiene códigos actuales", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const superadmin = await registerAdminWithRole(
        pool,
        "superadmin-018@example.invalid",
        "SUPERADMIN",
      );
      const operations = await registerAdminWithRole(
        pool,
        "operations-018@example.invalid",
        "OPERATIONS",
      );
      const security = await registerAdminWithRole(
        pool,
        "security-018@example.invalid",
        "SECURITY",
      );
      const reviewer = await registerAdminWithRole(
        pool,
        "reviewer-018@example.invalid",
        "REVIEWER",
      );

      const ownerRes = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "owner-018@example.invalid",
          password,
          client: "WEB",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const ownerCookie = sessionCookie(ownerRes.headers);

      const restSuper = await createSubmittedRestaurant(ownerCookie, "101");
      const restOps = await createSubmittedRestaurant(ownerCookie, "102");
      const restSec = await createSubmittedRestaurant(ownerCookie, "103");

      // =========================================================================
      // 1) Endpoints donde REVIEWER recibe 403 sin efecto en BD ni audit_logs
      //    SUPERADMIN, OPERATIONS y SECURITY conservan comportamiento actual (201)
      // =========================================================================

      // 1.1 POST /v1/admin/tariffs/versions
      {
        const versionsBefore = await countRows(pool, "tariff_versions");
        const auditsBefore = await countRows(pool, "audit_logs");
        await request(server())
          .post("/v1/admin/tariffs/versions")
          .set("Cookie", reviewer.cookie)
          .send({ name: "Tarifa Reviewer Bloqueada" })
          .expect(403);
        expect(await countRows(pool, "tariff_versions")).toBe(versionsBefore);
        expect(await countRows(pool, "audit_logs")).toBe(auditsBefore);
      }

      const vSuperRes = await request(server())
        .post("/v1/admin/tariffs/versions")
        .set("Cookie", superadmin.cookie)
        .send({ name: "Tarifa 018 Superadmin" })
        .expect(201);
      const vSuperId = String(record(vSuperRes.body)["id"]);

      const vOpsRes = await request(server())
        .post("/v1/admin/tariffs/versions")
        .set("Cookie", operations.cookie)
        .send({ name: "Tarifa 018 Operations" })
        .expect(201);
      const vOpsId = String(record(vOpsRes.body)["id"]);

      const vSecRes = await request(server())
        .post("/v1/admin/tariffs/versions")
        .set("Cookie", security.cookie)
        .send({ name: "Tarifa 018 Security" })
        .expect(201);
      const vSecId = String(record(vSecRes.body)["id"]);

      // 1.2 POST /v1/admin/tariffs/zones
      {
        const zonesBefore = await countRows(pool, "tariff_zones");
        const auditsBefore = await countRows(pool, "audit_logs");
        await request(server())
          .post("/v1/admin/tariffs/zones")
          .set("Cookie", reviewer.cookie)
          .send({
            versionId: vSuperId,
            code: "ZONA_REV",
            name: "Zona Reviewer",
            polygonWkt: polygon,
            priority: 10,
          })
          .expect(403);
        expect(await countRows(pool, "tariff_zones")).toBe(zonesBefore);
        expect(await countRows(pool, "audit_logs")).toBe(auditsBefore);
      }

      await request(server())
        .post("/v1/admin/tariffs/zones")
        .set("Cookie", superadmin.cookie)
        .send({
          versionId: vSuperId,
          code: "ZONA_SUPER",
          name: "Zona Super",
          polygonWkt: polygon,
          priority: 10,
        })
        .expect(201);
      await request(server())
        .post("/v1/admin/tariffs/zones")
        .set("Cookie", operations.cookie)
        .send({
          versionId: vOpsId,
          code: "ZONA_OPS",
          name: "Zona Ops",
          polygonWkt: polygon,
          priority: 10,
        })
        .expect(201);
      await request(server())
        .post("/v1/admin/tariffs/zones")
        .set("Cookie", security.cookie)
        .send({
          versionId: vSecId,
          code: "ZONA_SEC",
          name: "Zona Sec",
          polygonWkt: polygon,
          priority: 10,
        })
        .expect(201);

      // 1.3 POST /v1/admin/tariffs/rules
      const baseRule = {
        zoneId: null,
        baseFeeCop: 5500,
        perKmCop: 0,
        minimumFeeCop: 0,
        nightMultiplierBps: 10000,
        nightStartsMinute: 0,
        nightEndsMinute: 0,
      };
      {
        const rulesBefore = await countRows(pool, "tariff_rules");
        const auditsBefore = await countRows(pool, "audit_logs");
        await request(server())
          .post("/v1/admin/tariffs/rules")
          .set("Cookie", reviewer.cookie)
          .send({ versionId: vSuperId, ...baseRule })
          .expect(403);
        expect(await countRows(pool, "tariff_rules")).toBe(rulesBefore);
        expect(await countRows(pool, "audit_logs")).toBe(auditsBefore);
      }

      await request(server())
        .post("/v1/admin/tariffs/rules")
        .set("Cookie", superadmin.cookie)
        .send({ versionId: vSuperId, ...baseRule })
        .expect(201);
      await request(server())
        .post("/v1/admin/tariffs/rules")
        .set("Cookie", operations.cookie)
        .send({ versionId: vOpsId, ...baseRule })
        .expect(201);
      await request(server())
        .post("/v1/admin/tariffs/rules")
        .set("Cookie", security.cookie)
        .send({ versionId: vSecId, ...baseRule })
        .expect(201);

      // 1.4 POST /v1/admin/tariffs/publish
      {
        const auditsBefore = await countRows(pool, "audit_logs");
        await request(server())
          .post("/v1/admin/tariffs/publish")
          .set("Cookie", reviewer.cookie)
          .send({ versionId: vSuperId })
          .expect(403);
        const versionStatus = await pool.query<{ status: string }>(
          `SELECT status::text AS status FROM tariff_versions WHERE id = $1`,
          [vSuperId],
        );
        expect(versionStatus.rows[0]?.status).toBe("DRAFT");
        expect(await countRows(pool, "audit_logs")).toBe(auditsBefore);
      }

      await request(server())
        .post("/v1/admin/tariffs/publish")
        .set("Cookie", superadmin.cookie)
        .send({ versionId: vSuperId })
        .expect(201);
      await request(server())
        .post("/v1/admin/tariffs/publish")
        .set("Cookie", operations.cookie)
        .send({ versionId: vOpsId })
        .expect(201);
      await request(server())
        .post("/v1/admin/tariffs/publish")
        .set("Cookie", security.cookie)
        .send({ versionId: vSecId })
        .expect(201);

      // 1.5 POST /v1/admin/tariffs/quote
      const quoteBody = {
        origin: { longitude: -73.9132, latitude: 4.9655 },
        destination: { longitude: -73.92, latitude: 4.97 },
        at: "2026-11-24T15:00:00Z",
      };
      {
        const auditsBefore = await countRows(pool, "audit_logs");
        await request(server())
          .post("/v1/admin/tariffs/quote")
          .set("Cookie", reviewer.cookie)
          .send(quoteBody)
          .expect(403);
        expect(await countRows(pool, "audit_logs")).toBe(auditsBefore);
      }

      const superQuote = await request(server())
        .post("/v1/admin/tariffs/quote")
        .set("Cookie", superadmin.cookie)
        .send(quoteBody)
        .expect(201);
      expect(record(superQuote.body)["deliveryFeeCop"]).toBe(5500);
      await request(server())
        .post("/v1/admin/tariffs/quote")
        .set("Cookie", operations.cookie)
        .send(quoteBody)
        .expect(201);
      await request(server())
        .post("/v1/admin/tariffs/quote")
        .set("Cookie", security.cookie)
        .send(quoteBody)
        .expect(201);

      // 1.6 POST /v1/admin/plans
      {
        const plansBefore = await countRows(pool, "subscription_plans");
        const auditsBefore = await countRows(pool, "audit_logs");
        await request(server())
          .post("/v1/admin/plans")
          .set("Cookie", reviewer.cookie)
          .send({
            code: "PLAN_018_REV",
            name: "Plan Reviewer",
            priceCop: 50000,
            periodDays: 30,
            trialDays: 14,
            maxBranches: 2,
            maxConcurrentOrders: 5,
          })
          .expect(403);
        expect(await countRows(pool, "subscription_plans")).toBe(plansBefore);
        expect(await countRows(pool, "audit_logs")).toBe(auditsBefore);
      }

      const planSuperRes = await request(server())
        .post("/v1/admin/plans")
        .set("Cookie", superadmin.cookie)
        .send({
          code: "PLAN_018_SUPER",
          name: "Plan Super 018",
          priceCop: 50000,
          periodDays: 30,
          trialDays: 14,
          maxBranches: 2,
          maxConcurrentOrders: 5,
        })
        .expect(201);
      const planSuperId = String(record(planSuperRes.body)["id"]);

      const planOpsRes = await request(server())
        .post("/v1/admin/plans")
        .set("Cookie", operations.cookie)
        .send({
          code: "PLAN_018_OPS",
          name: "Plan Ops 018",
          priceCop: 55000,
          periodDays: 30,
          trialDays: 14,
          maxBranches: 2,
          maxConcurrentOrders: 5,
        })
        .expect(201);
      const planOpsId = String(record(planOpsRes.body)["id"]);

      const planSecRes = await request(server())
        .post("/v1/admin/plans")
        .set("Cookie", security.cookie)
        .send({
          code: "PLAN_018_SEC",
          name: "Plan Sec 018",
          priceCop: 60000,
          periodDays: 30,
          trialDays: 14,
          maxBranches: 2,
          maxConcurrentOrders: 5,
        })
        .expect(201);
      const planSecId = String(record(planSecRes.body)["id"]);

      // 1.7 POST /v1/admin/subscriptions
      {
        const subsBefore = await countRows(pool, "restaurant_subscriptions");
        const auditsBefore = await countRows(pool, "audit_logs");
        await request(server())
          .post("/v1/admin/subscriptions")
          .set("Cookie", reviewer.cookie)
          .send({ restaurantId: restSuper.restaurantId, planId: planSuperId, status: "ACTIVE" })
          .expect(403);
        expect(await countRows(pool, "restaurant_subscriptions")).toBe(subsBefore);
        expect(await countRows(pool, "audit_logs")).toBe(auditsBefore);
      }

      await request(server())
        .post("/v1/admin/subscriptions")
        .set("Cookie", superadmin.cookie)
        .send({ restaurantId: restSuper.restaurantId, planId: planSuperId, status: "ACTIVE" })
        .expect(201);
      await request(server())
        .post("/v1/admin/subscriptions")
        .set("Cookie", operations.cookie)
        .send({ restaurantId: restOps.restaurantId, planId: planOpsId, status: "ACTIVE" })
        .expect(201);
      await request(server())
        .post("/v1/admin/subscriptions")
        .set("Cookie", security.cookie)
        .send({ restaurantId: restSec.restaurantId, planId: planSecId, status: "ACTIVE" })
        .expect(201);

      // 1.8 POST /v1/admin/subscriptions/advance
      {
        const auditsBefore = await countRows(pool, "audit_logs");
        await request(server())
          .post("/v1/admin/subscriptions/advance")
          .set("Cookie", reviewer.cookie)
          .expect(403);
        expect(await countRows(pool, "audit_logs")).toBe(auditsBefore);
      }

      await request(server())
        .post("/v1/admin/subscriptions/advance")
        .set("Cookie", superadmin.cookie)
        .expect(201);
      await request(server())
        .post("/v1/admin/subscriptions/advance")
        .set("Cookie", operations.cookie)
        .expect(201);
      await request(server())
        .post("/v1/admin/subscriptions/advance")
        .set("Cookie", security.cookie)
        .expect(201);

      // 1.9 POST /v1/admin/restaurants/:id/activate
      {
        const auditsBefore = await countRows(pool, "audit_logs");
        await request(server())
          .post(`/v1/admin/restaurants/${restSuper.restaurantId}/activate`)
          .set("Cookie", reviewer.cookie)
          .expect(403);
        const restRow = await pool.query<{ status: string }>(
          `SELECT status::text AS status FROM restaurants WHERE id = $1`,
          [restSuper.restaurantId],
        );
        expect(restRow.rows[0]?.status).toBe("PENDING_REVIEW");
        expect(await countRows(pool, "audit_logs")).toBe(auditsBefore);
      }

      const actSuper = await request(server())
        .post(`/v1/admin/restaurants/${restSuper.restaurantId}/activate`)
        .set("Cookie", superadmin.cookie)
        .expect(201);
      expect(record(actSuper.body)["status"]).toBe("ACTIVE");

      const actOps = await request(server())
        .post(`/v1/admin/restaurants/${restOps.restaurantId}/activate`)
        .set("Cookie", operations.cookie)
        .expect(201);
      expect(record(actOps.body)["status"]).toBe("ACTIVE");

      const actSec = await request(server())
        .post(`/v1/admin/restaurants/${restSec.restaurantId}/activate`)
        .set("Cookie", security.cookie)
        .expect(201);
      expect(record(actSec.body)["status"]).toBe("ACTIVE");

      // 1.10 POST /v1/legal-documents
      {
        const docsBefore = await countRows(pool, "legal_documents");
        const auditsBefore = await countRows(pool, "audit_logs");
        await request(server())
          .post("/v1/legal-documents")
          .set("Cookie", reviewer.cookie)
          .send({
            kind: "DOCUMENT_PROCESSING",
            version: "2026-018-rev-blocked",
            content: "Contenido bloqueado para REVIEWER",
          })
          .expect(403);
        expect(await countRows(pool, "legal_documents")).toBe(docsBefore);
        expect(await countRows(pool, "audit_logs")).toBe(auditsBefore);
      }

      const docSuper = await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", superadmin.cookie)
        .send({
          kind: "DOCUMENT_PROCESSING",
          version: "2026-018-super",
          content: "Documento legal superadmin 018",
        })
        .expect(201);
      const docLegalId = String(record(docSuper.body)["id"]);

      await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", operations.cookie)
        .send({
          kind: "TERMS",
          version: "2026-018-ops",
          content: "Términos operations 018",
        })
        .expect(201);
      await request(server())
        .post("/v1/legal-documents")
        .set("Cookie", security.cookie)
        .send({
          kind: "PRIVACY_NOTICE",
          version: "2026-018-sec",
          content: "Privacidad security 018",
        })
        .expect(201);

      // =========================================================================
      // 2) Endpoints del flujo de revisión donde REVIEWER conserva acceso
      // =========================================================================

      const meReviewer = await request(server())
        .get("/v1/admin/me")
        .set("Cookie", reviewer.cookie)
        .expect(200);
      expect(meReviewer.body).toEqual({ role: "REVIEWER" });

      // Domiciliario envía caso de verificación
      const courierReg = await request(server())
        .post("/v1/auth/register")
        .send({
          email: "courier-018@example.invalid",
          password,
          client: "MOBILE",
          consents: { termsAccepted: true, privacyAccepted: true },
        })
        .expect(201);
      const courierToken = String(record(courierReg.body)["token"]);

      await request(server())
        .post("/v1/consents")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ legalDocumentId: docLegalId, purpose: "DOCUMENT_STORAGE", channel: "MOBILE" })
        .expect(201);

      const courierCreated = await request(server())
        .post("/v1/couriers")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({
          documentType: "CC",
          documentNumber: "9000180001",
          firstName: "Camilo",
          lastName: "Prueba",
        })
        .expect(201);
      const courierId = String(record(courierCreated.body)["id"]);

      for (const type of documentTypes) {
        await request(server())
          .post("/v1/couriers/me/documents")
          .set("Authorization", `Bearer ${courierToken}`)
          .field("type", type)
          .attach("file", pdf, { filename: "sintetico.pdf", contentType: "application/pdf" })
          .expect(201);
      }
      await request(server())
        .post("/v1/couriers/me/vehicle")
        .set("Authorization", `Bearer ${courierToken}`)
        .send({ plate: "D018A1", soatExpiresOn: "2028-04-01", techExpiresOn: "2028-08-01" })
        .expect(201);
      const vCaseRes = await request(server())
        .post("/v1/couriers/me/verification-cases")
        .set("Authorization", `Bearer ${courierToken}`)
        .expect(201);
      const caseId = String(record(vCaseRes.body)["id"]);

      const casesList = await request(server())
        .get("/v1/admin/verification-cases")
        .set("Cookie", reviewer.cookie)
        .expect(200);
      const listedIds = (casesList.body as unknown[]).map((row) => String(record(row)["id"]));
      expect(listedIds).toContain(caseId);

      const decisionRes = await request(server())
        .post(`/v1/admin/verification-cases/${caseId}/decision`)
        .set("Cookie", reviewer.cookie)
        .send({ outcome: "APPROVED", reasonCode: "DOCS_VERIFIED", comment: "Revisado 018" })
        .expect(201);
      expect(decisionRes.body).toEqual({ decided: true });

      // Declaración de pago manual -> REVIEWER reconoce en acknowledge
      const declRes = await request(server())
        .post(`/v1/restaurants/${restSuper.restaurantId}/subscription/declarations`)
        .set("Cookie", ownerCookie)
        .send({ amountCop: 50000, method: "NEQUI", reference: "REF-018" })
        .expect(201);
      const declId = String(record(declRes.body)["id"]);

      const ackRes = await request(server())
        .post(`/v1/admin/declarations/${declId}/acknowledge`)
        .set("Cookie", reviewer.cookie)
        .send({ note: "Comprobante verificado por reviewer 018" })
        .expect(201);
      expect(ackRes.body).toEqual({ acknowledged: true });

      // =========================================================================
      // 3) Endpoints que ya excluyen a REVIEWER (códigos actuales sin cambio)
      // =========================================================================

      // PATCH /v1/admin/profiles/:userId -> 404
      await request(server())
        .patch(`/v1/admin/profiles/${operations.userId}`)
        .set("Cookie", reviewer.cookie)
        .send({ role: "SECURITY" })
        .expect(404);

      // POST /v1/admin/policies y /v1/admin/policies/publish -> 404
      const policyDraftPayload = {
        name: "Politica 018",
        offerRadiusMeters: 3000,
        directOfferTtlSeconds: 120,
        openOfferTtlSeconds: 120,
        seekingTtlSeconds: 600,
        maxOffersPerWave: 4,
        locationFreshnessSeconds: 120,
      };
      await request(server())
        .post("/v1/admin/policies")
        .set("Cookie", reviewer.cookie)
        .send(policyDraftPayload)
        .expect(404);

      const policyCreated = await request(server())
        .post("/v1/admin/policies")
        .set("Cookie", superadmin.cookie)
        .send(policyDraftPayload)
        .expect(201);
      const policyId = String(record(policyCreated.body)["id"]);

      await request(server())
        .post("/v1/admin/policies/publish")
        .set("Cookie", reviewer.cookie)
        .send({ id: policyId })
        .expect(404);

      // POST /v1/admin/couriers/:id/suspend|reinstate y /v1/admin/restaurants/:id/suspend|reinstate -> 403
      await request(server())
        .post(`/v1/admin/couriers/${courierId}/suspend`)
        .set("Cookie", reviewer.cookie)
        .send({ reason: "Intento reviewer" })
        .expect(403);
      await request(server())
        .post(`/v1/admin/couriers/${courierId}/reinstate`)
        .set("Cookie", reviewer.cookie)
        .send({ reason: "Intento reviewer" })
        .expect(403);
      await request(server())
        .post(`/v1/admin/restaurants/${restSuper.restaurantId}/suspend`)
        .set("Cookie", reviewer.cookie)
        .send({ reason: "Intento reviewer" })
        .expect(403);
      await request(server())
        .post(`/v1/admin/restaurants/${restSuper.restaurantId}/reinstate`)
        .set("Cookie", reviewer.cookie)
        .send({ reason: "Intento reviewer" })
        .expect(403);

      // GET /v1/admin/stats -> 403
      await request(server()).get("/v1/admin/stats").set("Cookie", reviewer.cookie).expect(403);

      // Crear pedido e incidente para probar POST /v1/incidents/:id/status (403) y POST /v1/orders/:id/cancel (404)
      const draftOrder = await request(server())
        .post("/v1/orders")
        .set("Cookie", ownerCookie)
        .send({
          branchId: restSuper.branchId,
          foodAmountCop: 25000,
          deliveryFeeCop: 5500,
          paymentMethod: "CASH",
        })
        .expect(201);
      const orderId = String(record(draftOrder.body)["id"]);

      const incidentRes = await request(server())
        .post("/v1/incidents")
        .set("Cookie", ownerCookie)
        .send({
          orderId,
          type: "OTHER",
          severity: "MEDIUM",
          summary: "Incidente de prueba 018",
        })
        .expect(201);
      const incidentId = String(record(incidentRes.body)["id"]);

      await request(server())
        .post(`/v1/incidents/${incidentId}/status`)
        .set("Cookie", reviewer.cookie)
        .send({ status: "INVESTIGATING", reason: "Intento reviewer" })
        .expect(403);

      await request(server())
        .post(`/v1/orders/${orderId}/cancel`)
        .set("Cookie", reviewer.cookie)
        .send({ reason: "Intento cancelación reviewer" })
        .expect(404);

      // POST /v1/data-subject-requests/:id/process -> 403
      const dsrRes = await request(server())
        .post("/v1/data-subject-requests")
        .set("Cookie", ownerCookie)
        .send({ type: "DELETION", note: "Solicitud prueba 018" })
        .expect(201);
      const dsrId = String(record(dsrRes.body)["id"]);

      await request(server())
        .post(`/v1/data-subject-requests/${dsrId}/process`)
        .set("Cookie", reviewer.cookie)
        .send({ action: "COMPLETE" })
        .expect(403);
    } finally {
      await pool.end();
    }
  });
});
