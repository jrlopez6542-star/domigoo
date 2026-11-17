import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateMultiPolygonAreaKm2Epsg3116,
  computeMultiPolygonBbox,
  isPointInTocancipa,
  TOCANCIPA_COVERAGE_GEOJSON,
  TOCANCIPA_OUT_OF_ZONE_MESSAGE,
  TOCANCIPA_POLYGON_WKT,
  TOCANCIPA_ZONE_CODE,
  validateTocancipaCoverage,
} from "./tocancipa-coverage.js";

describe("cobertura geográfica oficial del municipio de Tocancipá (DIVIPOLA 25817)", () => {
  it("mantiene el archivo GeoJSON versionado sincronizado con la geometría real de OpenStreetMap relation 1346513", () => {
    const filePath = join(dirname(fileURLToPath(import.meta.url)), "tocancipa-25817.geojson");
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    expect(parsed).toEqual(TOCANCIPA_COVERAGE_GEOJSON);
    expect(TOCANCIPA_COVERAGE_GEOJSON.properties.divipola).toBe("25817");
    expect(TOCANCIPA_COVERAGE_GEOJSON.properties.osm_relation_id).toBe(1346513);
    expect(TOCANCIPA_COVERAGE_GEOJSON.properties.source).toBe(
      "© OpenStreetMap contributors, ODbL 1.0, relation 1346513, simplificado tolerancia 0.0002°",
    );
    expect(TOCANCIPA_COVERAGE_GEOJSON.properties.source).not.toMatch(/DANE/i);
    expect(TOCANCIPA_COVERAGE_GEOJSON.properties.license).toMatch(/ODbL 1\.0/);
    expect(TOCANCIPA_COVERAGE_GEOJSON.properties.vertex_count).toBe(131);
    expect(TOCANCIPA_POLYGON_WKT.startsWith("SRID=4326;MULTIPOLYGON(((")).toBe(true);
  });

  it("verifica que el bbox está dentro de lat 4.91–5.04 y lon -73.995 a -73.870 y el área métrica EPSG:3116 entre 68 y 72 km²", () => {
    const [minLon, minLat, maxLon, maxLat] = computeMultiPolygonBbox(
      TOCANCIPA_COVERAGE_GEOJSON.geometry.coordinates,
    );
    expect(TOCANCIPA_COVERAGE_GEOJSON.bbox).toEqual([minLon, minLat, maxLon, maxLat]);
    expect(minLon).toBeGreaterThanOrEqual(-73.995);
    expect(maxLon).toBeLessThanOrEqual(-73.87);
    expect(minLat).toBeGreaterThanOrEqual(4.91);
    expect(maxLat).toBeLessThanOrEqual(5.04);

    const calculatedAreaKm2 = calculateMultiPolygonAreaKm2Epsg3116(
      TOCANCIPA_COVERAGE_GEOJSON.geometry.coordinates,
    );
    expect(TOCANCIPA_COVERAGE_GEOJSON.properties.area_km2).toBe(calculatedAreaKm2);
    expect(calculatedAreaKm2).toBeGreaterThanOrEqual(68);
    expect(calculatedAreaKm2).toBeLessThanOrEqual(72);
  });

  it("acepta puntos dentro del municipio de Tocancipá (Parque Principal, occidente real y veredas)", () => {
    // Parque Principal de Tocancipá (cabecera municipal: 4.9653, -73.9131)
    expect(isPointInTocancipa({ longitude: -73.9131, latitude: 4.9653 })).toBe(true);
    expect(isPointInTocancipa({ longitude: -73.9132, latitude: 4.9655 })).toBe(true);
    expect(validateTocancipaCoverage({ longitude: -73.9131, latitude: 4.9653 })).toEqual({
      ok: true,
      zoneCode: TOCANCIPA_ZONE_CODE,
    });

    // Punto occidental real del municipio (Tibitó / El Abra: lat 4.985, lon -73.975)
    expect(isPointInTocancipa({ longitude: -73.975, latitude: 4.985 })).toBe(true);
    expect(validateTocancipaCoverage({ longitude: -73.975, latitude: 4.985 })).toEqual({
      ok: true,
      zoneCode: TOCANCIPA_ZONE_CODE,
    });

    // Verganzo / Zona Industrial
    expect(isPointInTocancipa({ longitude: -73.918, latitude: 4.956 })).toBe(true);
    // Briceño / Parque Jaime Duque
    expect(isPointInTocancipa({ longitude: -73.9275, latitude: 4.9482 })).toBe(true);
    // Vereda La Fuente (norte de Tocancipá)
    expect(isPointInTocancipa({ longitude: -73.912, latitude: 4.992 })).toBe(true);
    // Vereda Canavita / La Esmeralda (oriente de Tocancipá)
    expect(isPointInTocancipa({ longitude: -73.896, latitude: 4.948 })).toBe(true);
  });

  it("rechaza puntos fuera de Tocancipá (Gachancipá, Sopó, Zipaquirá, Bogotá y punto oriental externo) con mensaje claro", () => {
    // Gachancipá casco urbano (4.991, -73.873)
    const gachancipaCasco = validateTocancipaCoverage({
      longitude: -73.873,
      latitude: 4.991,
    });
    expect(gachancipaCasco).toEqual({
      ok: false,
      code: "OUT_OF_COVERAGE_ZONE",
      message: TOCANCIPA_OUT_OF_ZONE_MESSAGE,
    });

    // Sopó (4.9081, -73.9403)
    expect(isPointInTocancipa({ longitude: -73.9403, latitude: 4.9081 })).toBe(false);

    // Zipaquirá casco urbano (5.0221, -74.0044)
    expect(isPointInTocancipa({ longitude: -74.0044, latitude: 5.0221 })).toBe(false);

    // Bogotá D.C. (4.5981, -74.076)
    const bogotaCentro = validateTocancipaCoverage({ longitude: -74.076, latitude: 4.5981 });
    expect(bogotaCentro).toEqual({
      ok: false,
      code: "OUT_OF_COVERAGE_ZONE",
      message: TOCANCIPA_OUT_OF_ZONE_MESSAGE,
    });

    // Punto oriental fuera del municipio (4.95, -73.860)
    const orienteFuera = validateTocancipaCoverage({ longitude: -73.86, latitude: 4.95 });
    expect(orienteFuera).toEqual({
      ok: false,
      code: "OUT_OF_COVERAGE_ZONE",
      message: TOCANCIPA_OUT_OF_ZONE_MESSAGE,
    });
  });
});
