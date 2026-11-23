import pg from "pg";
import {
  assertPreviewBuildDatabases,
  assertPreviewDatabaseAuthorized,
  parsePostgresTarget,
} from "./preview-db-guard.js";
import { validateSeedEnv } from "../staging/seed-guard.js";

// PREVIEW-DB-ISOLATION-003: auditoría adversarial del guard.
// Todas las URLs son ficticias; ninguna prueba abre conexiones de red.

const HOST = "ep-preview-123.us-east-1.aws.neon.tech";
const POOLER_HOST = "ep-preview-123-pooler.us-east-1.aws.neon.tech";
const PROD_HOST = "ep-prod-999.us-east-1.aws.neon.tech";
const SECRET = "s3cr3t_pw";

const POOLED = `postgresql://preview_user:${SECRET}@${POOLER_HOST}/domigoo-preview?sslmode=require`;
const UNPOOLED = `postgresql://preview_user:${SECRET}@${HOST}/domigoo-preview?sslmode=require`;

const previewEnv: NodeJS.ProcessEnv = {
  VERCEL_ENV: "preview",
  PREVIEW_DB_ALLOWED_ENDPOINTS: "ep-preview-123",
  PREVIEW_DB_EXPECTED_NAME: "domigoo-preview",
  PREVIEW_DB_FORBIDDEN_ENDPOINTS: "ep-prod-999",
  DATABASE_URL: POOLED,
  DATABASE_URL_UNPOOLED: UNPOOLED,
};

function both(url: string): NodeJS.ProcessEnv {
  return { ...previewEnv, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url };
}

function rejectionMessage(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("se esperaba un rechazo y el guard aceptó");
}

type PgParams = {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  options?: string;
};

function pgEffective(url: string): PgParams {
  const client = new pg.Client({ connectionString: url }) as unknown as {
    connectionParameters: PgParams;
  };
  return client.connectionParameters;
}

