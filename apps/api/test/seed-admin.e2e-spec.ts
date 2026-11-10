import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { migrateDatabase } from "./migrate.js";
import { resetDatabase } from "./reset-db.js";

const databaseUrl =
  process.env["DATABASE_URL"] ?? "postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo";
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(apiRoot, "../..");

function runSeed(env: NodeJS.ProcessEnv): { status: number | null; stderr: string } {
  const result = spawnSync("pnpm", ["exec", "tsx", "src/identity/seed-admin.ts"], {
    cwd: apiRoot,
    env,
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr };
}

describe("semilla de administración", () => {
  beforeAll(() => {
    migrateDatabase(databaseUrl);
  });

  beforeEach(async () => {
    await resetDatabase(databaseUrl);
  });

  it("sale 0 y no crea nada si faltan las variables", async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl };
    delete env["SEED_ADMIN_EMAIL"];
    delete env["SEED_ADMIN_PASSWORD"];
    expect(runSeed(env).status).toBe(0);
    const pool = new Pool({ connectionString: databaseUrl });
    const count = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM users`);
    await pool.end();
    expect(count.rows[0]?.count).toBe("0");
  });

  it("crea un solo superadmin aunque se ejecute dos veces", async () => {
    const secret = `semilla-${randomBytes(8).toString("hex")}`;
    const env = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      SEED_ADMIN_EMAIL: "semilla@example.invalid",
      SEED_ADMIN_PASSWORD: secret,
    };
    expect(runSeed(env).status).toBe(0);
    expect(runSeed(env).status).toBe(0);

    const pool = new Pool({ connectionString: databaseUrl });
    const users = await pool.query<{ count: string; passwordHash: string }>(
      `SELECT count(*)::text AS count, min("passwordHash") AS "passwordHash" FROM users`,
    );
    const role = await pool.query<{ role: string }>(
      `SELECT role::text AS role FROM admin_profiles`,
    );
    await pool.end();
    expect(users.rows[0]?.count).toBe("1");
    expect(role.rows[0]?.role).toBe("SUPERADMIN");
    const stored = users.rows[0]?.passwordHash ?? "";
    expect(stored).not.toContain(secret);
    expect(stored.startsWith("$argon2id$")).toBe(true);
  });

  it("no deja una contraseña real asignada en el código", () => {
    const source = readFileSync(path.join(apiRoot, "src/identity/seed-admin.ts"), "utf8");
    expect(source).not.toMatch(/SEED_ADMIN_PASSWORD\s*=\s*["']/);
    const needles = [
      ["SEED_ADMIN_PASSWORD", "admin"].join("="),
      ["SEED_ADMIN_PASSWORD", "password"].join("="),
    ];
    const grep = spawnSync("git", ["grep", "-n", ...needles.flatMap((needle) => ["-e", needle])], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(grep.status).not.toBe(0);
  });
});
