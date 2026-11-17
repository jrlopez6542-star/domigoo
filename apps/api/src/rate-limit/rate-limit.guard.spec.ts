import type { Request } from "express";
import { extractClientIp } from "./rate-limit.guard.js";

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
