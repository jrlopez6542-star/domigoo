import { tmpdir } from "node:os";
import { join } from "node:path";

export type AppEnv = {
  readonly databaseUrl: string;
  readonly appName: string;
  readonly port: number;
  readonly cookieSecure: boolean;
  readonly storageDir: string;
};

export const APP_ENV = Symbol("APP_ENV");

const postgresUrl = /^postgres(ql)?:\/\//i;

export function readEnv(env: NodeJS.ProcessEnv): AppEnv {
  const databaseUrl = env["DATABASE_URL"]?.trim() ?? "";
  if (!postgresUrl.test(databaseUrl)) {
    throw new Error("DATABASE_URL debe ser una URL postgres:// o postgresql://");
  }

  const rawName = env["APP_NAME"]?.trim() ?? "";
  const appName = rawName === "" ? "DOMIGOO" : rawName;

  return {
    databaseUrl,
    appName,
    port: readPort(env["PORT"]),
    cookieSecure: env["NODE_ENV"] === "production",
    storageDir: readStorageDir(env["STORAGE_DIR"]),
  };
}

function readStorageDir(raw: string | undefined): string {
  const dir = raw?.trim() ?? "";
  if (dir === "") {
    return join(tmpdir(), "domigoo-storage");
  }
  if (dir.includes("\0")) {
    throw new Error("STORAGE_DIR no es una ruta válida");
  }
  return dir;
}

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return 3000;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error("PORT debe ser un entero entre 1 y 65535");
  }
  const port = Number(raw);
  if (port < 1 || port > 65535) {
    throw new Error("PORT debe ser un entero entre 1 y 65535");
  }
  return port;
}