describe("preview-db-guard adversarial (PREVIEW-DB-ISOLATION-003)", () => {
  it("la configuración Neon real (pooled + unpooled, sslmode y channel_binding) sigue permitida", () => {
    expect(() => {
      assertPreviewBuildDatabases({
        ...previewEnv,
        DATABASE_URL: `${POOLED}&channel_binding=require`,
        DATABASE_URL_UNPOOLED: `${UNPOOLED}&channel_binding=require`,
      });
    }).not.toThrow();
  });

  describe("H1: parámetros de consulta que pg o Prisma usan para cambiar el destino", () => {
    const attacks: Record<string, string> = {
      "host=": `postgresql://preview_user:pw@${HOST}/domigoo-preview?host=${PROD_HOST}`,
      "host= socket": `postgresql://preview_user:pw@${HOST}/domigoo-preview?host=/var/run/postgresql`,
      "hostaddr=": `postgresql://preview_user:pw@${HOST}/domigoo-preview?hostaddr=10.0.0.1`,
      "port=": `postgresql://preview_user:pw@${HOST}/domigoo-preview?port=6543`,
      "user=": `postgresql://preview_user:pw@${HOST}/domigoo-preview?user=prod_user`,
      "password=": `postgresql://preview_user:pw@${HOST}/domigoo-preview?password=x`,
      "dbname=": `postgresql://preview_user:pw@${HOST}/domigoo-preview?dbname=domigoo`,
      "database=": `postgresql://preview_user:pw@${HOST}/domigoo-preview?database=domigoo`,
      "options=endpoint": `postgresql://preview_user:pw@${HOST}/domigoo-preview?options=endpoint%3Dep-prod-999`,
      "service=": `postgresql://preview_user:pw@${HOST}/domigoo-preview?service=prod`,
      "sslrootcert=": `postgresql://preview_user:pw@${HOST}/domigoo-preview?sslrootcert=/etc/passwd`,
      "parametro duplicado": `postgresql://preview_user:pw@${HOST}/domigoo-preview?sslmode=require&sslmode=disable`,
    };
    for (const [name, url] of Object.entries(attacks)) {
      it(`rechaza ${name}`, () => {
        const message = rejectionMessage(() => {
          assertPreviewBuildDatabases(both(url));
        });
        expect(message).toMatch(/PREVIEW_DB_GUARD/);
        expect(message).not.toContain("ep-prod-999");
      });
    }

    it("pg-connection-string sí obedece ?host= (prueba de que el ataque es real)", () => {
      expect(
        pgEffective(`postgresql://preview_user:pw@${HOST}/domigoo-preview?host=${PROD_HOST}`).host,
      ).toBe(PROD_HOST);
    });
  });

  describe("H2: identidad del endpoint ligada al dominio Neon y a la región", () => {
    const attacks: Record<string, string> = {
      "dominio ajeno": "postgresql://preview_user:pw@ep-preview-123.evil.example/domigoo-preview",
      "dominio parecido":
        "postgresql://preview_user:pw@ep-preview-123.attacker-neon.tech/domigoo-preview",
      "neon.tech como subdominio": `postgresql://preview_user:pw@ep-preview-123.neon.tech.evil.example/domigoo-preview`,
      "varios hosts": `postgresql://preview_user:pw@${HOST},${PROD_HOST}/domigoo-preview`,
      "punto final": `postgresql://preview_user:pw@${HOST}./domigoo-preview`,
      "host percent-encoded":
        "postgresql://preview_user:pw@ep-preview-123%2Eevil.example/domigoo-preview",
      "socket unix codificado":
        "postgresql://preview_user:pw@%2Fvar%2Frun%2Fpostgresql/domigoo-preview",
      IPv6: "postgresql://preview_user:pw@[::1]/domigoo-preview",
      "IP directa": "postgresql://preview_user:pw@127.0.0.1/domigoo-preview",
    };
    for (const [name, url] of Object.entries(attacks)) {
      it(`rechaza ${name}`, () => {
        expect(() => {
          assertPreviewBuildDatabases(both(url));
        }).toThrow(/PREVIEW_DB_GUARD/);
      });
    }

    it("rechaza pooled y unpooled del mismo endpoint en regiones distintas", () => {
      expect(() => {
        assertPreviewBuildDatabases({
          ...previewEnv,
          DATABASE_URL_UNPOOLED: `postgresql://preview_user:pw@ep-preview-123.eu-central-1.aws.neon.tech/domigoo-preview`,
        });
      }).toThrow(/misma base lógica/);
    });

    it("acepta mayúsculas en el host (DNS no distingue) y lo normaliza", () => {
      expect(() => {
        assertPreviewBuildDatabases({
          ...previewEnv,
          DATABASE_URL_UNPOOLED: `postgresql://preview_user:pw@${HOST.toUpperCase()}/domigoo-preview`,
        });
      }).not.toThrow();
    });
  });

  describe("H3: enrutamiento Neon por contraseña y variables PG* de libpq", () => {
    it("rechaza contraseña con prefijo endpoint=", () => {
      expect(() => {
        assertPreviewBuildDatabases(
          both(`postgresql://preview_user:endpoint%3Dep-prod-999%24pw@${HOST}/domigoo-preview`),
        );
      }).toThrow(/PREVIEW_DB_GUARD/);
    });

    it("rechaza PGOPTIONS en el entorno (pg la envía como options al servidor)", () => {
      expect(() => {
        assertPreviewDatabaseAuthorized({ ...previewEnv, PGOPTIONS: "endpoint=ep-prod-999" });
      }).toThrow(/PGOPTIONS/);
    });

    it("rechaza PGPORT distinto del puerto efectivo de la URL", () => {
      expect(() => {
        assertPreviewDatabaseAuthorized({ ...previewEnv, PGPORT: "6543" });
      }).toThrow(/PGPORT/);
    });

    it("tolera PGHOST, PGUSER y PGDATABASE de la integración Neon (la URL los anula)", () => {
      expect(() => {
        assertPreviewDatabaseAuthorized({
          ...previewEnv,
          PGHOST: PROD_HOST,
          PGUSER: "otro",
          PGDATABASE: "neondb",
        });
      }).not.toThrow();
    });
  });

  describe("H4: espacios, caracteres de control, fragmentos y nombres codificados", () => {
    const attacks: Record<string, string> = {
      "salto de línea dentro del host": `postgresql://preview_user:pw@ep-preview-123.us-east-1.aws.neon.tech\n/domigoo-preview`,
      "tabulador dentro del host": `postgresql://preview_user:pw@ep-preview-\t123.us-east-1.aws.neon.tech/domigoo-preview`,
      "espacio al final": `${UNPOOLED} `,
      "salto de línea al final": `${UNPOOLED}\n`,
      fragmento: `postgresql://preview_user:pw@${HOST}/domigoo-preview#x`,
      "nombre de BD codificado": `postgresql://preview_user:pw@${HOST}/domigoo%2Dpreview`,
      "nombre de BD con barra": `postgresql://preview_user:pw@${HOST}/domigoo-preview/x`,
    };
    for (const [name, url] of Object.entries(attacks)) {
      it(`rechaza ${name}`, () => {
        expect(() => {
          assertPreviewBuildDatabases(both(url));
        }).toThrow(/PREVIEW_DB_GUARD/);
      });
    }
  });

  describe("H5: configuración explícita bien formada", () => {
    it("rechaza entradas de allowlist que no son IDs ep-... (hostname completo o -pooler)", () => {
      expect(() => {
        assertPreviewBuildDatabases({ ...previewEnv, PREVIEW_DB_ALLOWED_ENDPOINTS: HOST });
      }).toThrow(/PREVIEW_DB_ALLOWED_ENDPOINTS/);
      expect(() => {
        assertPreviewBuildDatabases({
          ...previewEnv,
          PREVIEW_DB_ALLOWED_ENDPOINTS: "ep-preview-123-pooler",
        });
      }).toThrow(/PREVIEW_DB_ALLOWED_ENDPOINTS/);
    });

    it("rechaza un endpoint presente a la vez en allowlist y en la lista prohibida", () => {
      expect(() => {
        assertPreviewBuildDatabases({
          ...previewEnv,
          PREVIEW_DB_FORBIDDEN_ENDPOINTS: "ep-preview-123",
        });
      }).toThrow(/PREVIEW_DB_FORBIDDEN_ENDPOINTS/);
    });

    it("rechaza PREVIEW_DB_FORBIDDEN_ENDPOINTS mal formada", () => {
      expect(() => {
        assertPreviewBuildDatabases({ ...previewEnv, PREVIEW_DB_FORBIDDEN_ENDPOINTS: PROD_HOST });
      }).toThrow(/PREVIEW_DB_FORBIDDEN_ENDPOINTS/);
    });
  });

  describe("H6: VERCEL_ENV con valores no canónicos falla cerrado", () => {
    const prodUrl = `postgresql://prod_user:pw@${PROD_HOST}/neondb`;
    for (const value of [
      "Preview",
      " preview ",
      "PREVIEW",
      "staging",
      "prod",
      "PRODUCTION",
      " production",
    ]) {
      it(`VERCEL_ENV=${JSON.stringify(value)} aplica el guard estricto`, () => {
        expect(() => {
          assertPreviewDatabaseAuthorized({
            ...previewEnv,
            VERCEL_ENV: value,
            DATABASE_URL: prodUrl,
          });
        }).toThrow(/PREVIEW_DB_GUARD/);
      });
    }

    for (const value of ["production", "development", "", undefined]) {
      it(`VERCEL_ENV=${JSON.stringify(value)} conserva el comportamiento anterior (sin guard)`, () => {
        expect(() => {
          assertPreviewDatabaseAuthorized({ VERCEL_ENV: value, DATABASE_URL: prodUrl });
        }).not.toThrow();
      });
    }

    it("el guard de build (CLI) se niega a correr fuera de Preview", () => {
      expect(() => {
        assertPreviewBuildDatabases({ ...previewEnv, VERCEL_ENV: "production" });
      }).toThrow(/PREVIEW_DB_GUARD/);
      expect(() => {
        assertPreviewBuildDatabases({ ...previewEnv, VERCEL_ENV: undefined });
      }).toThrow(/PREVIEW_DB_GUARD/);
    });
  });

  describe("H7: seed de staging fuera de Preview no puede desviarse con parámetros", () => {
    const localSeed: NodeJS.ProcessEnv = {
      NODE_ENV: "development",
      DOMIGOO_ENV: "staging",
      STAGING_SEED_CONFIRM: "yes",
      STAGING_SEED_PASSWORD: "clave-staging-segura-123",
      STAGING_ALLOWED_DB_HOSTS: "127.0.0.1",
    };

    it("rechaza 127.0.0.1 con ?host= hacia un host remoto", () => {
      expect(() =>
        validateSeedEnv({
          ...localSeed,
          DATABASE_URL: `postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo?host=${PROD_HOST}`,
        }),
      ).toThrow();
    });

    it("rechaza 127.0.0.1 con ?hostaddr= o ?options=", () => {
      expect(() =>
        validateSeedEnv({
          ...localSeed,
          DATABASE_URL: "postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo?hostaddr=10.0.0.1",
        }),
      ).toThrow();
      expect(() =>
        validateSeedEnv({
          ...localSeed,
          DATABASE_URL:
            "postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo?options=endpoint%3Dep-prod-999",
        }),
      ).toThrow();
    });

    it("sigue aceptando la URL loopback que usa CI", () => {
      const cfg = validateSeedEnv({
        ...localSeed,
        DATABASE_URL: "postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo",
      });
      expect(cfg.databaseUrl).toBe("postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo");
    });
  });

  describe("H8: los mensajes nunca filtran URL, usuario, contraseña ni host", () => {
    const leaks = [
      `postgresql://leak_user:${SECRET}@${PROD_HOST}/neondb`,
      `postgresql://leak_user:${SECRET}@${HOST}/domigoo-preview?host=${PROD_HOST}`,
      `postgresql://leak_user:${SECRET}@ep-preview-123.evil.example/domigoo-preview`,
      `postgresql://leak_user:${SECRET}@${HOST}/otra_bd`,
      `postgresql://leak_user:${SECRET}@${HOST}\n/domigoo-preview`,
      `no-es-url-${SECRET}`,
    ];
    leaks.forEach((url, index) => {
      it(`sin fugas en el caso ${String(index + 1)}`, () => {
        const message = rejectionMessage(() => {
          assertPreviewBuildDatabases(both(url));
        });
        for (const fragment of [SECRET, "leak_user", PROD_HOST, "evil.example", "otra_bd", HOST]) {
          expect(message).not.toContain(fragment);
        }
      });
    });
  });

  describe("paridad con el parser real de pg (pg-connection-string)", () => {
    const accepted = [
      POOLED,
      UNPOOLED,
      `${UNPOOLED}&channel_binding=require&connect_timeout=15`,
      `postgresql://preview_user:pw@${HOST}:5432/domigoo-preview`,
      `postgres://preview_user:p%40ss@${HOST}/domigoo-preview`,
    ];
    for (const url of accepted) {
      it(`host, puerto, base y usuario coinciden con pg: ${url.slice(0, 40)}...`, () => {
        const target = parsePostgresTarget(url, "DATABASE_URL");
        const effective = pgEffective(url);
        expect(effective.host?.toLowerCase()).toBe(target.host);
        expect(String(effective.port)).toBe(target.port);
        expect(effective.database).toBe(target.database);
        expect(effective.user).toBe(target.user);
        expect(effective.options).toBeUndefined();
      });
    }
  });
});
