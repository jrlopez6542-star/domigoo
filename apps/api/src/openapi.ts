import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export function setupOpenApi(app: INestApplication, appName: string): void {
  const config = new DocumentBuilder()
    .setTitle(appName)
    .setDescription(`API de ${appName}. Esta versión solo expone viveza y disponibilidad.`)
    .setVersion("0.0.0")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document, {
    jsonDocumentUrl: "openapi.json",
  });
}
