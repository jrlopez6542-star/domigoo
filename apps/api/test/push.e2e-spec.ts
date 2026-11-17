import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, readEnv, type AppEnv } from "../src/config/env.js";
import { applyHttpSecurity } from "../src/http.js";
import { resetLoginThrottle } from "../src/identity/login-throttle.js";
import { OutboxRepository } from "../src/notifications/outbox.repository.js";
import {
  createPushSenderFromEnv,
  PUSH_SENDER,
  RecordingPushSender,
} from "../src/notifications/push-sender.port.js";
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

describe("puerto de push y bandeja de salida (M28)", () => {
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

  it("no instancia FcmPushSender sin credencial, registra token Android, drena sin PII/PIN y marca FAILED tras 5 fallos", async () => {
    expect(createPushSenderFromEnv({})).toBeInstanceOf(RecordingPushSender);

    const courierRes = await request(server())
      .post("/v1/auth/register")
      .send({ email: "courier-m28@example.invalid", password, client: "MOBILE" })
      .expect(201);
    const courierToken = String(record(courierRes.body)["token"]);

    const regPush = await request(server())
      .post("/v1/devices/push-token")
      .set("Authorization", `Bearer ${courierToken}`)
      .send({ token: "fcm-android-token-sintetico-1234567890" })
      .expect(201);
    expect(record(regPush.body)["platform"]).toBe("ANDROID");

    const db = new Pool({ connectionString: databaseUrl });
    try {
      const userRow = await db.query<{ id: string }>(
        `SELECT id FROM users WHERE email = 'courier-m28@example.invalid'`,
      );
      const userId = String(userRow.rows[0]?.id);

      const outbox = currentApp?.get(OutboxRepository);
      const sender = currentApp?.get<RecordingPushSender>(PUSH_SENDER);
      if (outbox === undefined || sender === undefined) {
        throw new Error("Proveedores de notificaciones no resueltos");
      }
      sender.clear();

      // 1. Encolar plantilla OFFER_NEW sin PII ni PIN y drenar
      await outbox.enqueue(userId, {
        template: "OFFER_NEW",
        payload: {
          offerId: "11111111-1111-1111-1111-111111111111",
          orderId: "22222222-2222-2222-2222-222222222222",
          deliveryFeeCop: 6500,
        },
      });

      const drained = await outbox.drain();
      expect(drained.sent).toBe(1);
      expect(sender.sent).toHaveLength(1);
      expect(sender.sent[0]?.template).toBe("OFFER_NEW");
      expect(JSON.stringify(sender.sent[0]?.payload)).not.toContain("phone");
      expect(JSON.stringify(sender.sent[0]?.payload)).not.toContain("pin");

      // 2. Cinco fallos consecutivos pasan la fila a FAILED
      await outbox.enqueue(userId, {
        template: "ORDER_CANCELLED",
        payload: {
          orderId: "22222222-2222-2222-2222-222222222222",
          status: "CANCELLED_RESTAURANT",
          reason: "Agotado",
        },
      });

      sender.failNext(5);
      for (let i = 0; i < 4; i += 1) {
        const res = await outbox.drain();
        expect(res.failed).toBe(0);
      }
      const fifth = await outbox.drain();
      expect(fifth.failed).toBe(1);

      const failedRow = await db.query<{ status: string; attemptCount: number }>(
        `SELECT status::text AS status, "attemptCount"
         FROM notification_outbox
         WHERE "userId" = $1 AND template = 'ORDER_CANCELLED'`,
        [userId],
      );
      expect(failedRow.rows[0]?.status).toBe("FAILED");
      expect(failedRow.rows[0]?.attemptCount).toBe(5);
    } finally {
      await db.end();
    }
  });
});
