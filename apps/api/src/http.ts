import type { INestApplication } from "@nestjs/common";

type SecurityRequest = {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
};

type SecurityResponse = {
  setHeader: (name: string, value: string) => void;
  removeHeader?: (name: string) => void;
  statusCode?: number;
  end?: () => void;
};

type ExpressInstanceLike = {
  disable?: (setting: string) => void;
};

export function parseAllowedOrigins(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== ""),
  );
}

export function applyHttpSecurity(
  app: INestApplication,
  corsOriginsRaw = process.env["CORS_ORIGINS"],
): void {
  const adapter = app.getHttpAdapter() as { getInstance?: () => ExpressInstanceLike } | undefined;
  const instance = adapter?.getInstance?.();
  instance?.disable?.("x-powered-by");

  const allowedOrigins = parseAllowedOrigins(corsOriginsRaw);

  app.use((request: SecurityRequest, response: SecurityResponse, next: () => void) => {
    response.removeHeader?.("X-Powered-By");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");

    const originHeader = request.headers?.["origin"];
    const origin = typeof originHeader === "string" ? originHeader.trim() : "";
    const url = typeof request.url === "string" ? request.url : "";
    const isPublicTracking = url.startsWith("/v1/tracking/") || url === "/v1/tracking";

    if (origin !== "" && !isPublicTracking && allowedOrigins.has(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type,Authorization,Idempotency-Key",
      );
      if (request.method === "OPTIONS" && typeof response.end === "function") {
        response.statusCode = 204;
        response.end();
        return;
      }
    }

    next();
  });
}
