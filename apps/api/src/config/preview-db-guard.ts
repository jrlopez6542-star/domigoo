// Guard de aislamiento de base de datos para Vercel Preview.
// PREVIEW-DB-ISOLATION-002 (diseño base) y PREVIEW-DB-ISOLATION-003 (endurecimiento).
//
// Regla: si no se puede demostrar que DATABASE_URL y DATABASE_URL_UNPOOLED apuntan a la
// base Preview autorizada explícitamente, el proceso se detiene. Los mensajes de error
// solo nombran variables; nunca incluyen URL, usuario, contraseña ni host.
//
// El guard valida la cadena exacta que reciben pg (pg-connection-string) y Prisma. Por eso
// rechaza todo lo que esos parsers interpretan distinto de WHATWG URL: parámetros de
// consulta que cambian destino (host=, hostaddr=, port=, user=, options=...), varios hosts,
// sockets, espacios o caracteres de control, fragmentos y nombres percent-encoded.

export type ParsedPostgresTarget = {
  readonly host: string;
  readonly port: string;
  readonly database: string;
  readonly user: string;
  readonly endpointId: string | null;
  readonly neonDomain: string | null;
  readonly passwordRoutesEndpoint: boolean;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

// Únicos parámetros de consulta aceptados: ninguno cambia host, puerto, base, usuario ni
// el endpoint Neon en pg ni en Prisma, y ninguno lee archivos del disco.
const ALLOWED_QUERY_PARAMS = new Set([
  "sslmode",
  "channel_binding",
  "connect_timeout",
  "application_name",
  "pgbouncer",
]);

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const IPV6_HOST = /^\[[0-9a-f:.]+\]$/;
const DATABASE_PATH = /^\/([A-Za-z0-9_-]{1,63})$/;
const ENDPOINT_ID = /^ep-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NEON_SUFFIX = ".neon.tech";
const POOLER_SUFFIX = "-pooler";

export function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return LOOPBACK_HOSTS.has(normalized);
}

// Devuelve el ID del endpoint Neon (ep-..., sin -pooler) solo si el host completo tiene la
// forma <ep-id>[-pooler].<etiquetas>.neon.tech. Cualquier otra forma devuelve null.
export function extractNeonEndpointId(host: string): string | null {
  return parseNeonHost(host)?.endpointId ?? null;
}

function parseNeonHost(host: string): { endpointId: string; domain: string } | null {
  const normalized = host.toLowerCase();
  if (!normalized.endsWith(NEON_SUFFIX)) {
    return null;
  }
  const labels = normalized.split(".");
  if (labels.length < 4 || !labels.every((label) => HOST_LABEL.test(label))) {
    return null;
  }
  const firstLabel = labels[0] ?? "";
  const endpointId = firstLabel.endsWith(POOLER_SUFFIX)
    ? firstLabel.slice(0, -POOLER_SUFFIX.length)
    : firstLabel;
  if (!ENDPOINT_ID.test(endpointId) || endpointId.endsWith(POOLER_SUFFIX)) {
    return null;
  }
  return { endpointId, domain: labels.slice(1).join(".") };
}

function isValidHost(host: string): boolean {
  if (IPV6_HOST.test(host)) {
    return true;
  }
  const labels = host.split(".");
  return labels.length > 0 && labels.every((label) => HOST_LABEL.test(label));
}

