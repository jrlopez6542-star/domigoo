export type SimulacrosConfig = {
  readonly databaseUrl: string;
  readonly seedPassword: string;
  readonly adminEmail: string;
  readonly ownerEmail: string;
  readonly client1Email: string;
  readonly client2Email: string;
  readonly courier1Email: string;
  readonly courier2Email: string;
};

export const SIMULACRO_PREFIX = "sim-m52-";
export const SIMULACRO_EMAIL_DOMAIN = "ejemplo.com";
export const SIMULACRO_NIT = "900520001";
export const SIMULACRO_COURIER1_DOC = "9005200001";
export const SIMULACRO_COURIER2_DOC = "9005200002";
export const SIMULACRO_COURIER1_PLATE = "SIM52A";
export const SIMULACRO_COURIER2_PLATE = "SIM52B";

export const SIMULACRO_ACCOUNTS = {
  adminEmail: `${SIMULACRO_PREFIX}admin@${SIMULACRO_EMAIL_DOMAIN}`,
  ownerEmail: `${SIMULACRO_PREFIX}restaurante@${SIMULACRO_EMAIL_DOMAIN}`,
  client1Email: `${SIMULACRO_PREFIX}cliente1@${SIMULACRO_EMAIL_DOMAIN}`,
  client2Email: `${SIMULACRO_PREFIX}cliente2@${SIMULACRO_EMAIL_DOMAIN}`,
  courier1Email: `${SIMULACRO_PREFIX}domiciliario1@${SIMULACRO_EMAIL_DOMAIN}`,
  courier2Email: `${SIMULACRO_PREFIX}domiciliario2@${SIMULACRO_EMAIL_DOMAIN}`,
} as const;

export function validateSimulacrosEnv(env: NodeJS.ProcessEnv): SimulacrosConfig {
  if (env["NODE_ENV"]?.trim().toLowerCase() === "production") {
    throw new Error("Abortado: simulacros nunca debe ejecutarse con NODE_ENV=production");
  }
  if (env["VERCEL_ENV"]?.trim().toLowerCase() === "production") {
    throw new Error("Abortado: simulacros nunca debe ejecutarse con VERCEL_ENV=production");
  }
  if (env["DOMIGOO_ENV"]?.trim() !== "staging") {
    throw new Error("Abortado: DOMIGOO_ENV debe ser exactamente 'staging'");
  }
  if (env["STAGING_SEED_CONFIRM"]?.trim() !== "yes") {
    throw new Error("Abortado: STAGING_SEED_CONFIRM debe ser exactamente 'yes'");
  }

  const databaseUrl = env["DATABASE_URL"]?.trim() ?? "";
  if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    throw new Error(
      "Abortado: DATABASE_URL es obligatoria y debe usar esquema postgres/postgresql",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("Abortado: DATABASE_URL no es una URL válida");
  }

  const host = parsedUrl.hostname.toLowerCase();
  const dbName = parsedUrl.pathname.replace(/^\/+/, "").toLowerCase();

  if (
    /(^|[._-])prod(uction)?([._-]|$)/i.test(host) ||
    /(^|[._-])prod(uction)?([._-]|$)/i.test(dbName)
  ) {
    throw new Error(
      `Abortado: DATABASE_URL (host='${host}', db='${dbName}') parece apuntar a producción`,
    );
  }

  const allowlist = (env["STAGING_ALLOWED_DB_HOSTS"] ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "");

  const hasStagingMarker = host.includes("staging") || dbName.includes("staging");
  const isExplicitlyAllowed = allowlist.includes(host);
  if (!hasStagingMarker && !isExplicitlyAllowed) {
    throw new Error(
      `Abortado: DATABASE_URL (host='${host}', db='${dbName}') no contiene 'staging' ni está en STAGING_ALLOWED_DB_HOSTS`,
    );
  }

  const seedPassword = env["SIMULACRO_PASSWORD"] ?? env["STAGING_SEED_PASSWORD"] ?? "";
  if (seedPassword.length < 12 || seedPassword.length > 72) {
    throw new Error(
      "Abortado: SIMULACRO_PASSWORD o STAGING_SEED_PASSWORD es obligatoria y debe tener entre 12 y 72 caracteres",
    );
  }

  return {
    databaseUrl,
    seedPassword,
    adminEmail: SIMULACRO_ACCOUNTS.adminEmail,
    ownerEmail: SIMULACRO_ACCOUNTS.ownerEmail,
    client1Email: SIMULACRO_ACCOUNTS.client1Email,
    client2Email: SIMULACRO_ACCOUNTS.client2Email,
    courier1Email: SIMULACRO_ACCOUNTS.courier1Email,
    courier2Email: SIMULACRO_ACCOUNTS.courier2Email,
  };
}
