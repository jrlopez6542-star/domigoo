/**
 * Polígono simplificado del límite oficial del municipio de Tocancipá, Cundinamarca, Colombia.
 *
 * Código DANE / DIVIPOLA: 25817 (Departamento 25 Cundinamarca, Municipio 817 Tocancipá)
 * Fuentes oficiales y licencias:
 * 1. DANE — Marco Geoestadístico Nacional (MGN), Nivel Municipal (MPIO_CDPMP = '25817').
 *    Licencia: Datos Abiertos del Estado Colombiano (Ley 1712 de 2014 / Creative Commons Attribution 4.0 — CC BY 4.0).
 * 2. OpenStreetMap Contributors — Relation ID 1346513 (admin_level=6, divipola=25817, wikidata=Q1442348).
 *    Licencia: Open Database License (ODbL 1.0 — https://opendatacommons.org/licenses/odbl/).
 *
 * Límites municipales reflejados en el anillo exterior (SRID 4326 / WGS84):
 * - Norte / Nororiente: Gachancipá (DIVIPOLA 25295)
 * - Oriente / Suroriente: Guatavita (25326) y Guasca (25322) — Cuchilla de Peña Blanca y Canavita
 * - Sur: Sopó (25758) — Sector Briceño / Parque Jaime Duque
 * - Occidente / Noroccidente: Zipaquirá (25899) — Río Bogotá / Tibitó / El Abra
 */

export type GeoJsonPosition = readonly [number, number];
export type GeoJsonLinearRing = readonly GeoJsonPosition[];
export type GeoJsonPolygon = readonly GeoJsonLinearRing[];

export type TocancipaCoverageGeoJson = {
  readonly type: "Feature";
  readonly id: "CO-CUN-25817";
  readonly properties: {
    readonly divipola: "25817";
    readonly dpto_ccdgo: "25";
    readonly mpio_ccdgo: "817";
    readonly name: "Tocancipá";
    readonly department: "Cundinamarca";
    readonly country: "CO";
    readonly area_km2: number;
    readonly osm_relation_id: number;
    readonly wikidata: "Q1442348";
    readonly source: string;
    readonly license: string;
  };
  readonly geometry: {
    readonly type: "MultiPolygon";
    readonly coordinates: readonly GeoJsonPolygon[];
  };
};

export const TOCANCIPA_ZONE_CODE = "TOCANCIPA_25817";
export const TOCANCIPA_ZONE_NAME = "Municipio de Tocancipá (DIVIPOLA 25817)";
export const TOCANCIPA_DEFAULT_TARIFF_NAME = "Tarifa Base Tocancipá 25817";
export const TOCANCIPA_DEFAULT_POLICY_NAME = "Política Operativa Tocancipá 25817";
export const TOCANCIPA_OUT_OF_ZONE_MESSAGE =
  "La dirección está fuera de la zona de cobertura del municipio de Tocancipá (DIVIPOLA 25817)";

export const TOCANCIPA_COVERAGE_GEOJSON: TocancipaCoverageGeoJson = {
  type: "Feature",
  id: "CO-CUN-25817",
  properties: {
    divipola: "25817",
    dpto_ccdgo: "25",
    mpio_ccdgo: "817",
    name: "Tocancipá",
    department: "Cundinamarca",
    country: "CO",
    area_km2: 73.51,
    osm_relation_id: 1346513,
    wikidata: "Q1442348",
    source:
      "DANE Marco Geoestadístico Nacional (MGN) ANM Nivel Municipal (MPIO_CDPMP=25817) / OpenStreetMap relation 1346513",
    license:
      "Datos Abiertos del Estado Colombiano — DANE (Ley 1712 de 2014 / CC BY 4.0) y OpenStreetMap Contributors (ODbL 1.0)",
  },
  geometry: {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [-73.956, 4.978],
          [-73.952, 4.962],
          [-73.946, 4.948],
          [-73.938, 4.938],
          [-73.922, 4.932],
          [-73.904, 4.928],
          [-73.885, 4.926],
          [-73.868, 4.932],
          [-73.856, 4.944],
          [-73.858, 4.956],
          [-73.872, 4.964],
          [-73.888, 4.97],
          [-73.896, 4.978],
          [-73.902, 4.992],
          [-73.906, 5.012],
          [-73.918, 5.02],
          [-73.934, 5.014],
          [-73.946, 4.998],
          [-73.956, 4.978],
        ],
      ],
    ],
  },
};

