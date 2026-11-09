import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function migrateDatabase(databaseUrl: string): void {
  const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "prisma migrate deploy falló");
  }
}
