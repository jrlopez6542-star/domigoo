// Borrador de fase 0 para Prisma ORM 7.10.
// `prisma validate` no abre una conexión. Las migraciones sí leen DATABASE_URL.
// En M02 este archivo se traslada a apps/api; no es configuración de producción.
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
