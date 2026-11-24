import { NextResponse, type NextRequest } from "next/server";
import { getAdminServerConfig } from "../../../../lib/env";

const ALLOWED_EXACT_ROUTES = new Set(["auth/me", "auth/login", "auth/logout", "admin/stats"]);

const ALLOWED_PREFIXES = ["admin/verification-cases", "admin/declarations"];

function hasUnsafeSegment(segment: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return true;
  }
  return (
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    decoded === "." ||
    decoded === ".." ||
    decoded.includes("/") ||
    decoded.includes("\\")
  );
}

function isAllowedAdminProxyPath(segments: string[]): boolean {
  if (segments.length === 0) {
    return false;
  }
  if (segments.some(hasUnsafeSegment)) {
    return false;
  }
  const joined = segments.join("/");
  if (ALLOWED_EXACT_ROUTES.has(joined)) {
    return true;
  }
  return ALLOWED_PREFIXES.some((prefix) => joined === prefix || joined.startsWith(`${prefix}/`));
}

async function forward(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  if (!isAllowedAdminProxyPath(path)) {
    return NextResponse.json({ message: "Not Found" }, { status: 404 });
  }
  const { apiBaseUrl } = getAdminServerConfig();
  const targetUrl = `${apiBaseUrl}/v1/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  }
  const cookie = request.headers.get("cookie");
  if (cookie) {
    headers.set("cookie", cookie);
  }
  const authorization = request.headers.get("authorization");
  if (authorization) {
    headers.set("authorization", authorization);
  }
  const clientIp = extractProxyClientIp(request);
  if (clientIp) {
    headers.set("x-domigoo-client-ip", clientIp);
  }
  const proxySecret = process.env["PROXY_SHARED_SECRET"]?.trim();
  if (proxySecret) {
    headers.set("x-domigoo-proxy-secret", proxySecret);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.text() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { message: "No se pudo conectar con el servicio de API" },
      { status: 502 },
    );
  }

  const responseText = await upstream.text();
  const response = new NextResponse(responseText, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

  const setCookies =
    typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [];
  if (setCookies.length > 0) {
    for (const setCookie of setCookies) {
      response.headers.append("set-cookie", setCookie);
    }
  } else {
    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) {
      response.headers.append("set-cookie", setCookie);
    }
  }

  return response;
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;

function extractProxyClientIp(request: NextRequest): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || undefined;
}
