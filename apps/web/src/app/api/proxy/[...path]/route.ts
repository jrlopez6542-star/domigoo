import { NextResponse, type NextRequest } from "next/server";
import { getWebServerConfig } from "@/lib/env";

async function forward(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  const { apiBaseUrl } = getWebServerConfig();
  const targetUrl = `${apiBaseUrl}/v1/${path.join("/")}${request.nextUrl.search}`;

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
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey) {
    headers.set("idempotency-key", idempotencyKey);
  }
  const clientIp = extractProxyClientIp(request);
  if (clientIp) {
    headers.set("x-domigoo-client-ip", clientIp);
  }
  const proxySecret = process.env["PROXY_SHARED_SECRET"]?.trim();
  if (proxySecret) {
    headers.set("x-domigoo-proxy-secret", proxySecret);
  }
  if (process.env["VERCEL_ENV"] === "preview") {
    const bypass = request.headers.get("x-vercel-protection-bypass")?.trim();
    if (bypass) {
      headers.set("x-vercel-protection-bypass", bypass);
    }
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.text() : undefined;

  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers,
    ...(body !== undefined ? { body } : {}),
    cache: "no-store",
  });

  const responseText = await upstream.text();
  const response = new NextResponse(responseText, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

  const setCookie = upstream.headers.get("set-cookie");
  if (setCookie) {
    response.headers.set("set-cookie", setCookie);
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
