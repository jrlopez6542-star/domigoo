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

const databaseUrl =
  process.env["DATABASE_URL"] ?? "postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo";
const password = "clave-de-prueba-12";

type HttpServer = Parameters<typeof request>[0];

function httpServer(app: INestApplication): HttpServer {
  return app.getHttpServer() as HttpServer;
}

let currentApp: INestApplication | undefined;

function server(): HttpServer {
  if (currentApp === undefined) {
    throw new Error("La aplicación no arrancó");
  }
  return httpServer(currentApp);
}

async function createApp(env: AppEnv): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_ENV)
    .useValue(env)
    .compile();
  const app = moduleRef.createNestApplication();
  applyHttpSecurity(app);
  setupOpenApi(app, env.appName);
  await app.init();
  return app;
}

async function clearAccounts(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`DELETE FROM sessions`);
    await pool.query(`DELETE FROM users`);
  } finally {
    await pool.end();
  }
}

async function storedSecrets(
  userId: string,
): Promise<{ passwordHash: string | null; tokenHash: string | null }> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query<{ passwordHash: string | null; tokenHash: string | null }>(
      `SELECT u."passwordHash", s."tokenHash"
       FROM users u
       LEFT JOIN sessions s ON s."userId" = u.id
       WHERE u.id = $1
       LIMIT 1`,
      [userId],
    );
    return result.rows[0] ?? { passwordHash: null, tokenHash: null };
  } finally {
    await pool.end();
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("La respuesta no es un objeto");
  }
  return value as Record<string, unknown>;
}

describe("cuenta y sesión", () => {
  beforeAll(() => {
    migrateDatabase(databaseUrl);
  });

  beforeEach(async () => {
    resetLoginThrottle();
    await clearAccounts();
    currentApp = await createApp(readEnv({ DATABASE_URL: databaseUrl, APP_NAME: "DOMIGOO" }));
  });

  afterEach(async () => {
    await currentApp?.close();
    currentApp = undefined;
  });

  it("registra, entra, consulta y cierra la sesión web", async () => {
    const agent = request.agent(server());
    const created = await agent.post("/v1/auth/register").send({
      email: "cuenta@example.invalid",
      password,
      client: "WEB",
    });
    expect(created.status).toBe(201);
    const cookie = String(created.headers["set-cookie"]);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(record(created.body)["token"]).toBeUndefined();

    const me = await agent.get("/v1/auth/me").expect(200);
    expect(record(me.body)).toMatchObject({ email: "cuenta@example.invalid", status: "ACTIVE" });

    const secrets = await storedSecrets(String(record(created.body)["id"]));
    expect(secrets.passwordHash).not.toContain(password);
    expect(secrets.passwordHash?.startsWith("$argon2id$")).toBe(true);
    expect(secrets.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(cookie).not.toContain(String(secrets.tokenHash));

    await agent.post("/v1/auth/logout").expect(204);
    await agent.get("/v1/auth/me").expect(401);
  });

  it("entrega el token al móvil y no lo guarda en claro", async () => {
    const created = await request(server())
      .post("/v1/auth/register")
      .send({ phoneE164: "+573001112233", password, client: "MOBILE" })
      .expect(201);
    expect(created.headers["set-cookie"]).toBeUndefined();
    const token = String(record(created.body)["token"]);
    const secrets = await storedSecrets(String(record(created.body)["id"]));
    expect(secrets.tokenHash).not.toBe(token);
    expect(secrets.passwordHash).not.toContain(password);

    await request(server()).get("/v1/auth/me").set("Authorization", `Bearer ${token}`).expect(200);
    await request(server())
      .post("/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
    await request(server()).get("/v1/auth/me").set("Authorization", `Bearer ${token}`).expect(401);
  });

  it("no revela si el correo existe y corta tras varios intentos", async () => {
    await request(server())
      .post("/v1/auth/register")
      .send({ email: "existe@example.invalid", password, client: "WEB" })
      .expect(201);

    const known = await request(server()).post("/v1/auth/login").send({
      email: "existe@example.invalid",
      password: "clave-incorrecta-12",
      client: "WEB",
    });
    const unknown = await request(server()).post("/v1/auth/login").send({
      email: "nadie@example.invalid",
      password: "clave-incorrecta-12",
      client: "WEB",
    });
    expect(known.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(known.body).toEqual(unknown.body);
    expect(JSON.stringify(known.body)).not.toContain("existe@example.invalid");
    expect(JSON.stringify(known.body)).not.toContain("clave-incorrecta-12");

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await request(server())
        .post("/v1/auth/login")
        .send({
          email: "nadie@example.invalid",
          password: "clave-incorrecta-12",
          client: "WEB",
        })
        .expect(401);
    }
    await request(server())
      .post("/v1/auth/login")
      .send({
        email: "nadie@example.invalid",
        password: "clave-incorrecta-12",
        client: "WEB",
      })
      .expect(429);
  });

  it("no permite dos cuentas con el mismo correo o teléfono", async () => {
    await request(server())
      .post("/v1/auth/register")
      .send({ email: "unica@example.invalid", phoneE164: "+573009998877", password, client: "WEB" })
      .expect(201);
    await request(server())
      .post("/v1/auth/register")
      .send({ email: "unica@example.invalid", password, client: "WEB" })
      .expect(409);
    await request(server())
      .post("/v1/auth/register")
      .send({ phoneE164: "+573009998877", password, client: "MOBILE" })
      .expect(409);
  });
});
