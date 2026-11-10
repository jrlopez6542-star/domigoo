import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
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

describe("borrador del pedido", () => {
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

  it("guarda la comida y el domicilio como montos distintos", async () => {
    const owner = await request(server())
      .post("/v1/auth/register")
      .send({ email: "dueno-pedido@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const stranger = await request(server())
      .post("/v1/auth/register")
      .send({ email: "ajeno-pedido@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const ownerToken = String(record(owner.body)["token"]);
    const site = await request(server())
      .post("/v1/restaurants")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        legalName: "Razon pedido",
        tradeName: "Local pedido",
        nit: "900000210",
        email: "local-pedido@example.invalid",
        phoneE164: "+573001110210",
        establishmentName: "Establecimiento",
        branchName: "Principal",
        addressLine: "Calle sintetica",
        longitude: -73.9132,
        latitude: 4.9655,
      })
      .expect(201);
    const created = await request(server())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId: record(site.body)["branchId"],
        foodAmountCop: 18000,
        deliveryFeeCop: 5500,
        paymentMethod: "CASH",
      })
      .expect(201);
    const body = record(created.body);
    expect(body["status"]).toBe("DRAFT");
    expect(body["foodAmountCop"]).toBe(18000);
    expect(body["deliveryFeeCop"]).toBe(5500);
    expect(body["foodAmountCop"]).not.toBe(body["deliveryFeeCop"]);

    const read = await request(server())
      .get(`/v1/orders/${String(body["id"])}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(record(read.body)["foodAmountCop"]).toBe(18000);
    expect(record(read.body)["deliveryFeeCop"]).toBe(5500);

    await request(server())
      .get(`/v1/orders/${String(body["id"])}`)
      .set("Authorization", `Bearer ${String(record(stranger.body)["token"])}`)
      .expect(404);
  });
});
