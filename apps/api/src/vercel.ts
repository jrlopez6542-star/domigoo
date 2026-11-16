import type { RequestListener } from "node:http";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { readEnv } from "./config/env.js";
import { applyHttpSecurity } from "./http.js";
import { setupOpenApi } from "./openapi.js";

export function createVercelHandler(): Promise<RequestListener> {
  return NestFactory.create(AppModule, { logger: ["error"] }).then(async (app) => {
    const env = readEnv(process.env);
    applyHttpSecurity(app);
    setupOpenApi(app, env.appName);
    await app.init();
    return app.getHttpAdapter().getInstance() as RequestListener;
  });
}
