import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isPointInTocancipa,
  TOCANCIPA_COVERAGE_GEOJSON,
  TOCANCIPA_OUT_OF_ZONE_MESSAGE,
  TOCANCIPA_POLYGON_WKT,
  TOCANCIPA_ZONE_CODE,
  validateTocancipaCoverage,
} from "./tocancipa-coverage.js";

describe("cobertura geográfica oficial del municipio de Tocancipá (DIVIPOLA 25817)", () => {
  it("mantiene el archivo GeoJSON versionado sincronizado con la definición y metadatos DANE/OSM", () => {
    const filePath = join(dirname(fileURLToPath(import.meta.url)), "tocancipa-25817.geojson");
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    expect(parsed).toEqual(TOCANCIPA_COVERAGE_GEOJSON);
    expect(TOCANCIPA_COVERAGE_GEOJSON.properties.divipola).toBe("25817");
    expect(TOCANCIPA_COVERAGE_GEOJSON.properties.source).toMatch(/DANE|OpenStreetMap/);
    expect(TOCANCIPA_COVERAGE_GEOJSON.properties.license).toMatch(/CC BY 4\.0|ODbL/);
    expect(TOCANCIPA_POLYGON_WKT.startsWith("SRID=4326;MULTIPOLYGON(((")).toBe(true);
  });

  it("acepta puntos dentro del municipio de Tocancipá (parque principal y veredas)", () => {
    // Parque Principal de Tocancipá (cabecera municipal)
    expect(isPointInTocancipa({ longitude: -73.9132, latitude: 4.9655 })).toBe(true);
    expect(isPointInTocancipa({ longitude: -73.9111, latitude: 4.9661 })).toBe(true);
    expect(validateTocancipaCoverage({ longitude: -73.9132, latitude: 4.9655 })).toEqual({
      ok: true,
      zoneCode: TOCANCIPA_ZONE_CODE,
    });

    // Verganzo / Zona Industrial
    expect(isPointInTocancipa({ longitude: -73.92, latitude: 4.97 })).toBe(true);
    // Briceño / Parque Jaime Duque
    expect(isPointInTocancipa({ longitude: -73.935, latitude: 4.948 })).toBe(true);
    // Vereda La Fuente (norte de Tocancipá)
    expect(isPointInTocancipa({ longitude: -73.9132, latitude: 5.0105 })).toBe(true);
    // Vereda Canavita / La Esmeralda (oriente de Tocancipá)
    expect(isPointInTocancipa({ longitude: -73.88, latitude: 4.95 })).toBe(true);
  });

  it("rechaza puntos fuera de Tocancipá (Bogotá, Gachancipá y municipios vecinos) con mensaje claro", () => {
    // Bogotá D.C. (Plaza de Bolívar y Autopista Norte)
    const bogotaCentro = validateTocancipaCoverage({ longitude: -74.076, latitude: 4.5981 });
    expect(bogotaCentro).toEqual({
      ok: false,
      code: "OUT_OF_COVERAGE_ZONE",
      message: TOCANCIPA_OUT_OF_ZONE_MESSAGE,
    });
    expect(isPointInTocancipa({ longitude: -74.045, latitude: 4.75 })).toBe(false);

    // Gachancipá (Parque Principal 4°59′27″N 73°52′23″O y corredor urbano)
    const gachancipaParque = validateTocancipaCoverage({
      longitude: -73.8731,
      latitude: 4.9908,
    });
    expect(gachancipaParque).toEqual({
      ok: false,
      code: "OUT_OF_COVERAGE_ZONE",
      message: TOCANCIPA_OUT_OF_ZONE_MESSAGE,
    });
    expect(isPointInTocancipa({ longitude: -73.8847, latitude: 4.9804 })).toBe(false);

    // Otros municipios limítrofes (Sopó, Zipaquirá, Guatavita)
    expect(isPointInTocancipa({ longitude: -73.9403, latitude: 4.9081 })).toBe(false);
    expect(isPointInTocancipa({ longitude: -74.0014, latitude: 5.0247 })).toBe(false);
    expect(isPointInTocancipa({ longitude: -73.8344, latitude: 4.9267 })).toBe(false);
  });
});
