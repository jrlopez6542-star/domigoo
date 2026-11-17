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

async function registerCourier(email: string, _plate: string, docNum: string): Promise<string> {
  const reg = await request(server())
    .post("/v1/auth/register")
    .send({ email, password, client: "MOBILE" })
    .expect(201);
  const token = String(record(reg.body)["token"]);

  const db = new Pool({ connectionString: databaseUrl });
  try {
    await db.query(
      `INSERT INTO couriers (
         id, "userId", "documentType", "documentNumber", "firstName", "lastName",
         status, "registrationSource", "createdAt", "updatedAt"
       )
       SELECT gen_random_uuid(), id, 'CC', $2, 'Domiciliario', 'Recorrido',
              'APPROVED', 'OPEN', now(), now()
       FROM users WHERE email = $1`,
      [email, docNum],
    );
  } finally {
    await db.end();
  }

  return token;
}

describe("recorrido del pedido (M24)", () => {
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

  it("avanza el recorrido, registra order_events, oculta foodAmountCop al domiciliario y responde 403 a no asignado", async () => {
    const ownerRes = await request(server())
      .post("/v1/auth/register")
      .send({ email: "owner-m24@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const ownerToken = String(record(ownerRes.body)["token"]);

    const site = await request(server())
      .post("/v1/restaurants")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        legalName: "Razon M24",
        tradeName: "Local M24",
        nit: "900000240",
        email: "local-m24@example.invalid",
        phoneE164: "+573001110240",
        establishmentName: "Establecimiento M24",
        branchName: "Principal",
        addressLine: "Calle M24",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(201);

    const draft = await request(server())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId: record(site.body)["branchId"],
        foodAmountCop: 32000,
        deliveryFeeCop: 6500,
        paymentMethod: "CASH",
      })
      .expect(201);
    const orderId = String(record(draft.body)["id"]);

    const assignedToken = await registerCourier(
      "courier1-m24@example.invalid",
      "M24A01",
      "80024001",
    );
    const otherToken = await registerCourier("courier2-m24@example.invalid", "M24B02", "80024002");

    // Preparar orden en ACCEPTED asignada al domiciliario 1
    const db = new Pool({ connectionString: databaseUrl });
    const c1 = await db.query<{ id: string }>(
      `SELECT c.id FROM couriers c JOIN users u ON u.id = c."userId" WHERE u.email = 'courier1-m24@example.invalid'`,
    );
    const courier1Id = String(c1.rows[0]?.id);

    await db.query(
      `UPDATE orders
       SET status = 'ACCEPTED',
           "assignedCourierId" = $2,
           "customerName" = 'Cliente M24',
           "customerPhoneE164" = '+573009991122',
           "dropoffAddress" = 'Carrera 7 # 10-20',
           "acceptedAt" = now()
       WHERE id = $1`,
      [orderId, courier1Id],
    );
    await db.query(
      `INSERT INTO order_events (id, "orderId", "fromStatus", "toStatus", "actorKind", "actorId", "createdAt")
       VALUES (gen_random_uuid(), $1, 'SEEKING_COURIER', 'ACCEPTED', 'COURIER', (SELECT "userId" FROM couriers WHERE id = $2), now())`,
      [orderId, courier1Id],
    );
    await db.end();

    // 1. Un domiciliario no asignado recibe 403 al leer o intentar transicionar
    await request(server())
      .get(`/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(403);
    await request(server())
      .post(`/v1/orders/${orderId}/arrive-pickup`)
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(403);

    // 2. El domiciliario asignado lee el pedido: NO trae foodAmountCop, SÍ trae customerPhone
    const courierRead = await request(server())
      .get(`/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${assignedToken}`)
      .expect(200);
    const courierBody = record(courierRead.body);
    expect("foodAmountCop" in courierBody).toBe(false);
    expect(courierBody["deliveryFeeCop"]).toBe(6500);
    expect(courierBody["customerPhone"]).toBe("+573009991122");

    // 3. Salto inválido (ACCEPTED -> AT_PICKUP directo) responde 422
    await request(server())
      .post(`/v1/orders/${orderId}/at-pickup`)
      .set("Authorization", `Bearer ${assignedToken}`)
      .expect(422);

    // 4. Transiciones válidas del recorrido: arrive-pickup -> at-pickup
    const step1 = await request(server())
      .post(`/v1/orders/${orderId}/arrive-pickup`)
      .set("Authorization", `Bearer ${assignedToken}`)
      .expect(201);
    expect(record(step1.body)["fromStatus"]).toBe("ACCEPTED");
    expect(record(step1.body)["toStatus"]).toBe("ARRIVING_PICKUP");

    const step2 = await request(server())
      .post(`/v1/orders/${orderId}/at-pickup`)
      .set("Authorization", `Bearer ${assignedToken}`)
      .expect(201);
    expect(record(step2.body)["fromStatus"]).toBe("ARRIVING_PICKUP");
    expect(record(step2.body)["toStatus"]).toBe("AT_PICKUP");

    // 5. El historial del restaurante muestra la secuencia completa de eventos
    const restRead = await request(server())
      .get(`/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    const restBody = record(restRead.body);
    expect(restBody["foodAmountCop"]).toBe(32000);
    const events = restBody["events"] as Array<Record<string, unknown>>;
    expect(events.map((e) => [e["fromStatus"], e["toStatus"]])).toEqual([
      ["SEEKING_COURIER", "ACCEPTED"],
      ["ACCEPTED", "ARRIVING_PICKUP"],
      ["ARRIVING_PICKUP", "AT_PICKUP"],
    ]);

    const eventsRead = await request(server())
      .get(`/v1/orders/${orderId}/events`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(record(eventsRead.body)["events"]).toHaveLength(3);
  });
});
