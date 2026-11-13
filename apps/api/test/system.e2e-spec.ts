import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { APP_ENV, readEnv, type AppEnv } from "../src/config/env.js";
import { setupOpenApi } from "../src/openapi.js";

const liveDatabaseUrl =
  process.env["DATABASE_URL"] ?? "postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo";
const downDatabaseUrl = "postgresql://domigoo:domigoo@127.0.0.1:1/domigoo";

type HttpServer = Parameters<typeof request>[0];

function httpServer(app: INestApplication): HttpServer {
  return app.getHttpServer() as HttpServer;
}

async function createApp(env: AppEnv): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_ENV)
    .useValue(env)
    .compile();
  const app = moduleRef.createNestApplication();
  setupOpenApi(app, env.appName);
  await app.init();
  return app;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateGeneratedOpenApi(document: unknown): void {
  const dir = mkdtempSync(path.join(tmpdir(), "domigoo-openapi-"));
  const file = path.join(dir, "openapi.json");
  writeFileSync(file, JSON.stringify(document));
  const validator = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../validate-openapi.mjs",
  );
  const result = spawnSync(process.execPath, [validator, file], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "OpenAPI inválido");
  }
}

describe("sistema", () => {
  it("responde 200 en /health y 503 en /ready cuando la base no acepta conexiones", async () => {
    const app = await createApp(readEnv({ DATABASE_URL: downDatabaseUrl, APP_NAME: "DOMIGOO" }));
    try {
      await request(httpServer(app)).get("/health").expect(200).expect({ status: "ok" });
      await request(httpServer(app)).get("/ready").expect(503).expect({ status: "unavailable" });
    } finally {
      await app.close();
    }
  });

  it("responde 200 en /ready contra PostGIS", async () => {
    const app = await createApp(readEnv({ DATABASE_URL: liveDatabaseUrl, APP_NAME: "DOMIGOO" }));
    try {
      await request(httpServer(app)).get("/health").expect(200).expect({ status: "ok" });
      await request(httpServer(app)).get("/ready").expect(200).expect({ status: "ok" });
    } finally {
      await app.close();
    }
  });

  it("publica una especificación OpenAPI válida, con el título de APP_NAME y sin dominio", async () => {
    const app = await createApp(
      readEnv({ DATABASE_URL: downDatabaseUrl, APP_NAME: "Nombre de prueba" }),
    );
    try {
      const response = await request(httpServer(app)).get("/openapi.json").expect(200);
      const document: unknown = response.body;
      if (!isRecord(document)) {
        throw new Error("openapi.json no es un objeto");
      }
      validateGeneratedOpenApi(document);

      const info = document["info"];
      if (!isRecord(info) || info["title"] !== "Nombre de prueba") {
        throw new Error("El título de OpenAPI no salió de APP_NAME");
      }

      const paths = document["paths"];
      if (!isRecord(paths)) {
        throw new Error("OpenAPI no trae paths");
      }
      const pathNames = Object.keys(paths);
      expect(pathNames).toEqual(expect.arrayContaining(["/health", "/ready"]));
      const business = pathNames.filter((path) => path.startsWith("/v1"));
      expect(
        business.every(
          (path) =>
            path.startsWith("/v1/auth") ||
            path.startsWith("/v1/restaurants") ||
            path.startsWith("/v1/admin") ||
            path.startsWith("/v1/legal-documents") ||
            path.startsWith("/v1/consents") ||
            path.startsWith("/v1/branches") ||
            path.startsWith("/v1/admin/tariffs") ||
            path.startsWith("/v1/admin/policies") ||
            path.startsWith("/v1/couriers") ||
            path.startsWith("/v1/courier-invitations") ||
            path.startsWith("/v1/orders") ||
            path.startsWith("/v1/offers") ||
            path.startsWith("/v1/tracking") ||
            path.startsWith("/v1/devices") ||
            path.startsWith("/v1/incidents") ||
            path.startsWith("/v1/data-subject-requests"),
        ),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("sirve la documentación en /docs", async () => {
    const app = await createApp(readEnv({ DATABASE_URL: downDatabaseUrl }));
    try {
      const response = await request(httpServer(app)).get("/docs/").expect(200);
      expect(String(response.headers["content-type"])).toMatch(/html/);
    } finally {
      await app.close();
    }
  });
});
