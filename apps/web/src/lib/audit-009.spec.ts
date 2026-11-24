import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { GET, POST } from "../app/api/proxy/[...path]/route.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const domigooCssPath = path.resolve(__dirname, "../styles/domigoo.css");

function extractRuleBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = Array.from(css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "gm")));
  if (matches.length === 0) {
    throw new Error(`Selector not found in domigoo.css: ${selector}`);
  }
  return matches.map((m) => m[1] ?? "").join("\n");
}

describe("ORDEN 009 - Web SEC-05, UI-02, UI-03", () => {
  test("SEC-05: proxy devuelve 404 sin llamar a fetch para rutas fuera de allowlist o path traversal", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = () => {
      fetchCalls += 1;
      return Promise.resolve(new Response("{}", { status: 200 }));
    };
    try {
      const blockedPaths = [
        ["admin", "stats"],
        ["admin", "verification-cases"],
        ["orders", "..", "admin", "stats"],
        ["orders", "../admin/stats"],
        ["orders", "..\\admin\\stats"],
        ["orders", "..%2Fadmin%2Fstats"],
        ["orders", "..%5Cadmin%5Cstats"],
        ["orders", "%E0%A4%A"],
        ["metrics"],
        [],
      ];
      for (const segments of blockedPaths) {
        const req = new NextRequest(`http://localhost:3000/api/proxy/${segments.join("/")}`, {
          method: "GET",
        });
        const res = await GET(req, { params: Promise.resolve({ path: segments }) });
        expect(res.status).toBe(404);
      }
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("SEC-05: proxy web devuelve 502 generico sin detalles si la API no responde", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.reject(new Error("connect ECONNREFUSED 10.0.0.1:5432 secret-token stack"));
    try {
      const req = new NextRequest("http://localhost:3000/api/proxy/auth/me", {
        method: "GET",
      });
      const res = await GET(req, { params: Promise.resolve({ path: ["auth", "me"] }) });
      expect(res.status).toBe(502);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({
        message: "No se pudo conectar con el servicio de API",
      });
      expect(text).not.toMatch(/ECONNREFUSED|10\.0\.0\.1|secret-token|stack/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("SEC-05: proxy reenvia todas las cookies Set-Cookie con getSetCookie()", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiBaseUrl = process.env["NEXT_PUBLIC_API_BASE_URL"];
    process.env["NEXT_PUBLIC_API_BASE_URL"] = "https://api.domigoo.test";
    globalThis.fetch = () => {
      const headers = new Headers({
        "content-type": "application/json",
      });
      headers.append("set-cookie", "domigoo_session=abc; Path=/; HttpOnly");
      headers.append("set-cookie", "domigoo_csrf=xyz; Path=/; SameSite=Lax");
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers,
        }),
      );
    };
    try {
      const req = new NextRequest("http://localhost:3000/api/proxy/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier: "a@b.co", password: "secret" }),
      });
      const res = await POST(req, {
        params: Promise.resolve({ path: ["auth", "login"] }),
      });
      expect(res.status).toBe(200);
      const cookies = res.headers.getSetCookie();
      expect(cookies).toHaveLength(2);
      expect(cookies).toEqual([
        "domigoo_session=abc; Path=/; HttpOnly",
        "domigoo_csrf=xyz; Path=/; SameSite=Lax",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiBaseUrl === undefined) {
        delete process.env["NEXT_PUBLIC_API_BASE_URL"];
      } else {
        process.env["NEXT_PUBLIC_API_BASE_URL"] = originalApiBaseUrl;
      }
    }
  });

  test("UI-02: controles interactivos en domigoo.css tienen al menos 44px", () => {
    const css = readFileSync(domigooCssPath, "utf8");
    const selectors = [
      ".dg-step-pill",
      ".dg-details summary",
      ".dg-check-row",
      ".dg-inline-link",
      ".dg-home-restaurant-note a",
      ".dg-ecosystem-item",
    ];
    for (const selector of selectors) {
      const block = extractRuleBlock(css, selector);
      expect(block).toMatch(/min-height:\s*44px/);
    }
    expect(extractRuleBlock(css, ".dg-inline-link")).toMatch(/min-width:\s*44px/);
    expect(extractRuleBlock(css, ".dg-home-restaurant-note a")).toMatch(/min-width:\s*44px/);
  });

  test("UI-03: reglas anti-desborde a 360px/390px en domigoo.css", () => {
    const css = readFileSync(domigooCssPath, "utf8");
    expect(extractRuleBlock(css, ".dg-home-card")).toMatch(/min-width:\s*0/);
    expect(extractRuleBlock(css, ".dg-step-pill")).toMatch(/min-width:\s*0/);
    expect(extractRuleBlock(css, ".dg-ecosystem-item")).toMatch(/min-width:\s*0/);
    expect(extractRuleBlock(css, ".dg-home-card-label")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(extractRuleBlock(css, ".dg-step-pill")).toMatch(/overflow-wrap:\s*anywhere/);
    const ecoItemBlock = extractRuleBlock(css, ".dg-ecosystem-item");
    expect(ecoItemBlock).toMatch(/overflow-wrap:\s*break-word/);
    expect(ecoItemBlock).not.toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/@media\s*\(max-width:\s*400px\)/);
    const baseStripIdx = css.indexOf(".dg-ecosystem-strip {");
    const baseItemIdx = css.indexOf(".dg-ecosystem-item {");
    expect(baseStripIdx).toBeGreaterThanOrEqual(0);
    expect(baseItemIdx).toBeGreaterThanOrEqual(0);
    const mediaEcoMatch = css.match(
      /@media\s*\(max-width:\s*400px\)\s*\{\s*\.dg-ecosystem-strip\s*\{[\s\S]*?\.dg-ecosystem-item\s*\{/,
    );
    expect(mediaEcoMatch).not.toBeNull();
    expect(mediaEcoMatch?.index ?? -1).toBeGreaterThan(baseStripIdx);
    expect(mediaEcoMatch?.index ?? -1).toBeGreaterThan(baseItemIdx);
  });
});

describe("ORDEN 015 - proxy web y legal-documents/current", () => {
  test("reenvia GET legal-documents/current a /v1 y bloquea legal-documents y sus otras subrutas sin fetch", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiBaseUrl = process.env["NEXT_PUBLIC_API_BASE_URL"];
    process.env["NEXT_PUBLIC_API_BASE_URL"] = "https://api.domigoo.test";
    const fetchedUrls: string[] = [];
    globalThis.fetch = (input: string | URL | Request) => {
      fetchedUrls.push(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      return Promise.resolve(
        new Response(
          JSON.stringify({
            documents: [{ id: "doc-gps", kind: "GEOLOCATION_CONSENT", version: "v1" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    };
    try {
      const allowed = await GET(
        new NextRequest("http://localhost:3000/api/proxy/legal-documents/current", {
          method: "GET",
        }),
        { params: Promise.resolve({ path: ["legal-documents", "current"] }) },
      );
      expect(allowed.status).toBe(200);
      expect(fetchedUrls).toHaveLength(1);
      expect(fetchedUrls[0]).toMatch(/^https?:\/\/[^/]+\/v1\/legal-documents\/current$/);

      for (const segments of [
        ["legal-documents"],
        ["legal-documents", "publish"],
        ["legal-documents", "current", "extra"],
      ]) {
        const blockedGet = await GET(
          new NextRequest(`http://localhost:3000/api/proxy/${segments.join("/")}`, {
            method: "GET",
          }),
          { params: Promise.resolve({ path: segments }) },
        );
        expect(blockedGet.status).toBe(404);
        const blockedPost = await POST(
          new NextRequest(`http://localhost:3000/api/proxy/${segments.join("/")}`, {
            method: "POST",
            body: JSON.stringify({ kind: "TERMS", version: "x", content: "y" }),
          }),
          { params: Promise.resolve({ path: segments }) },
        );
        expect(blockedPost.status).toBe(404);
      }
      expect(fetchedUrls).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiBaseUrl === undefined) {
        delete process.env["NEXT_PUBLIC_API_BASE_URL"];
      } else {
        process.env["NEXT_PUBLIC_API_BASE_URL"] = originalApiBaseUrl;
      }
    }
  });
});
