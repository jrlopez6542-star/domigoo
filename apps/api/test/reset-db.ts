import { Pool } from "pg";

export async function resetDatabase(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`DELETE FROM consent_records`);
    await pool.query(`DELETE FROM legal_documents`);
    await pool.query(`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update`);
    await pool.query(`DELETE FROM audit_logs`);
    await pool.query(`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update`);
    await pool.query(`DELETE FROM restaurant_memberships`);
    await pool.query(`DELETE FROM admin_profiles`);
    await pool.query(`DELETE FROM sessions`);
    await pool.query(`DELETE FROM restaurants`);
    await pool.query(`DELETE FROM users`);
  } finally {
    await pool.end();
  }
}
