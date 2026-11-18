import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import {
  TOCANCIPA_POLYGON_WKT,
  TOCANCIPA_ZONE_CODE,
  TOCANCIPA_ZONE_NAME,
  ensureTocancipaCoverageConfig,
} from "../geo/tocancipa-coverage.js";
import { hashPassword } from "../identity/password.js";
import {
  SIMULACRO_COURIER1_DOC,
  SIMULACRO_COURIER1_PLATE,
  SIMULACRO_COURIER2_DOC,
  SIMULACRO_COURIER2_PLATE,
  SIMULACRO_NIT,
  validateSimulacrosEnv,
  type SimulacrosConfig,
} from "./simulacros-guard.js";

let config: SimulacrosConfig;
try {
  config = validateSimulacrosEnv(process.env);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

async function ensureUser(
  client: PoolClient,
  email: string,
  phoneE164: string,
  passwordHash: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
    email,
  ]);
  if (existing.rows[0]?.id !== undefined) {
    await client.query(
      `UPDATE users
       SET "passwordHash" = $2, "phoneE164" = $3, status = 'ACTIVE', "updatedAt" = now()
       WHERE id = $1`,
      [existing.rows[0].id, passwordHash, phoneE164],
    );
    return existing.rows[0].id;
  }
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO users (id, email, "phoneE164", "passwordHash", status, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 'ACTIVE', now(), now())
     RETURNING id`,
    [email, phoneE164, passwordHash],
  );
  const id = inserted.rows[0]?.id;
  if (id === undefined) {
    throw new Error(`No se pudo crear el usuario ${email}`);
  }
  return id;
}

async function ensureLegalDocument(
  client: PoolClient,
  kind: "DOCUMENT_PROCESSING" | "GEOLOCATION_CONSENT" | "TERMS" | "PRIVACY_NOTICE",
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
  client: PoolClient,
  userId: string,
  legalDocumentId: string,
  purpose: "DOCUMENT_STORAGE" | "GEOLOCATION" | "TERMS_ACCEPTANCE" | "ACCOUNT",
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

async function ensureSimCourier(
  client: PoolClient,
  input: {
    email: string;
    phoneE164: string;
    passwordHash: string;
    docNumber: string;
    firstName: string;
    lastName: string;
    plate: string;
    longitude: number;
    latitude: number;
    docLegalId: string;
    gpsLegalId: string;
  },
): Promise<{ userId: string; courierId: string }> {
  const userId = await ensureUser(client, input.email, input.phoneE164, input.passwordHash);
  await ensureConsent(client, userId, input.docLegalId, "DOCUMENT_STORAGE", "MOBILE");
  const gpsConsentId = await ensureConsent(
    client,
    userId,
    input.gpsLegalId,
    "GEOLOCATION",
    "MOBILE",
  );

  const existingCourier = await client.query<{ id: string }>(
    `SELECT id FROM couriers WHERE "userId" = $1 LIMIT 1`,
    [userId],
  );
  let courierId = existingCourier.rows[0]?.id;
  if (courierId === undefined) {
    const courierIns = await client.query<{ id: string }>(
      `INSERT INTO couriers (
         id, "userId", "documentType", "documentNumber", "firstName", "lastName",
         status, "registrationSource", "createdAt", "updatedAt"
       ) VALUES (
         gen_random_uuid(), $1, 'CC', $2, $3, $4,
         'APPROVED', 'OPEN', now(), now()
       )
       RETURNING id`,
      [userId, input.docNumber, input.firstName, input.lastName],
    );
    courierId = String(courierIns.rows[0]?.id);
  } else {
    await client.query(
      `UPDATE couriers SET status = 'APPROVED', "updatedAt" = now() WHERE id = $1`,
      [courierId],
    );
  }

  await client.query(
    `INSERT INTO vehicles (
       id, "courierId", type, plate, "soatExpiresOn", "techExpiresOn", status, "createdAt", "updatedAt"
     ) VALUES (
       gen_random_uuid(), $1, 'MOTORCYCLE', $2, '2028-04-01', '2028-08-01', 'ACTIVE', now(), now()
     )
     ON CONFLICT ("courierId") DO UPDATE
       SET status = 'ACTIVE',
           plate = EXCLUDED.plate,
           "soatExpiresOn" = '2028-04-01',
           "techExpiresOn" = '2028-08-01',
           "updatedAt" = now()`,
    [courierId, input.plate],
  );

  const docTypes = [
    "NATIONAL_ID",
    "DRIVER_LICENSE",
    "SOAT",
    "TECH_INSPECTION",
    "VEHICLE_PHOTO",
    "PROFILE_PHOTO",
  ] as const;
  const dummySha = createHash("sha256").update("sim-m52-dummy-pdf", "utf8").digest("hex");
  for (const docType of docTypes) {
    const existingDoc = await client.query<{ id: string }>(
      `SELECT id FROM courier_documents
       WHERE "courierId" = $1 AND type = $2::"CourierDocumentType" AND status = 'ACCEPTED'
       LIMIT 1`,
      [courierId, docType],
    );
    if (existingDoc.rows[0]?.id === undefined) {
      await client.query(
        `INSERT INTO courier_documents (
           id, "courierId", type, "storageKey", sha256, "mimeType", "byteSize", status, "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), $1, $2::"CourierDocumentType", $3, $4, 'application/pdf', 64, 'ACCEPTED', now(), now()
         )`,
        [courierId, docType, `staging/sim-m52/${courierId}/${docType.toLowerCase()}.pdf`, dummySha],
      );
    }
  }

  await client.query(
    `INSERT INTO courier_availabilities (
       "courierId", state, "consentId", location, "accuracyM", "recordedAt", "updatedAt"
     ) VALUES (
       $1, 'AVAILABLE', $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, 10, now(), now()
     )
     ON CONFLICT ("courierId") DO UPDATE
       SET state = 'AVAILABLE',
           "consentId" = EXCLUDED."consentId",
           location = EXCLUDED.location,
           "accuracyM" = 10,
           "recordedAt" = now(),
           "updatedAt" = now()`,
    [courierId, gpsConsentId, input.longitude, input.latitude],
  );

  return { userId, courierId };
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const passwordHash = hashPassword(config.seedPassword);

    // 1. Admin OPERATIONS ficticio para simulacros
    const adminUserId = await ensureUser(client, config.adminEmail, "+573000005200", passwordHash);
    await client.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       VALUES ($1, '[SIM-M52] Operaciones', 'OPERATIONS', now(), now())
       ON CONFLICT ("userId") DO UPDATE SET role = 'OPERATIONS', "updatedAt" = now()`,
      [adminUserId],
    );

    // 2. Asegurar tarifa y política publicadas si no existen
    const publishedTariff = await client.query<{ id: string }>(
      `SELECT id FROM tariff_versions WHERE status = 'PUBLISHED' LIMIT 1`,
    );
    let tariffVersionId = publishedTariff.rows[0]?.id;
    if (tariffVersionId === undefined) {
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

    if (tariffVersionId !== undefined) {
      const zoneRes = await client.query<{ id: string }>(
        `INSERT INTO tariff_zones (id, "versionId", code, name, area, priority)
         VALUES (gen_random_uuid(), $1, $2, $3, ST_GeogFromText($4), 100)
         ON CONFLICT ("versionId", code) DO UPDATE
           SET name = EXCLUDED.name,
               area = EXCLUDED.area,
               priority = EXCLUDED.priority
         RETURNING id`,
        [tariffVersionId, TOCANCIPA_ZONE_CODE, TOCANCIPA_ZONE_NAME, TOCANCIPA_POLYGON_WKT],
      );
      const zoneId = zoneRes.rows[0]?.id;
      if (zoneId !== undefined) {
        const zoneRule = await client.query<{ id: string }>(
          `SELECT id FROM tariff_rules WHERE "versionId" = $1 AND "zoneId" = $2 LIMIT 1`,
          [tariffVersionId, zoneId],
        );
        if (zoneRule.rows[0]?.id === undefined) {
          await client.query(
            `INSERT INTO tariff_rules (
               id, "versionId", "zoneId", "baseFeeCop", "perKmCop", "minimumFeeCop",
               "nightMultiplierBps", "nightStartsMinute", "nightEndsMinute"
             ) VALUES (gen_random_uuid(), $1, $2, 5500, 0, 0, 10000, 0, 0)`,
            [tariffVersionId, zoneId],
          );
        }
      }
    }

    const publishedPolicy = await client.query<{ id: string }>(
      `SELECT id FROM operations_policies WHERE status = 'PUBLISHED' LIMIT 1`,
    );
    if (publishedPolicy.rows[0]?.id === undefined) {
      await client.query(
        `INSERT INTO operations_policies (
           id, name, status, "offerRadiusMeters", "directOfferTtlSeconds", "openOfferTtlSeconds",
           "seekingTtlSeconds", "maxOffersPerWave", "locationFreshnessSeconds", "publishedAt", "createdAt"
         ) VALUES (
           gen_random_uuid(), 'Politica Staging', 'PUBLISHED', 3000, 120, 120, 600, 4, 120, now(), now()
         )`,
      );
    }

    await ensureTocancipaCoverageConfig(client);

    // 3. Documentos legales base
    const docLegalId = await ensureLegalDocument(
      client,
      "DOCUMENT_PROCESSING",
      "2026-sim-doc",
      "Documento de tratamiento de datos ficticio para simulacros M52",
    );
    const gpsLegalId = await ensureLegalDocument(
      client,
      "GEOLOCATION_CONSENT",
      "2026-sim-gps",
      "Consentimiento de geolocalización ficticio para simulacros M52",
    );
    const termsLegalId = await ensureLegalDocument(
      client,
      "TERMS",
      "2026-sim-terms",
      "Términos y condiciones ficticios para simulacros M52",
    );
    const privacyLegalId = await ensureLegalDocument(
      client,
      "PRIVACY_NOTICE",
      "2026-sim-privacy",
      "Política de privacidad ficticia para simulacros M52",
    );

    // 4. Plan de suscripción
    const planRes = await client.query<{ id: string }>(
      `INSERT INTO subscription_plans (
         id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders"
       ) VALUES (gen_random_uuid(), 'STAGING_PLAN', 'Plan Staging', 99000, 30, 14, 2, 10)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
    );
    const planId = String(planRes.rows[0]?.id);

    // 5. Restaurante simulacro con sede en Tocancipá
    const ownerUserId = await ensureUser(client, config.ownerEmail, "+573000005201", passwordHash);
    await ensureConsent(client, ownerUserId, termsLegalId, "TERMS_ACCEPTANCE", "WEB");
    await ensureConsent(client, ownerUserId, privacyLegalId, "ACCOUNT", "WEB");

    const existingRest = await client.query<{ id: string }>(
      `SELECT id FROM restaurants WHERE nit = $1 LIMIT 1`,
      [SIMULACRO_NIT],
    );
    let restaurantId = existingRest.rows[0]?.id;
    let branchId: string | undefined;

    if (restaurantId === undefined) {
      const restIns = await client.query<{ id: string }>(
        `INSERT INTO restaurants (
           id, "legalName", "tradeName", nit, email, "phoneE164", status, "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), 'Simulacro M52 Cocina Tocancipa SAS', '[SIM-M52] Cocina Tocancipa',
           $1, 'sim-m52-contacto@ejemplo.com', '+573000005201', 'ACTIVE', now(), now()
         )
         RETURNING id`,
        [SIMULACRO_NIT],
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
         VALUES (gen_random_uuid(), $1, '[SIM-M52] Sede Centro Tocancipa', 'ACTIVE', now(), now())
         RETURNING id`,
        [restaurantId],
      );
      const establishmentId = String(estIns.rows[0]?.id);

      const branchIns = await client.query<{ id: string }>(
        `INSERT INTO branches (
           id, "establishmentId", name, "addressLine", location, status, "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), $1, '[SIM-M52] Principal Tocancipa', 'Calle Ficticia 12 # 5-30, Tocancipa',
           ST_SetSRID(ST_MakePoint(-73.9132, 4.9655), 4326)::geography, 'ACTIVE', now(), now()
         )
         RETURNING id`,
        [establishmentId],
      );
      branchId = String(branchIns.rows[0]?.id);

      for (let weekday = 1; weekday <= 7; weekday += 1) {
        await client.query(
          `INSERT INTO branch_hours (id, "branchId", weekday, "opensMinute", "closesMinute")
           VALUES (gen_random_uuid(), $1, $2, 0, 1439)`,
          [branchId, weekday],
        );
      }

      await client.query(
        `INSERT INTO restaurant_subscriptions (
           id, "restaurantId", "planId", "priceCop", status, "isCurrent", "periodStartsAt", "periodEndsAt", "updatedAt"
         ) VALUES (
           gen_random_uuid(), $1, $2, 0, 'TRIAL', true, now() - interval '1 day', now() + interval '13 days', now()
         )`,
        [restaurantId, planId],
      );
    } else {
      const branchQ = await client.query<{ id: string }>(
        `SELECT b.id
         FROM branches b
         JOIN establishments e ON e.id = b."establishmentId"
         WHERE e."restaurantId" = $1
         LIMIT 1`,
        [restaurantId],
      );
      branchId = branchQ.rows[0]?.id;
    }

    // 6. Dos clientes ficticios
    const client1UserId = await ensureUser(
      client,
      config.client1Email,
      "+573000005211",
      passwordHash,
    );
    await ensureConsent(client, client1UserId, termsLegalId, "TERMS_ACCEPTANCE", "WEB");
    await ensureConsent(client, client1UserId, privacyLegalId, "ACCOUNT", "WEB");

    const client2UserId = await ensureUser(
      client,
      config.client2Email,
      "+573000005212",
      passwordHash,
    );
    await ensureConsent(client, client2UserId, termsLegalId, "TERMS_ACCEPTANCE", "WEB");
    await ensureConsent(client, client2UserId, privacyLegalId, "ACCOUNT", "WEB");

    // 7. Dos domiciliarios aprobados con ubicación en Tocancipá
    const courier1 = await ensureSimCourier(client, {
      email: config.courier1Email,
      phoneE164: "+573000005221",
      passwordHash,
      docNumber: SIMULACRO_COURIER1_DOC,
      firstName: "Mateo",
      lastName: "Simulacro",
      plate: SIMULACRO_COURIER1_PLATE,
      longitude: -73.914,
      latitude: 4.966,
      docLegalId,
      gpsLegalId,
    });
    const courier2 = await ensureSimCourier(client, {
      email: config.courier2Email,
      phoneE164: "+573000005222",
      passwordHash,
      docNumber: SIMULACRO_COURIER2_DOC,
      firstName: "Lucia",
      lastName: "Simulacro",
      plate: SIMULACRO_COURIER2_PLATE,
      longitude: -73.915,
      latitude: 4.967,
      docLegalId,
      gpsLegalId,
    });

    await client.query("COMMIT");

    process.stdout.write(
      `${JSON.stringify(
        {
          seeded: true,
          marker: "sim-m52",
          adminEmail: config.adminEmail,
          ownerEmail: config.ownerEmail,
          client1Email: config.client1Email,
          client2Email: config.client2Email,
          courier1Email: config.courier1Email,
          courier2Email: config.courier2Email,
          restaurantId,
          branchId: branchId ?? "(existente)",
          courier1Id: courier1.courierId,
          courier2Id: courier2.courierId,
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
