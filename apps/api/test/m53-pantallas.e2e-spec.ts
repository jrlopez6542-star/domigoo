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

const FORBIDDEN_TRACKING_KEY_PATTERN = /(amount|price|total|fee|cop|phone|email|address|nit)/i;
const FORBIDDEN_TRACKING_VALUES = [
  "32000",
  "6500",
  "+573004445566",
  "+573001112233",
  "Vereda Verganzo",
  "ejemplo.com",
  "80053001",
];

function assertNoSensitiveTrackingData(payload: unknown): void {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (typeof node === "object" && node !== null) {
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        if (FORBIDDEN_TRACKING_KEY_PATTERN.test(key)) {
          throw new Error(`Clave no permitida en tracking público: ${key}`);
        }
        visit(val);
      }
    }
  };
  visit(payload);
  const serialized = JSON.stringify(payload);
  for (const forbidden of FORBIDDEN_TRACKING_VALUES) {
    if (serialized.includes(forbidden)) {
      throw new Error(`Dato sensible expuesto en tracking público: ${forbidden}`);
    }
  }
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

describe("M53 pantallas v2: directorio público, recepción, ofertas con distancia/ETA, ganancias y admin stats", () => {
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

  it("expone directorio público sin PII, permite recepción/conteo de domiciliarios, ofrece distancia/ETA, tracking sin cuenta + claim opcional, ganancias informativas y stats Tocancipá sin PII", async () => {
    // 1. Registrar restaurante, domiciliario, cliente y admin
    const ownerRes = await request(server())
      .post("/v1/auth/register")
      .send({
        email: "restaurante-m53@ejemplo.com",
        password,
        client: "MOBILE",
        consents: { termsAccepted: true, privacyAccepted: true },
      })
      .expect(201);
    const ownerToken = String(record(ownerRes.body)["token"]);

    const courierRes = await request(server())
      .post("/v1/auth/register")
      .send({
        email: "domiciliario-m53@ejemplo.com",
        password,
        client: "MOBILE",
        consents: { termsAccepted: true, privacyAccepted: true },
      })
      .expect(201);
    const courierToken = String(record(courierRes.body)["token"]);

    const clientRes = await request(server())
      .post("/v1/auth/register")
      .send({
        email: "cliente-m53@ejemplo.com",
        password,
        client: "MOBILE",
        consents: { termsAccepted: true, privacyAccepted: true },
      })
      .expect(201);
    const clientToken = String(record(clientRes.body)["token"]);

    const adminRes = await request(server())
      .post("/v1/auth/register")
      .send({
        email: "admin-m53@ejemplo.com",
        password,
        client: "MOBILE",
        consents: { termsAccepted: true, privacyAccepted: true },
      })
      .expect(201);
    const adminToken = String(record(adminRes.body)["token"]);

    // Promover admin y aprobar domiciliario en BD
    const db = new Pool({ connectionString: databaseUrl });
    try {
      await db.query(
        `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
         SELECT id, 'Operaciones M53', 'OPERATIONS', now(), now()
         FROM users WHERE email = 'admin-m53@ejemplo.com'`,
      );
      await db.query(
        `INSERT INTO couriers (
           id, "userId", "documentType", "documentNumber", "firstName", "lastName",
           status, "registrationSource", "createdAt", "updatedAt"
         )
         SELECT gen_random_uuid(), id, 'CC', '80053001', 'Andrés', 'Domicilios',
                'APPROVED', 'OPEN', now(), now()
         FROM users WHERE email = 'domiciliario-m53@ejemplo.com'`,
      );
    } finally {
      await db.end();
    }

    // 2. Crear restaurante y sucursal en Tocancipá, configurar horario 24h todos los días y activar
    const restRes = await request(server())
      .post("/v1/restaurants")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        legalName: "Asados Tocancipá S.A.S.",
        tradeName: "Brasas Tocancipá",
        nit: "900530001-7",
        email: "privado-nit@ejemplo.com",
        phoneE164: "+573001112233",
        establishmentName: "Brasas Central",
        branchName: "Sede Parque",
        addressLine: "Cra 7 # 10-20, Tocancipá",
        longitude: -73.9125,
        latitude: 4.9652,
      })
      .expect(201);
    const restaurantId = String(record(restRes.body)["id"]);
    const branchId = String(record(restRes.body)["branchId"]);

    await request(server())
      .post("/v1/restaurants/not-a-uuid/submit")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({})
      .expect(400);

    const slots = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      opensMinute: 0,
      closesMinute: 1439,
      closed: false,
    }));
    await request(server())
      .put(`/v1/branches/${branchId}/hours`)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({ slots })
      .expect(200);

    await request(server())
      .post(`/v1/branches/${branchId}/activate`)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({})
      .expect(201);

    await request(server())
      .post(`/v1/restaurants/${restaurantId}/submit`)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({})
      .expect(201);

    await request(server())
      .post(`/v1/admin/restaurants/${restaurantId}/activate`)
      .set("authorization", `Bearer ${adminToken}`)
      .send({})
      .expect(201);

    // 3. Actualizar recepción y teléfono público
    const recRes = await request(server())
      .patch(`/v1/branches/${branchId}/reception`)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({ acceptingOrders: true, publicPhone: "+573009998877" })
      .expect(200);
    expect(record(recRes.body)["acceptingOrders"]).toBe(true);
    expect(record(recRes.body)["publicPhone"]).toBe("+573009998877");

    // 4. Directorio público GET /v1/public/restaurants (sin NIT, email ni legalName)
    const pubListRes = await request(server()).get("/v1/public/restaurants").expect(200);
    const pubJson = JSON.stringify(pubListRes.body);
    expect(pubJson).toContain("Brasas Tocancipá");
    expect(pubJson).not.toContain("900530001-7");
    expect(pubJson).not.toContain("privado-nit@ejemplo.com");
    expect(pubJson).not.toContain("Asados Tocancipá S.A.S.");

    const pubSearchRes = await request(server()).get("/v1/public/restaurants?q=Brasas").expect(200);
    const items = record(pubSearchRes.body)["restaurants"] as Array<Record<string, unknown>>;
    expect(items.length).toBe(1);
    expect(items[0]?.["isOpen"]).toBe(true);

    // 5. Domiciliario disponible + ubicación con consentimiento
    await request(server())
      .post("/v1/couriers/me/availability")
      .set("authorization", `Bearer ${courierToken}`)
      .send({ state: "AVAILABLE" })
      .expect(201);

    await request(server())
      .post("/v1/consents")
      .set("authorization", `Bearer ${courierToken}`)
      .send({ purpose: "GEOLOCATION_CONSENT", granted: true })
      .expect(201);

    await request(server())
      .post("/v1/couriers/me/location")
      .set("authorization", `Bearer ${courierToken}`)
      .send({ longitude: -73.913, latitude: 4.966 })
      .expect(201);

    // Conteo de domiciliarios cercanos (solo número, sin PII)
    const nearbyRes = await request(server())
      .get(`/v1/branches/${branchId}/nearby-couriers-count`)
      .set("authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(record(nearbyRes.body)["count"]).toBe(1);

    // 6. Restaurante crea y publica solicitud de domicilio
    const orderRes = await request(server())
      .post("/v1/orders")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        branchId,
        foodAmountCop: 32000,
        deliveryFeeCop: 6500,
        paymentMethod: "CASH",
      })
      .expect(201);
    const orderId = String(record(orderRes.body)["id"]);

    await request(server())
      .post(`/v1/orders/${orderId}/publish`)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        mode: "OPEN",
        customerName: "Laura Tocancipá",
        customerPhone: "+573004445566",
        dropoffAddress: "Vereda Verganzo Km 2",
        longitude: -73.918,
        latitude: 4.9701,
      })
      .expect(201);

    // 7. Ofertas disponibles incluyen distanceKm y etaMinutes
    const offersRes = await request(server())
      .get("/v1/offers/available")
      .set("authorization", `Bearer ${courierToken}`)
      .expect(200);
    const offers = record(offersRes.body)["offers"] as Array<Record<string, unknown>>;
    expect(offers.length).toBe(1);
    expect(typeof offers[0]?.["distanceKm"]).toBe("number");
    expect(typeof offers[0]?.["etaMinutes"]).toBe("number");
    const offerId = String(offers[0]?.["offerId"]);

    await request(server())
      .post(`/v1/offers/${offerId}/accept`)
      .set("authorization", `Bearer ${courierToken}`)
      .set("idempotency-key", `m53-accept-${offerId}`)
      .send({})
      .expect(201);

    // 8. Enlace de seguimiento público sin cuenta + guardar en cuenta opcional
    const trackLinkRes = await request(server())
      .post(`/v1/orders/${orderId}/tracking-link`)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({})
      .expect(201);
    const trackingToken = String(record(trackLinkRes.body)["token"]);

    const trackViewRes = await request(server()).get(`/v1/tracking/${trackingToken}`).expect(200);
    expect(record(trackViewRes.body)["courierLocation"]).not.toBeNull();

    // Guardar solicitud en cuenta opcional del cliente
    await request(server())
      .post(`/v1/tracking/${trackingToken}/claim`)
      .set("authorization", `Bearer ${clientToken}`)
      .send({})
      .expect(201);

    const clientOrdersRes = await request(server())
      .get("/v1/client/orders")
      .set("authorization", `Bearer ${clientToken}`)
      .expect(200);
    const clientOrders = record(clientOrdersRes.body)["orders"] as Array<Record<string, unknown>>;
    expect(clientOrders.length).toBe(1);
    expect(clientOrders[0]?.["id"]).toBe(orderId);
    expect("foodAmountCop" in (clientOrders[0] ?? {})).toBe(false);

    // 9. Ganancias informativas antes y después de entregar
    const earningsBefore = await request(server())
      .get("/v1/couriers/me/earnings")
      .set("authorization", `Bearer ${courierToken}`)
      .expect(200);
    expect(record(earningsBefore.body)["deliveredCount"]).toBe(0);
    expect(record(earningsBefore.body)["totalDeliveryFeeCop"]).toBe(0);

    // Completar recorrido con PINs reales
    const orderDetailRes = await request(server())
      .get(`/v1/orders/${orderId}`)
      .set("authorization", `Bearer ${ownerToken}`)
      .expect(200);
    const pickupPin = String(record(orderDetailRes.body)["pickupPin"]);
    const linkDetailRes = await request(server()).get(`/v1/tracking/${trackingToken}`).expect(200);
    expect(pickupPin.length).toBeGreaterThanOrEqual(4);
    expect(record(linkDetailRes.body)["status"]).toBe("ACCEPTED");
    assertNoSensitiveTrackingData(linkDetailRes.body);

    await request(server())
      .post(`/v1/orders/${orderId}/arrive-pickup`)
      .set("authorization", `Bearer ${courierToken}`)
      .send({})
      .expect(201);
    await request(server())
      .post(`/v1/orders/${orderId}/at-pickup`)
      .set("authorization", `Bearer ${courierToken}`)
      .send({})
      .expect(201);
    await request(server())
      .post(`/v1/orders/${orderId}/pickup-pin`)
      .set("authorization", `Bearer ${courierToken}`)
      .send({ pin: pickupPin })
      .expect(201);

    const pickedUpTrackRes = await request(server())
      .get(`/v1/tracking/${trackingToken}`)
      .expect(200);
    const deliveryPin = String(record(pickedUpTrackRes.body)["deliveryPin"]);
    assertNoSensitiveTrackingData(pickedUpTrackRes.body);

    await request(server())
      .post(`/v1/orders/${orderId}/at-dropoff`)
      .set("authorization", `Bearer ${courierToken}`)
      .send({})
      .expect(201);
    await request(server())
      .post(`/v1/orders/${orderId}/delivery-pin`)
      .set("authorization", `Bearer ${courierToken}`)
      .send({ pin: deliveryPin })
      .expect(201);

    // Al entregar, ubicación del domiciliario deja de exponerse en tracking
    const deliveredTrackRes = await request(server())
      .get(`/v1/tracking/${trackingToken}`)
      .expect(200);
    expect(record(deliveredTrackRes.body)["status"]).toBe("DELIVERED");
    expect(record(deliveredTrackRes.body)["courierLocation"]).toBeNull();
    assertNoSensitiveTrackingData(deliveredTrackRes.body);

    // Ganancias informativas reflejan el domicilio entregado
    const earningsAfter = await request(server())
      .get("/v1/couriers/me/earnings")
      .set("authorization", `Bearer ${courierToken}`)
      .expect(200);
    expect(record(earningsAfter.body)["deliveredCount"]).toBe(1);
    expect(record(earningsAfter.body)["totalDeliveryFeeCop"]).toBe(6500);
    expect(String(record(earningsAfter.body)["note"])).toContain("DOMIGOO no recauda");

    // 10. Admin stats Tocancipá sin PII
    const statsRes = await request(server())
      .get("/v1/admin/stats")
      .set("authorization", `Bearer ${adminToken}`)
      .expect(200);
    const stats = record(statsRes.body);
    expect(stats["activeRestaurants"]).toBe(1);
    expect(stats["registeredCouriers"]).toBe(1);
    expect(stats["ordersCompletedToday"]).toBe(1);
    const statsJson = JSON.stringify(stats);
    expect(statsJson).not.toContain("ejemplo.com");
    expect(statsJson).not.toContain("+57");
  });
});
