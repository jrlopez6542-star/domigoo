import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type AppEnv = {
  readonly databaseUrl: string;
  readonly appName: string;
  readonly port: number;
  readonly cookieSecure: boolean;
  readonly storageDir: string;
  readonly pinPepper: string;
  readonly appEncryptionKey: Buffer;
};

export const APP_ENV = Symbol("APP_ENV");

const postgresUrl = /^postgres(ql)?:\/\//i;
const DEV_PIN_PEPPER = "domigoo-dev-pin-pepper-no-usar-en-produccion";
const DEV_ENCRYPTION_SECRET = "domigoo-dev-encryption-key-no-usar-en-produccion";

export function readEnv(env: NodeJS.ProcessEnv): AppEnv {
  const databaseUrl = env["DATABASE_URL"]?.trim() ?? "";
  if (!postgresUrl.test(databaseUrl)) {
    throw new Error("DATABASE_URL debe ser una URL postgres:// o postgresql://");
  }

  const rawName = env["APP_NAME"]?.trim() ?? "";
  const appName = rawName === "" ? "DOMIGOO" : rawName;
  const isProd = env["NODE_ENV"] === "production";

  return {
    databaseUrl,
    appName,
    port: readPort(env["PORT"]),
    cookieSecure: isProd,
    storageDir: readStorageDir(env["STORAGE_DIR"]),
    pinPepper: readPinPepper(env["PIN_PEPPER"], isProd),
    appEncryptionKey: readEncryptionKey(
      env["APP_ENCRYPTION_KEY"] ?? env["DATA_ENCRYPTION_KEY"],
      isProd,
    ),
  };
}

export function defaultPinEnv(): Pick<AppEnv, "pinPepper" | "appEncryptionKey"> {
  return {
    pinPepper: DEV_PIN_PEPPER,
    appEncryptionKey: deriveAes256Key(DEV_ENCRYPTION_SECRET),
  };
}

function readPinPepper(raw: string | undefined, isProd: boolean): string {
  const value = raw?.trim() ?? "";
  if (value !== "") {
    return value;
  }
  if (isProd) {
    throw new Error("PIN_PEPPER es obligatorio en producción");
  }
  return DEV_PIN_PEPPER;
}

function readEncryptionKey(raw: string | undefined, isProd: boolean): Buffer {
  const value = raw?.trim() ?? "";
  if (value !== "") {
    return deriveAes256Key(value);
  }
  if (isProd) {
    throw new Error("APP_ENCRYPTION_KEY es obligatorio en producción");
  }
  return deriveAes256Key(DEV_ENCRYPTION_SECRET);
}

function deriveAes256Key(secret: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(secret)) {
    return Buffer.from(secret, "hex");
  }
  return createHash("sha256").update(secret, "utf8").digest();
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
