const COORD_PAIR_RE = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s+([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/;
const SRID_PREFIX_RE = /^SRID\s*=\s*4326\s*;\s*/i;
const SIMPLE_POLYGON_RE = /^POLYGON\s*\(\(\s*([^()]+)\s*\)\)$/i;
const MULTIPOLYGON_WRAP_RE = /^MULTIPOLYGON\s*\(([\s\S]+)\)$/i;

export function isValidZonePolygonWkt(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return false;
  }
  const withoutSrid = trimmed.replace(SRID_PREFIX_RE, "").trim();
  if (withoutSrid === "" || /^SRID\s*=/i.test(withoutSrid)) {
    return false;
  }

  const simpleMatch = SIMPLE_POLYGON_RE.exec(withoutSrid);
  if (simpleMatch !== null) {
    const ringText = simpleMatch[1];
    return ringText !== undefined && isValidLinearRing(ringText);
  }

  const multiMatch = MULTIPOLYGON_WRAP_RE.exec(withoutSrid);
  if (multiMatch !== null) {
    const inner = multiMatch[1]?.trim() ?? "";
    return isValidMultiPolygonBody(inner);
  }

  return false;
}

function isValidMultiPolygonBody(body: string): boolean {
  const polygonBlocks = splitTopLevelGroups(body);
  if (polygonBlocks === null || polygonBlocks.length === 0) {
    return false;
  }
  for (const polyBlock of polygonBlocks) {
    if (!polyBlock.startsWith("(") || !polyBlock.endsWith(")")) {
      return false;
    }
    const rings = splitTopLevelGroups(polyBlock.slice(1, -1).trim());
    if (rings === null || rings.length === 0) {
      return false;
    }
    for (const ring of rings) {
      if (!ring.startsWith("(") || !ring.endsWith(")")) {
        return false;
      }
      const ringContent = ring.slice(1, -1);
      if (ringContent.includes("(") || ringContent.includes(")")) {
        return false;
      }
      if (!isValidLinearRing(ringContent)) {
        return false;
      }
    }
  }
  return true;
}

function splitTopLevelGroups(input: string): string[] | null {
  const groups: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === "(") {
      if (depth === 0) {
        if (start !== -1) {
          return null;
        }
        start = i;
      }
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth < 0) {
        return null;
      }
      if (depth === 0) {
        if (start === -1) {
          return null;
        }
        groups.push(input.slice(start, i + 1));
        start = -1;
      }
    } else if (depth === 0) {
      if (ch === ",") {
        if (groups.length === 0) {
          return null;
        }
      } else if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") {
        return null;
      }
    }
  }
  if (depth !== 0 || start !== -1) {
    return null;
  }
  const normalized = input.replace(/\s+/g, "");
  const expected = groups.map((g) => g.replace(/\s+/g, "")).join(",");
  if (normalized !== expected) {
    return null;
  }
  return groups;
}

function isValidLinearRing(ringText: string): boolean {
  const rawPoints = ringText.split(",");
  if (rawPoints.length < 4) {
    return false;
  }
  const points: Array<{ lng: number; lat: number }> = [];
  const distinct = new Set<string>();
  for (const rawPoint of rawPoints) {
    const match = COORD_PAIR_RE.exec(rawPoint.trim());
    if (match === null) {
      return false;
    }
    const lng = Number(match[1]);
    const lat = Number(match[2]);
    if (
      !Number.isFinite(lng) ||
      !Number.isFinite(lat) ||
      lng < -180 ||
      lng > 180 ||
      lat < -90 ||
      lat > 90
    ) {
      return false;
    }
    points.push({ lng, lat });
    distinct.add(`${String(lng)},${String(lat)}`);
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) {
    return false;
  }
  if (first.lng !== last.lng || first.lat !== last.lat) {
    return false;
  }
  return distinct.size >= 3;
}
