import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readEnv } from "./env.js";
import {
  assertPreviewBuildDatabases,
  assertPreviewDatabaseAuthorized,
} from "./preview-db-guard.js";
import { validateSeedEnv } from "../staging/seed-guard.js";
const PREVIEW_POOLED =
  "postgresql://preview_user:secret_pw@ep-preview-123-pooler.example.neon.tech/domigoo-preview?sslmode=require";
const PREVIEW_UNPOOLED =
  "postgresql://preview_user:secret_pw@ep-preview-123.example.neon.tech/domigoo-preview?sslmode=require";
const PROD_POOLED =
  "postgresql://prod_user:prod_pw@ep-prod-999-pooler.example.neon.tech/domigoo?sslmode=require";
const PROD_UNPOOLED =
  "postgresql://prod_user:prod_pw@ep-prod-999.example.neon.tech/domigoo?sslmode=require";

const basePreviewEnv: NodeJS.ProcessEnv = {
  VERCEL_ENV: "preview",
  NODE_ENV: "production",
  PIN_PEPPER: "pepper-preview-seguro-de-32-bytes",
  APP_ENCRYPTION_KEY: "clave-preview-segura-de-32-bytes",
  PREVIEW_DB_ALLOWED_ENDPOINTS: "ep-preview-123",
  PREVIEW_DB_EXPECTED_NAME: "domigoo-preview",
  PREVIEW_DB_FORBIDDEN_ENDPOINTS: "ep-prod-999",
  DATABASE_URL: PREVIEW_POOLED,
  DATABASE_URL_UNPOOLED: PREVIEW_UNPOOLED,
};

const repoRoot = resolve(process.cwd(), "..", "..");
const vercelBuildScript = resolve(repoRoot, "scripts", "vercel-build.sh");

