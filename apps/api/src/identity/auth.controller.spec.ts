import type { Request, Response } from "express";
import { defaultPinEnv, type AppEnv } from "../config/env.js";
import { AuthController } from "./auth.controller.js";
import type { IdentityService } from "./identity.service.js";

describe("AuthController.register IP extraction", () => {
  const originalSecret = process.env["PROXY_SHARED_SECRET"];

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env["PROXY_SHARED_SECRET"];
    } else {
      process.env["PROXY_SHARED_SECRET"] = originalSecret;
    }
  });

  it("usa extractClientIp en register para registrar la IP real detrás del proxy", async () => {
    process.env["PROXY_SHARED_SECRET"] = "proxy-secret-m51";
    let capturedIp: string | undefined;

    const identity = {
      register: (_input: unknown, meta: { ip?: string; userAgent?: string }) => {
        capturedIp = meta.ip;
        return Promise.resolve({
          user: {
            id: "u-1",
            email: "test@example.invalid",
            phoneE164: null,
            status: "ACTIVE",
          },
          token: "tok-1",
          legalVersion: "2026-11",
          consentPurposes: ["TERMS", "PRIVACY_NOTICE"],
        });
      },
    } as unknown as IdentityService;

    const env = {
      ...defaultPinEnv(),
      cookieSecure: false,
      databaseUrl: "postgresql://localhost/test",
      appName: "DOMIGOO",
      port: 3000,
      storageDir: "/tmp",
      billingEnabled: false,
      subscriptionTrialDays: 15,
      subscriptionPlaceholderPriceCop: 0,
    } satisfies AppEnv;

    const controller = new AuthController(identity, env);
    const req = {
      ip: "127.0.0.1",
      headers: {
        "x-domigoo-client-ip": "203.0.113.77",
        "x-domigoo-proxy-secret": "proxy-secret-m51",
        "user-agent": "JestTest/1.0",
      },
    } as unknown as Request;
    const res = {
      setHeader: () => undefined,
    } as unknown as Response;

    await controller.register(
      {
        email: "test@example.invalid",
        password: "clave-de-prueba-12",
        client: "WEB",
        consents: { termsAccepted: true, privacyAccepted: true },
      },
      req,
      res,
    );

    expect(capturedIp).toBe("203.0.113.77");
  });
});