export function parsePostgresTarget(
  rawUrl: string | undefined,
  varName: string,
): ParsedPostgresTarget {
  const raw = rawUrl ?? "";
  if (raw.trim() === "") {
    throw new Error(`PREVIEW_DB_GUARD: ${varName} es obligatoria`);
  }
  // WHATWG URL elimina tabuladores y saltos de línea en silencio y recorta espacios;
  // pg y la shell no siempre hacen lo mismo. Cualquier espacio o control se rechaza.
  if (hasSpaceOrControl(raw) || raw.includes("#")) {
    throw new Error(
      `PREVIEW_DB_GUARD: ${varName} contiene espacios, caracteres de control o un fragmento`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`PREVIEW_DB_GUARD: ${varName} no es una URL válida`);
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`PREVIEW_DB_GUARD: ${varName} debe usar esquema postgres:// o postgresql://`);
  }

  const seen = new Set<string>();
  for (const key of parsed.searchParams.keys()) {
    if (!ALLOWED_QUERY_PARAMS.has(key) || seen.has(key)) {
      throw new Error(
        `PREVIEW_DB_GUARD: ${varName} usa un parámetro de conexión no permitido o repetido (solo ${[
          ...ALLOWED_QUERY_PARAMS,
        ].join(", ")})`,
      );
    }
    seen.add(key);
  }

  const host = parsed.hostname.toLowerCase();
  const user = parsed.username === "" ? "" : safeDecode(parsed.username);
  const databaseMatch = DATABASE_PATH.exec(parsed.pathname);

  if (host === "" || user === "" || parsed.pathname === "" || parsed.pathname === "/") {
    throw new Error(
      `PREVIEW_DB_GUARD: ${varName} está incompleta (requiere host, usuario y nombre de base de datos)`,
    );
  }
  if (!isValidHost(host)) {
    throw new Error(`PREVIEW_DB_GUARD: ${varName} tiene un host no permitido`);
  }
  if (databaseMatch === null) {
    throw new Error(
      `PREVIEW_DB_GUARD: ${varName} tiene un nombre de base de datos no permitido (solo letras, números, _ y -)`,
    );
  }

  const password = parsed.password === "" ? "" : safeDecode(parsed.password);
  const neon = parseNeonHost(host);

  return {
    host,
    port: parsed.port === "" ? "5432" : parsed.port,
    database: databaseMatch[1] ?? "",
    user,
    endpointId: neon?.endpointId ?? null,
    neonDomain: neon?.domain ?? null,
    passwordRoutesEndpoint: /^endpoint=/i.test(password),
  };
}

function hasSpaceOrControl(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || /\s/u.test(char)) {
      return true;
    }
  }
  return false;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("PREVIEW_DB_GUARD: la URL tiene una codificación inválida");
  }
}

function parseEndpointList(raw: string | undefined, varName: string): string[] {
  const items = (raw ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "");
  for (const item of items) {
    if (!ENDPOINT_ID.test(item) || item.endsWith(POOLER_SUFFIX)) {
      throw new Error(
        `PREVIEW_DB_GUARD: ${varName} tiene un formato inválido (IDs ep-... separados por coma, sin -pooler ni dominio)`,
      );
    }
  }
  return items;
}

// El guard estricto se aplica cuando VERCEL_ENV es preview (con cualquier mayúscula o
// espacio) y también ante cualquier valor no canónico. Solo "production", "development",
// vacío o ausente conservan exactamente el comportamiento anterior.
export function isPreviewDatabaseGuardActive(env: NodeJS.ProcessEnv): boolean {
  const raw = env["VERCEL_ENV"];
  if (raw === undefined || raw === "" || raw === "production" || raw === "development") {
    return false;
  }
  return true;
}

function assertSinglePreviewTarget(
  target: ParsedPostgresTarget,
  varName: string,
  allowedEndpoints: string[],
  forbiddenEndpoints: string[],
  expectedName: string,
): void {
  if (target.endpointId === null || target.neonDomain === null) {
    throw new Error(
      `PREVIEW_DB_GUARD: ${varName} no tiene un host de endpoint Neon válido (<ep-id>[-pooler].<región>.neon.tech)`,
    );
  }
  if (forbiddenEndpoints.includes(target.endpointId)) {
    throw new Error(
      `PREVIEW_DB_GUARD: ${varName} apunta a un endpoint prohibido (PREVIEW_DB_FORBIDDEN_ENDPOINTS)`,
    );
  }
  if (!allowedEndpoints.includes(target.endpointId)) {
    throw new Error(
      `PREVIEW_DB_GUARD: ${varName} no coincide con ningún endpoint en PREVIEW_DB_ALLOWED_ENDPOINTS`,
    );
  }
  if (target.database !== expectedName) {
    throw new Error(`PREVIEW_DB_GUARD: ${varName} no coincide con PREVIEW_DB_EXPECTED_NAME`);
  }
  if (target.passwordRoutesEndpoint) {
    throw new Error(
      `PREVIEW_DB_GUARD: ${varName} usa enrutamiento Neon por contraseña (endpoint=), no permitido`,
    );
  }
}

