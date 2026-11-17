import { Pool } from "pg";
import { ensureTocancipaCoverageConfig } from "../geo/tocancipa-coverage.js";
import { hashPassword } from "./password.js";

const email = process.env["SEED_ADMIN_EMAIL"]?.trim().toLowerCase() ?? "";
const password = process.env["SEED_ADMIN_PASSWORD"] ?? "";

if (email === "" || password === "") {
  process.exit(0);
}

const databaseUrl = process.env["DATABASE_URL"]?.trim() ?? "";
if (!databaseUrl.startsWith("postgres")) {
  process.stderr.write("DATABASE_URL es obligatoria para sembrar el admin\n");
  process.exit(1);
}
if (password.length < 12 || password.length > 72) {
  process.stderr.write("SEED_ADMIN_PASSWORD debe tener entre 12 y 72 caracteres\n");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
try {
  const existing = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
    email,
  ]);
  let userId = existing.rows[0]?.id;
  if (userId === undefined) {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO users (id, email, "passwordHash", status, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now())
       RETURNING id`,
      [email, hashPassword(password)],
    );
    userId = inserted.rows[0]?.id;
  }
  if (userId === undefined) {
    throw new Error("No se pudo crear el admin");
  }
  const profile = await pool.query(`SELECT 1 FROM admin_profiles WHERE "userId" = $1`, [userId]);
  if ((profile.rowCount ?? 0) === 0) {
    await pool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Administración local', 'SUPERADMIN', now(), now())`,
      [userId],
    );
  }
  await ensureTocancipaCoverageConfig(pool);
} finally {
  await pool.end();
}
