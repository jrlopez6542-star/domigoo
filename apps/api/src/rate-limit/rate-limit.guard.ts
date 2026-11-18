import { timingSafeEqual } from "node:crypto";
import { type CanActivate, type ExecutionContext, HttpException, Injectable } from "@nestjs/common";
import type { Request, Response } from "express";
import { RateLimitService } from "./rate-limit.service.js";

const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_AUTH_MAX = 60;
const DEFAULT_AUTH_SESSION_MAX = 600;
const DEFAULT_SENSITIVE_MAX = 30;
const DEFAULT_TRACKING_MAX = 60;

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly rateLimit: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") {
      return true;
    }
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const path = request.path || request.url || "";

    const policy = resolvePolicy(path, request.method);
    if (policy === null) {
      return true;
    }

    const ip = extractClientIp(request);
    const key = `rl:${policy.bucket}:${ip}`;
    const decision = await this.rateLimit.consume(key, policy.limit, policy.windowMs);
    if (!decision.allowed) {
      response.setHeader("Retry-After", String(decision.retryAfterSeconds));
      throw new HttpException({ message: "Demasiadas solicitudes. Intenta más tarde." }, 429);
    }
    return true;
  }
}

export function extractClientIp(request: Request): string {
  const expectedSecret = process.env["PROXY_SHARED_SECRET"]?.trim();
  if (expectedSecret) {
    const providedSecret = firstHeaderValue(request.headers["x-domigoo-proxy-secret"]);
    if (providedSecret && safeEquals(providedSecret, expectedSecret)) {
      const proxiedIp = firstHeaderValue(request.headers["x-domigoo-client-ip"]);
      if (proxiedIp) {
        return proxiedIp;
      }
    }
  }

  const forwarded = firstHeaderValue(request.headers["x-forwarded-for"]);
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  return request.ip || "unknown";
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed !== "" ? trimmed : undefined;
}

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function resolvePolicy(
  path: string,
  method: string,
): { bucket: string; limit: number; windowMs: number } | null {
  const windowSeconds = readPositiveInt(
    process.env["RATE_LIMIT_WINDOW_SECONDS"],
    DEFAULT_WINDOW_SECONDS,
  );
  const windowMs = windowSeconds * 1000;

  if (method === "POST" && (path === "/v1/auth/login" || path === "/v1/auth/register")) {
    const limit = readPositiveInt(process.env["RATE_LIMIT_AUTH_MAX"], DEFAULT_AUTH_MAX);
    return { bucket: "auth", limit, windowMs };
  }

  if (
    (method === "GET" && path === "/v1/auth/me") ||
    (method === "POST" && path === "/v1/auth/logout")
  ) {
    const limit = readPositiveInt(
      process.env["RATE_LIMIT_AUTH_SESSION_MAX"],
      DEFAULT_AUTH_SESSION_MAX,
    );
    return { bucket: "auth_session", limit, windowMs };
  }

  if (method === "GET" && /^\/v1\/tracking\/[^/]+$/.test(path)) {
    const limit = readPositiveInt(process.env["RATE_LIMIT_TRACKING_MAX"], DEFAULT_TRACKING_MAX);
    return { bucket: "tracking", limit, windowMs };
  }

  if (
    method === "POST" &&
    (path === "/v1/couriers/me/documents" ||
      path === "/v1/data-subject-requests" ||
      /^\/v1\/orders\/[^/]+\/(pickup-pin|delivery-pin)$/.test(path))
  ) {
    const limit = readPositiveInt(process.env["RATE_LIMIT_SENSITIVE_MAX"], DEFAULT_SENSITIVE_MAX);
    return { bucket: "sensitive", limit, windowMs };
  }

  return null;
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