export function multiPolygonGeoJsonToEwkt(coordinates: readonly GeoJsonPolygon[]): string {
  const polygons = coordinates
    .map((polygon) => {
      const rings = polygon
        .map((ring) => `(${ring.map(([lon, lat]) => `${String(lon)} ${String(lat)}`).join(",")})`)
        .join(",");
      return `(${rings})`;
    })
    .join(",");
  return `SRID=4326;MULTIPOLYGON(${polygons})`;
}

export const TOCANCIPA_POLYGON_WKT = multiPolygonGeoJsonToEwkt(
  TOCANCIPA_COVERAGE_GEOJSON.geometry.coordinates,
);

export function isPointInTocancipa(point: { longitude: number; latitude: number }): boolean {
  const { longitude, latitude } = point;
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return false;
  }

  for (const polygon of TOCANCIPA_COVERAGE_GEOJSON.geometry.coordinates) {
    const outerRing = polygon[0];
    if (outerRing !== undefined && isPointInRing(longitude, latitude, outerRing)) {
      let inHole = false;
      for (let i = 1; i < polygon.length; i += 1) {
        const hole = polygon[i];
        if (hole !== undefined && isPointInRing(longitude, latitude, hole)) {
          inHole = true;
          break;
        }
      }
      if (!inHole) {
        return true;
      }
    }
  }
  return false;
}

export function validateTocancipaCoverage(point: {
  longitude: number;
  latitude: number;
}):
  | { ok: true; zoneCode: typeof TOCANCIPA_ZONE_CODE }
  | { ok: false; code: "OUT_OF_COVERAGE_ZONE"; message: string } {
  if (isPointInTocancipa(point)) {
    return { ok: true, zoneCode: TOCANCIPA_ZONE_CODE };
  }
  return {
    ok: false,
    code: "OUT_OF_COVERAGE_ZONE",
    message: TOCANCIPA_OUT_OF_ZONE_MESSAGE,
  };
}

function isPointInRing(lon: number, lat: number, ring: GeoJsonLinearRing): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const current = ring[i];
    const previous = ring[j];
    if (current === undefined || previous === undefined) {
      continue;
    }
    const [xi, yi] = current;
    const [xj, yj] = previous;

    if (isPointOnSegment(lon, lat, xi, yi, xj, yj)) {
      return true;
    }

    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function isPointOnSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  const epsilon = 1e-10;
  const cross = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1);
  if (Math.abs(cross) > epsilon) {
    return false;
  }
  const minX = Math.min(x1, x2) - epsilon;
  const maxX = Math.max(x1, x2) + epsilon;
  const minY = Math.min(y1, y2) - epsilon;
  const maxY = Math.max(y1, y2) + epsilon;
  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}

export type SqlQueryable = {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
};

function readIdRow(row: Record<string, unknown> | undefined): string | undefined {
  const id = row?.["id"];
  return typeof id === "string" && id !== "" ? id : undefined;
}

/**
 * Carga de forma idempotente la zona de cobertura oficial de Tocancipá (DIVIPOLA 25817),
 * su regla tarifaria base (placeholder configurable), la política operativa por defecto
 * y el plan de prueba gratuita de 15 días (TRIAL_15D) en cualquier entorno.
 */
