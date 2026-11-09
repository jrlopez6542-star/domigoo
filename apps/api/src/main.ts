import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { readEnv } from "./config/env.js";
import { setupOpenApi } from "./openapi.js";

async function bootstrap(): Promise<void> {
  const env = readEnv(process.env);
  const app = await NestFactory.create(AppModule);
  setupOpenApi(app, env.appName);
  await app.listen(env.port);
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "No se pudo arrancar la API";
  if (/postgres(ql)?:\/\//i.test(message)) {
    process.stderr.write("No se pudo arrancar la API\n");
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
});
