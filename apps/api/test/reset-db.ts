import { Pool } from "pg";

export async function resetDatabase(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`DELETE FROM notification_outbox`);
    await pool.query(`DELETE FROM tracking_accesses`);
    await pool.query(`DELETE FROM tracking_links`);
    await pool.query(`DELETE FROM pin_attempts`);
    await pool.query(`DELETE FROM dispatch_offers`);
    await pool.query(`DELETE FROM order_events`);
    await pool.query(`DELETE FROM tariff_quotes`);
    await pool.query(`DELETE FROM incident_events`);
    await pool.query(`DELETE FROM incidents`);
    await pool.query(`DELETE FROM orders`);
    await pool.query(`DELETE FROM location_pings`);
    await pool.query(`DELETE FROM courier_availabilities`);
    await pool.query(`DELETE FROM verification_decisions`);
    await pool.query(`DELETE FROM verification_cases`);
    await pool.query(`DELETE FROM courier_documents`);
    await pool.query(`DELETE FROM vehicles`);
    await pool.query(`DELETE FROM couriers`);
    await pool.query(`DELETE FROM courier_invitations`);
    await pool.query(`DELETE FROM data_subject_requests`);
    await pool.query(`ALTER TABLE consent_records DISABLE TRIGGER consent_records_no_mutate`);
    try {
      await pool.query(`DELETE FROM consent_records`);
    } finally {
      await pool.query(`ALTER TABLE consent_records ENABLE TRIGGER consent_records_no_mutate`);
    }
    await pool.query(`ALTER TABLE legal_documents DISABLE TRIGGER legal_documents_no_mutate`);
    try {
      await pool.query(`DELETE FROM legal_documents`);
    } finally {
      await pool.query(`ALTER TABLE legal_documents ENABLE TRIGGER legal_documents_no_mutate`);
    }
    await pool.query(`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update`);
    await pool.query(`DELETE FROM audit_logs`);
    await pool.query(`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update`);
    await pool.query(`DELETE FROM subscription_payment_declarations`);
    await pool.query(`DELETE FROM subscription_events`);
    await pool.query(`DELETE FROM restaurant_subscriptions`);
    await pool.query(`DELETE FROM subscription_plans`);
    await pool.query(`DELETE FROM restaurant_memberships`);
    await pool.query(`DELETE FROM admin_profiles`);
    await pool.query(`DELETE FROM device_push_tokens`);
    await pool.query(`DELETE FROM sessions`);
    await pool.query(`DELETE FROM rate_limit_buckets`);
    await pool.query(`DELETE FROM stored_objects`);
    await pool.query(`DELETE FROM restaurants`);
    await pool.query(`DELETE FROM users`);
  } finally {
    await pool.end();
  }
}
