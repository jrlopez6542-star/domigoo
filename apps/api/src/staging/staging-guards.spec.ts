import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { validateSeedEnv } from "./seed-guard.js";

const validSeedEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  DOMIGOO_ENV: "staging",
  STAGING_SEED_CONFIRM: "yes",
  DATABASE_URL: "postgresql://user:pass@ep-staging.example.neon.tech/domigoo-staging",
  STAGING_SEED_PASSWORD: "clave-staging-segura-123",
};

const smokeScriptPath = resolve(process.cwd(), "..", "..", "scripts", "smoke-staging.mjs");

describe("guardas de seguridad de staging (M41-FIX-SEED-GUARD)", () => {
  describe("validateSeedEnv", () => {
    it("acepta una configuración válida de staging", () => {
      const cfg = validateSeedEnv(validSeedEnv);
      expect(cfg.databaseUrl).toContain("domigoo-staging");
      expect(cfg.seedPassword).toBe("clave-staging-segura-123");
      expect(cfg.adminEmail).toBe("reviewer-staging@example.com");
    });

    it("aborta si NODE_ENV es production", () => {
      expect(() => validateSeedEnv({ ...validSeedEnv, NODE_ENV: "production" })).toThrow(
        /NODE_ENV=production/,
      );
    });

    it("aborta si DOMIGOO_ENV no es staging", () => {
      expect(() => validateSeedEnv({ ...validSeedEnv, DOMIGOO_ENV: "prod" })).toThrow(
        /DOMIGOO_ENV/,
      );
      expect(() => validateSeedEnv({ ...validSeedEnv, DOMIGOO_ENV: undefined })).toThrow(
        /DOMIGOO_ENV/,
      );
    });

    it("aborta si STAGING_SEED_CONFIRM no es yes", () => {
      expect(() => validateSeedEnv({ ...validSeedEnv, STAGING_SEED_CONFIRM: "no" })).toThrow(
        /STAGING_SEED_CONFIRM/,
      );
      expect(() => validateSeedEnv({ ...validSeedEnv, STAGING_SEED_CONFIRM: undefined })).toThrow(
        /STAGING_SEED_CONFIRM/,
      );
    });

    it("aborta si DATABASE_URL no contiene staging en host ni nombre de BD", () => {
      expect(() =>
        validateSeedEnv({
          ...validSeedEnv,
          DATABASE_URL: "postgresql://user:pass@prod.db.example.com/domigoo",
        }),
      ).toThrow(/STAGING_ALLOWED_DB_HOSTS/);
    });

    it("permite host sin 'staging' únicamente si está en STAGING_ALLOWED_DB_HOSTS", () => {
      const cfg = validateSeedEnv({
        ...validSeedEnv,
        DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/domigoo",
        STAGING_ALLOWED_DB_HOSTS: "127.0.0.1",
      });
      expect(cfg.databaseUrl).toContain("127.0.0.1");
    });

    it("aborta si falta STAGING_SEED_PASSWORD o es menor a 12 caracteres", () => {
      expect(() => validateSeedEnv({ ...validSeedEnv, STAGING_SEED_PASSWORD: undefined })).toThrow(
        /STAGING_SEED_PASSWORD/,
      );
      expect(() => validateSeedEnv({ ...validSeedEnv, STAGING_SEED_PASSWORD: "corta" })).toThrow(
        /STAGING_SEED_PASSWORD/,
      );
    });
  });

  describe("scripts/smoke-staging.mjs", () => {
    it("aborta si falta STAGING_API_URL", () => {
      const res = spawnSync("node", [smokeScriptPath], {
        env: { PATH: process.env["PATH"], STAGING_SEED_PASSWORD: "clave-staging-segura-123" },
        encoding: "utf8",
      });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("STAGING_API_URL");
    });

    it("aborta si STAGING_API_URL apunta a un dominio de producción sin flag explícito", () => {
      const res = spawnSync("node", [smokeScriptPath], {
        env: {
          PATH: process.env["PATH"],
          STAGING_API_URL: "https://api.domigoo.com",
          STAGING_SEED_PASSWORD: "clave-staging-segura-123",
        },
        encoding: "utf8",
      });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("STAGING_SMOKE_ALLOW_HOST");
    });

    it("aborta si falta STAGING_SEED_PASSWORD o es inválida", () => {
      const res = spawnSync("node", [smokeScriptPath], {
        env: {
          PATH: process.env["PATH"],
          STAGING_API_URL: "https://domigoo-staging.vercel.app",
        },
        encoding: "utf8",
      });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("STAGING_SEED_PASSWORD");
    });
  });
});
