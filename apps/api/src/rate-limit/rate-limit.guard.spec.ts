import type { Request } from "express";
import { extractClientIp, resolvePolicy } from "./rate-limit.guard.js";

function mockRequest(headers: Record<string, string | undefined>, ip = "127.0.0.1"): Request {
  return {
    headers,
    ip,
  } as unknown as Request;
}

describe("extractClientIp", () => {
  const originalSecret = process.env["PROXY_SHARED_SECRET"];

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env["PROXY_SHARED_SECRET"];
    } else {
      process.env["PROXY_SHARED_SECRET"] = originalSecret;
    }
  });

  it("confía en x-domigoo-client-ip cuando x-domigoo-proxy-secret coincide", () => {
    process.env["PROXY_SHARED_SECRET"] = "proxy-secret-m47-test";
    const req = mockRequest(
      {
        "x-domigoo-client-ip": "203.0.113.45",
        "x-domigoo-proxy-secret": "proxy-secret-m47-test",
        "x-forwarded-for": "10.0.0.1",
      },
      "127.0.0.1",
    );

    expect(extractClientIp(req)).toBe("203.0.113.45");
  });

  it("ignora x-domigoo-client-ip cuando x-domigoo-proxy-secret es inválido", () => {
    process.env["PROXY_SHARED_SECRET"] = "proxy-secret-m47-test";
    const req = mockRequest(
      {
        "x-domigoo-client-ip": "203.0.113.45",
        "x-domigoo-proxy-secret": "secreto-incorrecto",
        "x-forwarded-for": "198.51.100.77, 10.0.0.1",
      },
      "127.0.0.1",
    );

    expect(extractClientIp(req)).toBe("198.51.100.77");
  });

  it("ignora x-domigoo-client-ip cuando falta x-domigoo-proxy-secret", () => {
    process.env["PROXY_SHARED_SECRET"] = "proxy-secret-m47-test";
    const req = mockRequest(
      {
        "x-domigoo-client-ip": "203.0.113.45",
        "x-forwarded-for": "198.51.100.88",
      },
      "127.0.0.1",
    );

    expect(extractClientIp(req)).toBe("198.51.100.88");
  });

  it("ignora x-domigoo-client-ip cuando PROXY_SHARED_SECRET no está configurado", () => {
    delete process.env["PROXY_SHARED_SECRET"];
    const req = mockRequest(
      {
        "x-domigoo-client-ip": "203.0.113.45",
        "x-domigoo-proxy-secret": "cualquier-cosa",
      },
      "192.0.2.15",
    );

    expect(extractClientIp(req)).toBe("192.0.2.15");
  });
});

describe("resolvePolicy", () => {
  const originalTrackingMax = process.env["RATE_LIMIT_TRACKING_MAX"];
  const originalOrdersMax = process.env["RATE_LIMIT_ORDERS_MAX"];

  afterEach(() => {
    if (originalTrackingMax === undefined) {
      delete process.env["RATE_LIMIT_TRACKING_MAX"];
    } else {
      process.env["RATE_LIMIT_TRACKING_MAX"] = originalTrackingMax;
    }
    if (originalOrdersMax === undefined) {
      delete process.env["RATE_LIMIT_ORDERS_MAX"];
    } else {
      process.env["RATE_LIMIT_ORDERS_MAX"] = originalOrdersMax;
    }
  });

  it("aplica rate limit a GET /v1/tracking/:token con bucket tracking y default 120", () => {
    delete process.env["RATE_LIMIT_TRACKING_MAX"];
    const policy = resolvePolicy("/v1/tracking/abc123token", "GET");
    expect(policy).not.toBeNull();
    expect(policy?.bucket).toBe("tracking");
    expect(policy?.limit).toBe(120);

    process.env["RATE_LIMIT_TRACKING_MAX"] = "240";
    expect(resolvePolicy("/v1/tracking/abc123token", "GET")?.limit).toBe(240);
  });

  it("aplica rate limit a POST /v1/courier-invitations/:token/accept en bucket sensitive", () => {
    const policy = resolvePolicy("/v1/courier-invitations/inv-tok-1/accept", "POST");
    expect(policy).not.toBeNull();
    expect(policy?.bucket).toBe("sensitive");
    expect(policy?.limit).toBe(30);
  });

  it("aplica rate limit a creación y publicación de pedidos con bucket orders y default 60", () => {
    delete process.env["RATE_LIMIT_ORDERS_MAX"];
    const createPolicy = resolvePolicy("/v1/orders", "POST");
    const publishPolicy = resolvePolicy("/v1/orders/ord-123/publish", "POST");
    expect(createPolicy?.bucket).toBe("orders");
    expect(createPolicy?.limit).toBe(60);
    expect(publishPolicy?.bucket).toBe("orders");
    expect(publishPolicy?.limit).toBe(60);

    process.env["RATE_LIMIT_ORDERS_MAX"] = "90";
    expect(resolvePolicy("/v1/orders", "POST")?.limit).toBe(90);
    expect(resolvePolicy("/v1/orders/ord-123/publish", "POST")?.limit).toBe(90);
  });
});
