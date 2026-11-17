import { readEnv } from "./env.js";

describe("readEnv", () => {
  const databaseUrl = "postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo";

  it("exige una URL de PostgreSQL", () => {
    expect(() => readEnv({ DATABASE_URL: "mysql://localhost/domigoo" })).toThrow(/postgres/);
    expect(() => readEnv({})).toThrow(/DATABASE_URL/);
  });

  it("usa DOMIGOO cuando APP_NAME no viene", () => {
    expect(readEnv({ DATABASE_URL: databaseUrl }).appName).toBe("DOMIGOO");
  });

  it("respeta APP_NAME", () => {
    expect(readEnv({ DATABASE_URL: databaseUrl, APP_NAME: "Nombre local" }).appName).toBe(
      "Nombre local",
    );
  });

  it("exige PIN_PEPPER y APP_ENCRYPTION_KEY (o DATA_ENCRYPTION_KEY) en NODE_ENV=production", () => {
    expect(() =>
      readEnv({
        DATABASE_URL: databaseUrl,
        NODE_ENV: "production",
      }),
    ).toThrow(/PIN_PEPPER/);

    expect(() =>
      readEnv({
        DATABASE_URL: databaseUrl,
        NODE_ENV: "production",
        PIN_PEPPER: "pepper-seguro-32-bytes",
      }),
    ).toThrow(/APP_ENCRYPTION_KEY/);

    const withAppKey = readEnv({
      DATABASE_URL: databaseUrl,
      NODE_ENV: "production",
      PIN_PEPPER: "pepper-seguro-32-bytes",
      APP_ENCRYPTION_KEY: "clave-cifrado-32-bytes",
    });
    expect(withAppKey.cookieSecure).toBe(true);
    expect(withAppKey.appEncryptionKey.length).toBe(32);

    const withDataKey = readEnv({
      DATABASE_URL: databaseUrl,
      NODE_ENV: "production",
      PIN_PEPPER: "pepper-seguro-32-bytes",
      DATA_ENCRYPTION_KEY: "clave-cifrado-alternativa-32-bytes",
    });
    expect(withDataKey.cookieSecure).toBe(true);
    expect(withDataKey.appEncryptionKey.length).toBe(32);
  });

  it("configura BILLING_ENABLED=false, SUBSCRIPTION_TRIAL_DAYS=15 y SUBSCRIPTION_PLACEHOLDER_PRICE_COP=0 por defecto", () => {
    const defaults = readEnv({ DATABASE_URL: databaseUrl });
    expect(defaults.billingEnabled).toBe(false);
    expect(defaults.subscriptionTrialDays).toBe(15);
    expect(defaults.subscriptionPlaceholderPriceCop).toBe(0);

    const custom = readEnv({
      DATABASE_URL: databaseUrl,
      BILLING_ENABLED: "true",
      SUBSCRIPTION_TRIAL_DAYS: "30",
      SUBSCRIPTION_PLACEHOLDER_PRICE_COP: "79000",
    });
    expect(custom.billingEnabled).toBe(true);
    expect(custom.subscriptionTrialDays).toBe(30);
    expect(custom.subscriptionPlaceholderPriceCop).toBe(79000);
  });
});
