#!/usr/bin/env node
/**
 * Script reproducible para descargar y simplificar el polígono municipal de Tocancipá
 * desde OpenStreetMap (relation 1346513, DIVIPOLA 25817).
 *
 * Fuente:
 *   https://nominatim.openstreetmap.org/lookup?osm_ids=R1346513&format=json&polygon_geojson=1
 * Atribución y licencia:
 *   © OpenStreetMap contributors, ODbL 1.0, relation 1346513, simplificado tolerancia 0.0002°
 * Fecha de descarga documentada:
 *   2026-11-17
 * Algoritmo de simplificación:
 *   Douglas-Peucker con tolerancia 0.0002° (~22 m en el ecuador; reduce 742 → 131 vértices con <0.5% de diferencia de área)
 * Cálculo de área (area_km2):
 *   Calculado directamente sobre la geometría simplificada proyectada en EPSG:3116
 *   (MAGNA-SIRGAS / Colombia Bogotá zone, elipsoide GRS80).
 *
 * Uso:
 *   node scripts/geo/build-tocancipa-polygon.mjs [--input /ruta/opcional/osm_r1346513.json]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NOMINATIM_URL =
  "https://nominatim.openstreetmap.org/lookup?osm_ids=R1346513&format=json&polygon_geojson=1";
const USER_AGENT = "domigoo-dev/1.0";
const DOWNLOADED_AT = "2026-11-17";
const TOLERANCE_DEG = 0.0002;
const ATTRIBUTION =
  "© OpenStreetMap contributors, ODbL 1.0, relation 1346513, simplificado tolerancia 0.0002°";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const OUTPUT_GEOJSON_PATH = resolve(REPO_ROOT, "apps/api/src/geo/tocancipa-25817.geojson");

function sqSegDist(p, p1, p2) {
  let x = p1[0];
  let y = p1[1];
  let dx = p2[0] - x;
  let dy = p2[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = p2[0];
      y = p2[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

function simplifyDPStep(points, first, last, sqTolerance, simplified) {
  let maxSqDist = sqTolerance;
  let index = -1;
  for (let i = first + 1; i < last; i += 1) {
    const sqDist = sqSegDist(points[i], points[first], points[last]);
    if (sqDist > maxSqDist) {
      index = i;
      maxSqDist = sqDist;
    }
  }
  if (maxSqDist > sqTolerance && index !== -1) {
    if (index - first > 1) {
      simplifyDPStep(points, first, index, sqTolerance, simplified);
    }
    simplified.push(points[index]);
    if (last - index > 1) {
      simplifyDPStep(points, index, last, sqTolerance, simplified);
    }
  }
}

export function simplifyDouglasPeuckerRing(ring, toleranceDeg = TOLERANCE_DEG) {
  const sqTolerance = toleranceDeg * toleranceDeg;
  const simplified = [ring[0]];
  simplifyDPStep(ring, 0, ring.length - 1, sqTolerance, simplified);
  simplified.push(ring[ring.length - 1]);
  const rounded = simplified.map(([lon, lat]) => [
    Number(Number(lon).toFixed(6)),
    Number(Number(lat).toFixed(6)),
  ]);
  const first = rounded[0];
  const last = rounded[rounded.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    rounded.push([first[0], first[1]]);
  }
  return rounded;
}

/**
 * Proyección Transverse Mercator EPSG:3116 (MAGNA-SIRGAS / Colombia Bogotá zone).
 * Elipsoide GRS80: a = 6378137.0 m, f = 1 / 298.257222101
 * Origen: lat_0 = 4.596200416666666°, lon_0 = -74.07750791666666°, k_0 = 1.0,
 * False Easting = 1000000 m, False Northing = 1000000 m.
 */
export function projectEpsg3116([lonDeg, latDeg]) {
  const a = 6378137.0;
  const f = 1 / 298.257222101;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const k0 = 1.0;
  const lat0 = (4.596200416666666 * Math.PI) / 180;
  const lon0 = (-74.07750791666666 * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;

  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const tanLat = Math.tan(lat);
  const nVal = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const tVal = tanLat * tanLat;
  const cVal = ep2 * cosLat * cosLat;
  const aVal = cosLat * (lon - lon0);

  const meridionalArc = (phi) =>
    a *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * phi));

  const m0 = meridionalArc(lat0);
  const mp = meridionalArc(lat);

  const easting =
    1000000 +
    k0 *
      nVal *
      (aVal +
        ((1 - tVal + cVal) * Math.pow(aVal, 3)) / 6 +
        ((5 - 18 * tVal + tVal * tVal + 72 * cVal - 58 * ep2) * Math.pow(aVal, 5)) / 120);
  const northing =
    1000000 +
    k0 *
      (mp -
        m0 +
        nVal *
          tanLat *
          ((aVal * aVal) / 2 +
            ((5 - tVal + 9 * cVal + 4 * cVal * cVal) * Math.pow(aVal, 4)) / 24 +
            ((61 - 58 * tVal + tVal * tVal + 600 * cVal - 330 * ep2) * Math.pow(aVal, 6)) / 720));
  return [easting, northing];
}