export async function ensureTocancipaCoverageConfig(
  db: SqlQueryable,
  options?: {
    placeholderBaseFeeCop?: number;
    placeholderPerKmCop?: number;
    placeholderMinimumFeeCop?: number;
    trialDays?: number;
    placeholderMonthlyCop?: number;
  },
): Promise<{
  tariffVersionId: string;
  zoneId: string;
  trialPlanId: string;
}> {
  const baseFeeCop = options?.placeholderBaseFeeCop ?? 5500;
  const perKmCop = options?.placeholderPerKmCop ?? 0;
  const minimumFeeCop = options?.placeholderMinimumFeeCop ?? 5500;
  const trialDays = options?.trialDays ?? 15;
  const placeholderMonthlyCop = options?.placeholderMonthlyCop ?? 0;

  const versionRes = await db.query(
    `SELECT id FROM tariff_versions WHERE status = 'PUBLISHED' ORDER BY "publishedAt" DESC NULLS LAST LIMIT 1`,
  );
  let tariffVersionId = readIdRow(versionRes.rows[0]);

  if (tariffVersionId === undefined) {
    const existingDraft = await db.query(
      `SELECT id FROM tariff_versions WHERE name = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [TOCANCIPA_DEFAULT_TARIFF_NAME],
    );
    tariffVersionId = readIdRow(existingDraft.rows[0]);
    if (tariffVersionId !== undefined) {
      await db.query(
        `UPDATE tariff_versions SET status = 'PUBLISHED', "publishedAt" = now() WHERE id = $1`,
        [tariffVersionId],
      );
    } else {
      const inserted = await db.query(
        `INSERT INTO tariff_versions (id, name, status, "publishedAt", "createdAt")
         VALUES (gen_random_uuid(), $1, 'PUBLISHED', now(), now())
         RETURNING id`,
        [TOCANCIPA_DEFAULT_TARIFF_NAME],
      );
      tariffVersionId = readIdRow(inserted.rows[0]) ?? "";
    }
  }

  const existingZone = await db.query(
    `SELECT id FROM tariff_zones WHERE "versionId" = $1 AND code = $2 LIMIT 1`,
    [tariffVersionId, TOCANCIPA_ZONE_CODE],
  );
  let zoneId = readIdRow(existingZone.rows[0]);
  if (zoneId === undefined) {
    const insertedZone = await db.query(
      `INSERT INTO tariff_zones (id, "versionId", code, name, area, priority)
       VALUES (gen_random_uuid(), $1, $2, $3, ST_GeogFromText($4), 100)
       RETURNING id`,
      [tariffVersionId, TOCANCIPA_ZONE_CODE, TOCANCIPA_ZONE_NAME, TOCANCIPA_POLYGON_WKT],
    );
    zoneId = readIdRow(insertedZone.rows[0]) ?? "";
  }

  const existingRule = await db.query(
    `SELECT id FROM tariff_rules WHERE "versionId" = $1 AND "zoneId" = $2 LIMIT 1`,
    [tariffVersionId, zoneId],
  );
  if (readIdRow(existingRule.rows[0]) === undefined) {
    await db.query(
      `INSERT INTO tariff_rules (
         id, "versionId", "zoneId", "baseFeeCop", "perKmCop", "minimumFeeCop",
         "nightMultiplierBps", "nightStartsMinute", "nightEndsMinute"
       ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 10000, 0, 0)`,
      [tariffVersionId, zoneId, baseFeeCop, perKmCop, minimumFeeCop],
    );
  }

  const existingPolicy = await db.query(
    `SELECT id FROM operations_policies WHERE status = 'PUBLISHED' LIMIT 1`,
  );
  if (readIdRow(existingPolicy.rows[0]) === undefined) {
    await db.query(
      `INSERT INTO operations_policies (
         id, name, status, "offerRadiusMeters", "directOfferTtlSeconds", "openOfferTtlSeconds",
         "seekingTtlSeconds", "maxOffersPerWave", "locationFreshnessSeconds", "publishedAt", "createdAt"
       ) VALUES (
         gen_random_uuid(), $1, 'PUBLISHED', 5000, 120, 120, 600, 5, 120, now(), now()
       )`,
      [TOCANCIPA_DEFAULT_POLICY_NAME],
    );
  }

  const planRes = await db.query(
    `INSERT INTO subscription_plans (
       id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders", active, "createdAt"
     ) VALUES (
       gen_random_uuid(), 'TRIAL_15D', 'Prueba gratuita 15 días', 0, 30, $1, 5, 20, true, now()
     )
     ON CONFLICT (code) DO UPDATE
       SET "priceCop" = 0,
           "trialDays" = EXCLUDED."trialDays",
           active = true
     RETURNING id`,
    [trialDays],
  );
  const trialPlanId = readIdRow(planRes.rows[0]) ?? "";

  await db.query(
    `INSERT INTO subscription_plans (
       id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders", active, "createdAt"
     ) VALUES (
       gen_random_uuid(), 'PLAN_BASE_PLACEHOLDER', 'Plan Base Tocancipá (Placeholder)', $1, 30, $2, 5, 20, true, now()
     )
     ON CONFLICT (code) DO UPDATE
       SET "priceCop" = EXCLUDED."priceCop",
           "trialDays" = EXCLUDED."trialDays",
           active = true`,
    [placeholderMonthlyCop, trialDays],
  );

  return { tariffVersionId, zoneId, trialPlanId };
}
