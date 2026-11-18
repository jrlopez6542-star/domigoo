import { validateSimulacrosEnv } from "./simulacros-guard.js";

const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  DOMIGOO_ENV: "staging",
  STAGING_SEED_CONFIRM: "yes",
  DATABASE_URL: "postgresql://user:pass@ep-staging.example.neon.tech/domigoo-staging",
  STAGING_SEED_PASSWORD: "clave-simulacro-segura-123",
};

describe("guardas de seguridad de simulacros M52", () => {
  it("acepta configuración staging válida y retorna cuentas @ejemplo.com", () => {
    const cfg = validateSimulacrosEnv(validEnv);
    expect(cfg.adminEmail).toBe("sim-m52-admin@ejemplo.com");
    expect(cfg.ownerEmail).toBe("sim-m52-restaurante@ejemplo.com");
    expect(cfg.client1Email).toBe("sim-m52-cliente1@ejemplo.com");
    expect(cfg.client2Email).toBe("sim-m52-cliente2@ejemplo.com");
    expect(cfg.courier1Email).toBe("sim-m52-domiciliario1@ejemplo.com");
    expect(cfg.courier2Email).toBe("sim-m52-domiciliario2@ejemplo.com");
  });

  it("aborta si NODE_ENV, VERCEL_ENV o DOMIGOO_ENV es production", () => {
    expect(() => validateSimulacrosEnv({ ...validEnv, NODE_ENV: "production" })).toThrow(
      /NODE_ENV=production/,
    );
    expect(() => validateSimulacrosEnv({ ...validEnv, VERCEL_ENV: "production" })).toThrow(
      /VERCEL_ENV=production/,
    );
    expect(() => validateSimulacrosEnv({ ...validEnv, DOMIGOO_ENV: "production" })).toThrow(
      /DOMIGOO_ENV/,
    );
  });

  it("aborta si DATABASE_URL apunta a producción incluso si está en STAGING_ALLOWED_DB_HOSTS", () => {
    expect(() =>
      validateSimulacrosEnv({
        ...validEnv,
        DATABASE_URL: "postgresql://user:pass@prod.db.example.com/domigoo",
        STAGING_ALLOWED_DB_HOSTS: "prod.db.example.com",
      }),
    ).toThrow(/producción/);

    expect(() =>
      validateSimulacrosEnv({
        ...validEnv,
        DATABASE_URL: "postgresql://user:pass@db.example.com/domigoo_prod",
        STAGING_ALLOWED_DB_HOSTS: "db.example.com",
      }),
    ).toThrow(/producción/);
  });

  it("aborta si falta STAGING_SEED_CONFIRM=yes", () => {
    expect(() => validateSimulacrosEnv({ ...validEnv, STAGING_SEED_CONFIRM: "no" })).toThrow(
      /STAGING_SEED_CONFIRM/,
    );
  });
});
