import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export function isOpenApiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["NODE_ENV"] !== "production" && env["VERCEL_ENV"] !== "production";
}

export function setupOpenApi(app: INestApplication, appName: string): void {
  if (!isOpenApiEnabled()) {
    return;
  }
  const config = new DocumentBuilder()
    .setTitle(appName)
    .setDescription(`API de ${appName}. Incluye viveza, disponibilidad y cuenta.`)
    .setVersion("0.0.0")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document, {
    jsonDocumentUrl: "openapi.json",
  });
}
