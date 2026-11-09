export type AppEnv = {
  readonly databaseUrl: string;
  readonly appName: string;
  readonly port: number;
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
  };
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
