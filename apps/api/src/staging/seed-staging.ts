import { createHash } from "node:crypto";
import { Pool } from "pg";
import { hashPassword } from "../identity/password.js";

const databaseUrl = process.env["DATABASE_URL"]?.trim() ?? "";
if (!databaseUrl.startsWith("postgres")) {
  process.stderr.write("DATABASE_URL es obligatoria para ejecutar el seed de staging\n");
  process.exit(1);
}

const seedPassword = process.env["STAGING_SEED_PASSWORD"]?.trim() || "staging-ficticia-no-prod-12";
if (seedPassword.length < 12 || seedPassword.length > 72) {
  process.stderr.write("STAGING_SEED_PASSWORD debe tener entre 12 y 72 caracteres\n");
  process.exit(1);
}

const adminEmail = (
  process.env["STAGING_ADMIN_EMAIL"]?.trim() || "reviewer-staging@example.com"
).toLowerCase();
const ownerEmail = (
  process.env["STAGING_RESTAURANT_OWNER_EMAIL"]?.trim() || "restaurante-staging@example.com"
).toLowerCase();
const courierEmail = (
  process.env["STAGING_COURIER_EMAIL"]?.trim() || "domiciliario-staging@example.com"
).toLowerCase();

async function ensureUser(
  client: import("pg").PoolClient,
  email: string,
  passwordHash: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
    email,
  ]);
  if (existing.rows[0]?.id !== undefined) {
    return existing.rows[0].id;
  }
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO users (id, email, "passwordHash", status, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now())
     RETURNING id`,
    [email, passwordHash],
  );
  const id = inserted.rows[0]?.id;
  if (id === undefined) {
    throw new Error(`No se pudo crear el usuario ${email}`);
  }
  return id;
}

async function ensureLegalDocument(
  client: import("pg").PoolClient,
  kind: "DOCUMENT_PROCESSING" | "GEOLOCATION_CONSENT",
  version: string,
  content: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM legal_documents WHERE kind = $1::"LegalDocumentKind" AND version = $2`,
    [kind, version],
  );
  if (existing.rows[0]?.id !== undefined) {
    return existing.rows[0].id;
  }
  const contentHash = createHash("sha256").update(content, "utf8").digest("hex");
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO legal_documents (id, kind, version, "contentHash", "publishedAt")
     VALUES (gen_random_uuid(), $1::"LegalDocumentKind", $2, $3, now())
     RETURNING id`,
    [kind, version, contentHash],
  );
  return String(inserted.rows[0]?.id);
}

async function ensureConsent(
  client: import("pg").PoolClient,
  userId: string,
  legalDocumentId: string,
  purpose: "DOCUMENT_STORAGE" | "GEOLOCATION",
  channel: "WEB" | "MOBILE",
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM consent_records
     WHERE "userId" = $1 AND purpose = $2::"ConsentPurpose" AND "revokedAt" IS NULL
     LIMIT 1`,
    [userId, purpose],
  );
  if (existing.rows[0]?.id !== undefined) {
    return existing.rows[0].id;
  }
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO consent_records (id, "userId", "legalDocumentId", purpose, channel, "grantedAt")
     VALUES (gen_random_uuid(), $1, $2, $3::"ConsentPurpose", $4::"ConsentChannel", now())
     RETURNING id`,
    [userId, legalDocumentId, purpose, channel],
  );
  return String(inserted.rows[0]?.id);
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const passwordHash = hashPassword(seedPassword);

    // 1. Admin REVIEWER ficticio
    const adminUserId = await ensureUser(client, adminEmail, passwordHash);
    await client.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, 'Revisor Staging', 'REVIEWER', now(), now())
       ON CONFLICT ("userId") DO UPDATE SET role = 'REVIEWER', "updatedAt" = now()`,
      [adminUserId],
    );

    // 2. Tarifa publicada de staging
    const existingTariff = await client.query<{ id: string }>(
      `SELECT id FROM tariff_versions WHERE name = 'Tarifa Staging' LIMIT 1`,
    );
    let tariffVersionId = existingTariff.rows[0]?.id;
    if (tariffVersionId === undefined) {
      await client.query(
        `UPDATE tariff_versions SET status = 'RETIRED' WHERE status = 'PUBLISHED'`,
      );
      const tv = await client.query<{ id: string }>(
        `INSERT INTO tariff_versions (id, name, status, "publishedAt", "createdAt")
         VALUES (gen_random_uuid(), 'Tarifa Staging', 'PUBLISHED', now(), now())
         RETURNING id`,
      );
      tariffVersionId = tv.rows[0]?.id;
      await client.query(
        `INSERT INTO tariff_rules (
           id, "versionId", "zoneId", "baseFeeCop", "perKmCop", "minimumFeeCop",
           "nightMultiplierBps", "nightStartsMinute", "nightEndsMinute"
         ) VALUES (gen_random_uuid(), $1, NULL, 5500, 0, 0, 10000, 0, 0)`,
        [tariffVersionId],
      );
    }

    // 3. Política operativa publicada de staging
    const existingPolicy = await client.query<{ id: string }>(
      `SELECT id FROM operations_policies WHERE name = 'Politica Staging' LIMIT 1`,
    );
    if (existingPolicy.rows[0]?.id === undefined) {
      await client.query(
        `UPDATE operations_policies SET status = 'RETIRED' WHERE status = 'PUBLISHED'`,
      );
      await client.query(
        `INSERT INTO operations_policies (
           id, name, status, "offerRadiusMeters", "directOfferTtlSeconds", "openOfferTtlSeconds",
           "seekingTtlSeconds", "maxOffersPerWave", "locationFreshnessSeconds", "publishedAt", "createdAt"
         ) VALUES (
           gen_random_uuid(), 'Politica Staging', 'PUBLISHED', 3000, 120, 120, 600, 4, 120, now(), now()
         )`,
      );
    }

    // 4. Documentos legales base
    const docLegalId = await ensureLegalDocument(
      client,
      "DOCUMENT_PROCESSING",
      "2026-stg-doc",
      "Documento de tratamiento de datos ficticio para entorno staging",
    );
    const gpsLegalId = await ensureLegalDocument(
      client,
      "GEOLOCATION_CONSENT",
      "2026-stg-gps",
      "Consentimiento de geolocalización ficticio para entorno staging",
    );

    // 5. Plan de suscripción de staging
    const planRes = await client.query<{ id: string }>(
      `INSERT INTO subscription_plans (
         id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders"
       ) VALUES (gen_random_uuid(), 'STAGING_PLAN', 'Plan Staging', 99000, 30, 14, 2, 10)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
    );
    const planId = String(planRes.rows[0]?.id);

    // 6. Restaurante ficticio activo con sucursal en Tocancipá y suscripción TRIAL
    const ownerUserId = await ensureUser(client, ownerEmail, passwordHash);
    const existingRest = await client.query<{ id: string }>(
      `SELECT id FROM restaurants WHERE nit = '900000901' LIMIT 1`,
    );
    let restaurantId = existingRest.rows[0]?.id;
    let branchId: string | undefined;

    if (restaurantId === undefined) {
      const restIns = await client.query<{ id: string }>(
        `INSERT INTO restaurants (
           id, "legalName", "tradeName", nit, email, "phoneE164", status, "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), 'Asadero Staging SAS', 'Restaurante Staging', '900000901',
           'contacto-staging@example.com', '+573000000101', 'ACTIVE', now(), now()
         )
         RETURNING id`,
      );
      restaurantId = String(restIns.rows[0]?.id);

      await client.query(
        `INSERT INTO restaurant_memberships (
           id, "restaurantId", "userId", role, status, "createdAt", "updatedAt"
         ) VALUES (gen_random_uuid(), $1, $2, 'OWNER', 'ACTIVE', now(), now())
         ON CONFLICT ("restaurantId", "userId") DO NOTHING`,
        [restaurantId, ownerUserId],
      );

      const estIns = await client.query<{ id: string }>(
        `INSERT INTO establishments (id, "restaurantId", name, status, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, 'Sede Staging', 'ACTIVE', now(), now())
         RETURNING id`,
        [restaurantId],
      );
      const establishmentId = String(estIns.rows[0]?.id);

      const branchIns = await client.query<{ id: string }>(
        `INSERT INTO branches (
           id, "establishmentId", name, "addressLine", location, status, "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), $1, 'Principal Staging', 'Calle Ficticia 10 # 4-20',
           ST_SetSRID(ST_MakePoint(-73.9132, 4.9655), 4326)::geography, 'ACTIVE', now(), now()
         )
         RETURNING id`,
        [establishmentId],
      );
      branchId = String(branchIns.rows[0]?.id);

      await client.query(
        `INSERT INTO branch_hours (id, "branchId", weekday, "opensMinute", "closesMinute")
         VALUES (gen_random_uuid(), $1, 1, 480, 1200)`,
        [branchId],
      );

      await client.query(
        `INSERT INTO restaurant_subscriptions (
           id, "restaurantId", "planId", "priceCop", status, "isCurrent", "periodStartsAt", "periodEndsAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), $1, $2, 99000, 'TRIAL', true, now() - interval '1 day', now() + interval '13 days', now()
         )`,
        [restaurantId, planId],
      );
    }

    // 7. Domiciliario ficticio aprobado y disponible dentro de zona
    const courierUserId = await ensureUser(client, courierEmail, passwordHash);
    await ensureConsent(client, courierUserId, docLegalId, "DOCUMENT_STORAGE", "MOBILE");
    const gpsConsentId = await ensureConsent(
      client,
      courierUserId,
      gpsLegalId,
      "GEOLOCATION",
      "MOBILE",
    );

    const existingCourier = await client.query<{ id: string }>(
      `SELECT id FROM couriers WHERE "userId" = $1 LIMIT 1`,
      [courierUserId],
    );
    let courierId = existingCourier.rows[0]?.id;
    if (courierId === undefined) {
      const courierIns = await client.query<{ id: string }>(
        `INSERT INTO couriers (
           id, "userId", "documentType", "documentNumber", "firstName", "lastName",
           status, "registrationSource", "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), $1, 'CC', '9000090001', 'Camila', 'Staging',
           'APPROVED', 'OPEN', now(), now()
         )
         RETURNING id`,
        [courierUserId],
      );
      courierId = String(courierIns.rows[0]?.id);
    }

    await client.query(
      `INSERT INTO courier_availabilities (
         "courierId", state, "consentId", location, "accuracyM", "recordedAt", "updatedAt"
       ) VALUES (
         $1, 'AVAILABLE', $2, ST_SetSRID(ST_MakePoint(-73.918, 4.968), 4326)::geography, 10, now(), now()
       )
       ON CONFLICT ("courierId") DO UPDATE
         SET state = 'AVAILABLE',
             "consentId" = EXCLUDED."consentId",
             location = EXCLUDED.location,
             "accuracyM" = 10,
             "recordedAt" = now(),
             "updatedAt" = now()`,
      [courierId, gpsConsentId],
    );

    await client.query("COMMIT");

    process.stdout.write(
      `${JSON.stringify(
        {
          seeded: true,
          adminEmail,
          ownerEmail,
          courierEmail,
          restaurantId,
          branchId: branchId ?? "(existente)",
          courierId,
          planId,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
