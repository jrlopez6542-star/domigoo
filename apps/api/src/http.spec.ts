import type { INestApplication } from "@nestjs/common";
import { applyHttpSecurity, parseAllowedOrigins } from "./http.js";

describe("applyHttpSecurity", () => {
  it("desactiva x-powered-by, fija cabeceras de endurecimiento y aplica CORS por allowlist sin reflejar en /v1/tracking", () => {
    const disabled: string[] = [];
    let middleware:
      | ((
          req: { method?: string; url?: string; headers?: Record<string, string> },
          res: {
            setHeader: (k: string, v: string) => void;
            removeHeader: (k: string) => void;
            statusCode?: number;
            end: () => void;
          },
          next: () => void,
        ) => void)
      | undefined;

    const fakeApp = {
      getHttpAdapter: () => ({
        getInstance: () => ({
          disable: (setting: string) => {
            disabled.push(setting);
          },
        }),
      }),
      use: (fn: typeof middleware) => {
        middleware = fn;
      },
    } as unknown as INestApplication;

    applyHttpSecurity(fakeApp, "https://web.domigoo.co, https://admin.domigoo.co");
    expect(disabled).toEqual(["x-powered-by"]);
    if (middleware === undefined) {
      throw new Error("Middleware no registrado");
    }

    const headers = new Map<string, string>();
    const removed: string[] = [];
    let nextCalled = false;

    middleware(
      {
        method: "GET",
        url: "/v1/orders",
        headers: { origin: "https://web.domigoo.co" },
      },
      {
        setHeader: (k, v) => headers.set(k, v),
        removeHeader: (k) => removed.push(k),
        end: () => {},
      },
      () => {
        nextCalled = true;
      },
    );

    expect(removed).toContain("X-Powered-By");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("Access-Control-Allow-Origin")).toBe("https://web.domigoo.co");
    expect(nextCalled).toBe(true);

    // En /v1/tracking/* no se refleja el origen
    const trackingHeaders = new Map<string, string>();
    middleware(
      {
        method: "GET",
        url: "/v1/tracking/token-abc",
        headers: { origin: "https://web.domigoo.co" },
      },
      {
        setHeader: (k, v) => trackingHeaders.set(k, v),
        removeHeader: () => {},
        end: () => {},
      },
      () => {},
    );
    expect(trackingHeaders.has("Access-Control-Allow-Origin")).toBe(false);

    // Origen no autorizado tampoco recibe cabecera CORS
    const untrustedHeaders = new Map<string, string>();
    middleware(
      {
        method: "GET",
        url: "/v1/orders",
        headers: { origin: "https://evil.example.com" },
      },
      {
        setHeader: (k, v) => untrustedHeaders.set(k, v),
        removeHeader: () => {},
        end: () => {},
      },
      () => {},
    );
    expect(untrustedHeaders.has("Access-Control-Allow-Origin")).toBe(false);
  });

  it("parsea lista de orígenes permitidos separada por comas", () => {
    expect([...parseAllowedOrigins(" https://a.co , , https://b.co ")]).toEqual([
      "https://a.co",
      "https://b.co",
    ]);
  });
});
