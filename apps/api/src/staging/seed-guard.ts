export type SeedConfig = {
  readonly databaseUrl: string;
  readonly seedPassword: string;
  readonly adminEmail: string;
  readonly ownerEmail: string;
  readonly courierEmail: string;
};

export function validateSeedEnv(env: NodeJS.ProcessEnv): SeedConfig {
  if (env["NODE_ENV"]?.trim().toLowerCase() === "production") {
    throw new Error("Abortado: seed-staging nunca debe ejecutarse con NODE_ENV=production");
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

  const seedPassword = env["STAGING_SEED_PASSWORD"] ?? "";
  if (seedPassword.length < 12 || seedPassword.length > 72) {
    throw new Error(
      "Abortado: STAGING_SEED_PASSWORD es obligatoria y debe tener entre 12 y 72 caracteres",
    );
  }

  return {
    databaseUrl,
    seedPassword,
    adminEmail: (
      env["STAGING_ADMIN_EMAIL"]?.trim() || "reviewer-staging@example.com"
    ).toLowerCase(),
    ownerEmail: (
      env["STAGING_RESTAURANT_OWNER_EMAIL"]?.trim() || "restaurante-staging@example.com"
    ).toLowerCase(),
    courierEmail: (
      env["STAGING_COURIER_EMAIL"]?.trim() || "domiciliario-staging@example.com"
    ).toLowerCase(),
  };
}