export function calculateRingAreaKm2Epsg3116(ring) {
  const projected = ring.map(projectEpsg3116);
  let twiceAreaM2 = 0;
  for (let i = 0; i < projected.length - 1; i += 1) {
    const [x1, y1] = projected[i];
    const [x2, y2] = projected[i + 1];
    twiceAreaM2 += x1 * y2 - x2 * y1;
  }
  return Math.abs(twiceAreaM2) / 2 / 1e6;
}

export function computeRingBbox(ring) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

async function loadNominatimRelation(inputPath) {
  if (inputPath) {
    return JSON.parse(readFileSync(inputPath, "utf8"));
  }
  const response = await fetch(NOMINATIM_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Error descargando OSM relation 1346513: HTTP ${String(response.status)}`);
  }
  return response.json();
}

async function main() {
  const inputArgIndex = process.argv.indexOf("--input");
  const inputPath =
    inputArgIndex !== -1 && process.argv[inputArgIndex + 1]
      ? resolve(process.argv[inputArgIndex + 1])
      : undefined;

  const payload = await loadNominatimRelation(inputPath);
  const item = Array.isArray(payload) ? payload[0] : undefined;
  if (!item || item.osm_type !== "relation" || Number(item.osm_id) !== 1346513) {
    throw new Error("La respuesta no corresponde a OSM relation 1346513");
  }

  const rawGeoJson = item.geojson;
  const rawRing =
    rawGeoJson.type === "Polygon"
      ? rawGeoJson.coordinates[0]
      : rawGeoJson.type === "MultiPolygon"
        ? rawGeoJson.coordinates[0][0]
        : undefined;
  if (!Array.isArray(rawRing) || rawRing.length < 4) {
    throw new Error("Geometría inválida en OSM relation 1346513");
  }

  const simplifiedRing = simplifyDouglasPeuckerRing(rawRing, TOLERANCE_DEG);
  const rawAreaKm2 = calculateRingAreaKm2Epsg3116(rawRing);
  const simplifiedAreaKm2 = Number(calculateRingAreaKm2Epsg3116(simplifiedRing).toFixed(2));
  const areaDiffPct = Math.abs((simplifiedAreaKm2 - rawAreaKm2) / rawAreaKm2) * 100;
  const bbox = computeRingBbox(simplifiedRing);

  const feature = {
    type: "Feature",
    id: "CO-CUN-25817",
    bbox,
    properties: {
      divipola: "25817",
      dpto_ccdgo: "25",
      mpio_ccdgo: "817",
      name: "Tocancipá",
      department: "Cundinamarca",
      country: "CO",
      osm_relation_id: 1346513,
      wikidata: "Q1442348",
      downloaded_at: DOWNLOADED_AT,
      simplification_algorithm: "Douglas-Peucker",
      simplification_tolerance_deg: TOLERANCE_DEG,
      raw_vertex_count: rawRing.length,
      vertex_count: simplifiedRing.length,
      area_projection: "EPSG:3116",
      area_km2: simplifiedAreaKm2,
      source: ATTRIBUTION,
      license: "Open Database License (ODbL 1.0) — https://opendatacommons.org/licenses/odbl/",
    },
    geometry: {
      type: "MultiPolygon",
      coordinates: [[simplifiedRing]],
    },
  };

  writeFileSync(OUTPUT_GEOJSON_PATH, `${JSON.stringify(feature, null, 2)}\n`, "utf8");

  process.stdout.write(
    `${JSON.stringify(
      {
        output: OUTPUT_GEOJSON_PATH,
        source: ATTRIBUTION,
        downloadedAt: DOWNLOADED_AT,
        toleranceDeg: TOLERANCE_DEG,
        rawVertices: rawRing.length,
        simplifiedVertices: simplifiedRing.length,
        rawAreaKm2: Number(rawAreaKm2.toFixed(4)),
        areaKm2: simplifiedAreaKm2,
        areaDiffPct: Number(areaDiffPct.toFixed(4)),
        bbox,
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