describe("preview-db-guard (PREVIEW-DB-ISOLATION-002)", () => {
  it("1. Preview con base autorizada: permite", () => {
    expect(() => {
      assertPreviewBuildDatabases(basePreviewEnv);
    }).not.toThrow();
  });

  it("2. Preview apuntando a producción (prohibida): rechaza sin exponer secretos", () => {
    let caught: Error | undefined;
    try {
      assertPreviewBuildDatabases({
        ...basePreviewEnv,
        DATABASE_URL: PROD_POOLED,
        DATABASE_URL_UNPOOLED: PROD_UNPOOLED,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toMatch(/PREVIEW_DB_FORBIDDEN_ENDPOINTS/);
    expect(caught?.message).not.toContain("prod_pw");
    expect(caught?.message).not.toContain("ep-prod-999");
    expect(caught?.message).not.toContain("prod_user");
  });

  it("3. Preview sin allowlist: rechaza", () => {
    expect(() => {
      assertPreviewBuildDatabases({
        ...basePreviewEnv,
        PREVIEW_DB_ALLOWED_ENDPOINTS: "",
      });
    }).toThrow(/PREVIEW_DB_ALLOWED_ENDPOINTS/);

    expect(() => {
      assertPreviewBuildDatabases({
        ...basePreviewEnv,
        PREVIEW_DB_ALLOWED_ENDPOINTS: undefined,
      });
    }).toThrow(/PREVIEW_DB_ALLOWED_ENDPOINTS/);
  });

  it("4. Host desconocido (no listado en allowlist): rechaza", () => {
    expect(() => {
      assertPreviewBuildDatabases({
        ...basePreviewEnv,
        DATABASE_URL:
          "postgresql://preview_user:secret_pw@ep-otro-777-pooler.example.neon.tech/domigoo-preview",
        DATABASE_URL_UNPOOLED:
          "postgresql://preview_user:secret_pw@ep-otro-777.example.neon.tech/domigoo-preview",
      });
    }).toThrow(/PREVIEW_DB_ALLOWED_ENDPOINTS/);
  });

  it("5. Nombre de BD incorrecto: rechaza", () => {
    expect(() => {
      assertPreviewBuildDatabases({
        ...basePreviewEnv,
        DATABASE_URL:
          "postgresql://preview_user:secret_pw@ep-preview-123-pooler.example.neon.tech/otra-bd",
        DATABASE_URL_UNPOOLED:
          "postgresql://preview_user:secret_pw@ep-preview-123.example.neon.tech/otra-bd",
      });
    }).toThrow(/PREVIEW_DB_EXPECTED_NAME/);
  });

  it("6. Pooled (-pooler) y unpooled de la misma BD autorizada: permite", () => {
    expect(() => {
      assertPreviewDatabaseAuthorized(basePreviewEnv, { requireUnpooled: true });
    }).not.toThrow();
  });

  it("7. Pooled y unpooled de bases distintas (distinto endpoint, base o usuario): rechaza", () => {
    expect(() => {
      assertPreviewBuildDatabases({
        ...basePreviewEnv,
        PREVIEW_DB_ALLOWED_ENDPOINTS: "ep-preview-123,ep-preview-456",
        DATABASE_URL_UNPOOLED:
          "postgresql://preview_user:secret_pw@ep-preview-456.example.neon.tech/domigoo-preview",
      });
    }).toThrow(/misma base lógica/);

    expect(() => {
      assertPreviewBuildDatabases({
        ...basePreviewEnv,
        DATABASE_URL_UNPOOLED:
          "postgresql://otro_user:secret_pw@ep-preview-123.example.neon.tech/domigoo-preview",
      });
    }).toThrow(/misma base lógica/);
  });

  it("8. URL incompleta o malformada: rechaza sin filtrar la cadena", () => {
    expect(() => {
      assertPreviewBuildDatabases({
        ...basePreviewEnv,
        DATABASE_URL: "no-es-una-url",
      });
    }).toThrow(/no es una URL válida/);

    expect(() => {
      assertPreviewBuildDatabases({
        ...basePreviewEnv,
        DATABASE_URL_UNPOOLED: "postgresql://ep-preview-123.example.neon.tech/",
      });
    }).toThrow(/incompleta/);
  });

  it("9. Variables de staging ausentes en seed: rechaza", () => {
    expect(() =>
      validateSeedEnv({
        NODE_ENV: "development",
        VERCEL_ENV: "preview",
        DATABASE_URL: PREVIEW_POOLED,
        DATABASE_URL_UNPOOLED: PREVIEW_UNPOOLED,
        PREVIEW_DB_ALLOWED_ENDPOINTS: "ep-preview-123",
        PREVIEW_DB_EXPECTED_NAME: "domigoo-preview",
      }),
    ).toThrow(/DOMIGOO_ENV/);
  });

  it("10. Production válida: readEnv mantiene el mismo comportamiento", () => {
    const env = readEnv({
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      PIN_PEPPER: "pepper-prod-32-bytes-ejemplo-ok",
      APP_ENCRYPTION_KEY: "clave-prod-32-bytes-ejemplo-ok-1",
      DATABASE_URL: PROD_POOLED,
    });
    expect(env.databaseUrl).toBe(PROD_POOLED);
    expect(env.cookieSecure).toBe(true);
  });

  it("11. Seed en Preview apuntando a producción: rechaza", () => {
    expect(() =>
      validateSeedEnv({
        NODE_ENV: "development",
        VERCEL_ENV: "preview",
        DOMIGOO_ENV: "staging",
        STAGING_SEED_CONFIRM: "yes",
        STAGING_SEED_PASSWORD: "clave-staging-segura-123",
        PREVIEW_DB_ALLOWED_ENDPOINTS: "ep-preview-123",
        PREVIEW_DB_EXPECTED_NAME: "domigoo-preview",
        PREVIEW_DB_FORBIDDEN_ENDPOINTS: "ep-prod-999",
        DATABASE_URL: PROD_POOLED,
        DATABASE_URL_UNPOOLED: PROD_UNPOOLED,
      }),
    ).toThrow(/PREVIEW_DB_FORBIDDEN_ENDPOINTS/);
  });

  it("12. Runtime en Preview apuntando a producción: rechaza en readEnv sin exponer secretos", () => {
    let caught: Error | undefined;
    try {
      readEnv({
        ...basePreviewEnv,
        DATABASE_URL: PROD_POOLED,
        DATABASE_URL_UNPOOLED: PROD_UNPOOLED,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toMatch(/PREVIEW_DB_FORBIDDEN_ENDPOINTS/);
    expect(caught?.message).not.toContain("prod_pw");
    expect(caught?.message).not.toContain("ep-prod-999");
  });

  describe("scripts/vercel-build.sh con pnpm falso en PATH", () => {
    // PREVIEW-DB-ISOLATION-003: el script corre en un directorio temporal con su propio
    // apps/api/dist, para no sobrescribir dist/vercel-build-meta.js ni public/ del repo y
    // para no depender de que exista un build previo.
    let tempDir: string;
    let workDir: string;
    let logFile: string;
    let dbLogFile: string;
    let fakeBinDir: string;
    const apiDir = resolve(repoRoot, "apps", "api");

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "domigoo-vercel-build-test-"));
      workDir = join(tempDir, "work");
      mkdirSync(join(workDir, "apps", "api", "dist"), { recursive: true });
      logFile = join(tempDir, "pnpm-calls.log");
      dbLogFile = join(tempDir, "pnpm-db.log");
      fakeBinDir = join(tempDir, "bin");
      mkdirSync(fakeBinDir);
      const fakePnpm = join(fakeBinDir, "pnpm");
      writeFileSync(
        fakePnpm,
        `#!/bin/sh
echo "$*" >> "${logFile}"
if [ "\${DATABASE_URL:-}" = "\${DATABASE_URL_UNPOOLED:-}" ]; then echo "unpooled" >> "${dbLogFile}"; else echo "otra" >> "${dbLogFile}"; fi
case "$*" in
  *preview-db-guard-cli.ts*)
    "${apiDir}/node_modules/.bin/tsx" "${apiDir}/src/config/preview-db-guard-cli.ts"
    exit $?
    ;;
  *)
    exit 0
    ;;
esac
`,
      );
      chmodSync(fakePnpm, 0o755);
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    function runBuild(env: NodeJS.ProcessEnv): ReturnType<typeof spawnSync> {
      return spawnSync("sh", [vercelBuildScript], {
        cwd: workDir,
        env: { PATH: `${fakeBinDir}:${process.env["PATH"] ?? ""}`, ...env },
        encoding: "utf8",
      });
    }

    function readCalls(): string[] {
      return readFileSync(logFile, "utf8").trim().split("\n");
    }

    it("en Preview inválido nunca llama migrate deploy ni seed:staging", () => {
      const res = runBuild({
        VERCEL_ENV: "preview",
        DATABASE_URL: PROD_POOLED,
        DATABASE_URL_UNPOOLED: PROD_UNPOOLED,
        PREVIEW_DB_ALLOWED_ENDPOINTS: "ep-preview-123",
        PREVIEW_DB_EXPECTED_NAME: "domigoo-preview",
        PREVIEW_DB_FORBIDDEN_ENDPOINTS: "ep-prod-999",
        STAGING_SEED_PASSWORD: "clave-staging-segura-123",
      });
      expect(res.status).not.toBe(0);
      const calls = readFileSync(logFile, "utf8");
      expect(calls).toContain("preview-db-guard-cli.ts");
      expect(calls).not.toContain("migrate deploy");
      expect(calls).not.toContain("seed:staging");
      expect(String(res.stderr)).not.toContain("prod_pw");
    });

    it("en Preview con ?host= hacia producción aborta antes de migrate deploy", () => {
      const hijacked = `${PREVIEW_UNPOOLED}&host=ep-prod-999.example.neon.tech`;
      const res = runBuild({
        ...basePreviewEnv,
        DATABASE_URL: hijacked,
        DATABASE_URL_UNPOOLED: hijacked,
      });
      expect(res.status).not.toBe(0);
      expect(readCalls()).toEqual([
        "--filter @domigoo/api exec tsx src/config/preview-db-guard-cli.ts",
      ]);
    });

    it("en Preview válido valida antes de migrar y antes de sembrar, siempre con la URL unpooled", () => {
      const res = runBuild({
        ...basePreviewEnv,
        STAGING_SEED_PASSWORD: "clave-staging-segura-123",
      });
      expect(res.status).toBe(0);
      expect(readCalls()).toEqual([
        "--filter @domigoo/api exec tsx src/config/preview-db-guard-cli.ts",
        "--filter @domigoo/api exec prisma migrate deploy",
        "--filter @domigoo/api exec tsx src/config/preview-db-guard-cli.ts",
        "--filter @domigoo/api seed:staging",
        "--filter @domigoo/api seed:staging",
        "--filter @domigoo/api build",
      ]);
      const dbs = readFileSync(dbLogFile, "utf8").trim().split("\n");
      expect(dbs[1]).toBe("unpooled");
      expect(dbs[3]).toBe("unpooled");
      expect(dbs[4]).toBe("unpooled");
      const meta = readFileSync(
        join(workDir, "apps", "api", "dist", "vercel-build-meta.js"),
        "utf8",
      );
      expect(meta).toContain('migrateDeploy: "ok"');
      expect(meta).toContain('seedStaging: "ejecutado"');
    });

    it("con VERCEL_ENV no canónico (Preview) no migra ni siembra", () => {
      const res = runBuild({ ...basePreviewEnv, VERCEL_ENV: "Preview" });
      expect(res.status).toBe(0);
      expect(readCalls()).toEqual(["--filter @domigoo/api build"]);
    });

    it("en Production ejecuta exactamente los mismos comandos de antes (migrate deploy, seed-admin, build)", () => {
      const res = runBuild({
        VERCEL_ENV: "production",
        DATABASE_URL: PROD_POOLED,
        DATABASE_URL_UNPOOLED: PROD_UNPOOLED,
      });
      expect(res.status).toBe(0);
      const calls = readCalls();
      expect(calls).toEqual([
        "--filter @domigoo/api exec prisma migrate deploy",
        "--filter @domigoo/api seed-admin",
        "--filter @domigoo/api build",
      ]);
    });
  });
});