export function assertPreviewDatabaseAuthorized(
  env: NodeJS.ProcessEnv,
  options: { requireUnpooled?: boolean } = {},
): void {
  if (!isPreviewDatabaseGuardActive(env)) {
    return;
  }
  if (env["VERCEL_ENV"]?.trim().toLowerCase() !== "preview") {
    throw new Error(
      "PREVIEW_DB_GUARD: VERCEL_ENV tiene un valor no reconocido; solo production, preview o development",
    );
  }

  const allowedEndpoints = parseEndpointList(
    env["PREVIEW_DB_ALLOWED_ENDPOINTS"],
    "PREVIEW_DB_ALLOWED_ENDPOINTS",
  );
  if (allowedEndpoints.length === 0) {
    throw new Error(
      "PREVIEW_DB_GUARD: PREVIEW_DB_ALLOWED_ENDPOINTS es obligatoria y no puede estar vacía en Preview",
    );
  }

  const expectedName = env["PREVIEW_DB_EXPECTED_NAME"]?.trim() ?? "";
  if (expectedName === "") {
    throw new Error("PREVIEW_DB_GUARD: PREVIEW_DB_EXPECTED_NAME es obligatoria en Preview");
  }
  if (DATABASE_PATH.exec(`/${expectedName}`) === null) {
    throw new Error(
      "PREVIEW_DB_GUARD: PREVIEW_DB_EXPECTED_NAME tiene un formato inválido (solo letras, números, _ y -)",
    );
  }

  const forbiddenEndpoints = parseEndpointList(
    env["PREVIEW_DB_FORBIDDEN_ENDPOINTS"],
    "PREVIEW_DB_FORBIDDEN_ENDPOINTS",
  );
  if (allowedEndpoints.some((endpoint) => forbiddenEndpoints.includes(endpoint))) {
    throw new Error(
      "PREVIEW_DB_GUARD: un endpoint aparece a la vez en PREVIEW_DB_ALLOWED_ENDPOINTS y PREVIEW_DB_FORBIDDEN_ENDPOINTS",
    );
  }

  // pg envía PGOPTIONS al servidor (Neon enruta con options=endpoint=...) y usa PGPORT
  // cuando la URL no trae puerto. Prisma no lee variables PG*.
  if ((env["PGOPTIONS"] ?? "").trim() !== "") {
    throw new Error("PREVIEW_DB_GUARD: PGOPTIONS no está permitida en Preview");
  }

  const pooled = parsePostgresTarget(env["DATABASE_URL"], "DATABASE_URL");
  assertSinglePreviewTarget(
    pooled,
    "DATABASE_URL",
    allowedEndpoints,
    forbiddenEndpoints,
    expectedName,
  );
  assertPgPortConsistent(env, pooled);

  const rawUnpooled = env["DATABASE_URL_UNPOOLED"] ?? "";
  if (options.requireUnpooled === true || rawUnpooled !== "") {
    const unpooled = parsePostgresTarget(env["DATABASE_URL_UNPOOLED"], "DATABASE_URL_UNPOOLED");
    assertSinglePreviewTarget(
      unpooled,
      "DATABASE_URL_UNPOOLED",
      allowedEndpoints,
      forbiddenEndpoints,
      expectedName,
    );
    assertPgPortConsistent(env, unpooled);

    if (
      unpooled.endpointId !== pooled.endpointId ||
      unpooled.neonDomain !== pooled.neonDomain ||
      unpooled.database !== pooled.database ||
      unpooled.user !== pooled.user ||
      unpooled.port !== pooled.port
    ) {
      throw new Error(
        "PREVIEW_DB_GUARD: DATABASE_URL y DATABASE_URL_UNPOOLED no corresponden a la misma base lógica autorizada",
      );
    }
  }
}

function assertPgPortConsistent(env: NodeJS.ProcessEnv, target: ParsedPostgresTarget): void {
  const pgPort = (env["PGPORT"] ?? "").trim();
  if (pgPort !== "" && pgPort !== target.port) {
    throw new Error("PREVIEW_DB_GUARD: PGPORT no coincide con el puerto de la URL autorizada");
  }
}

// Guard del build de Preview (scripts/vercel-build.sh). Exige ambas URLs y se niega a
// correr si VERCEL_ENV no es preview, para que nunca pase en silencio.
export function assertPreviewBuildDatabases(env: NodeJS.ProcessEnv): void {
  if (env["VERCEL_ENV"]?.trim().toLowerCase() !== "preview") {
    throw new Error("PREVIEW_DB_GUARD: el guard de build solo se ejecuta con VERCEL_ENV=preview");
  }
  assertPreviewDatabaseAuthorized(env, { requireUnpooled: true });
}
