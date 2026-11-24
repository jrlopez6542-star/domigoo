import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { GET, POST } from "../app/api/proxy/[...path]/route.js";
import { ADMIN_SESSION_HEADER, SESSION_COOKIE } from "../lib/session-constants.js";
import { middleware } from "../middleware.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminCssPath = path.resolve(__dirname, "../styles/admin.css");
const adminPortalPath = path.resolve(__dirname, "../components/admin-portal.tsx");

function extractRuleBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m"));
  if (!match?.[1]) {
    throw new Error(`Selector not found in admin.css: ${selector}`);
  }
  return match[1];
}

describe("ORDEN 009 - Admin SEC-05, SEC-03, UI-02, UI-03", () => {
  test("SEC-05: proxy admin devuelve 404 sin llamar a fetch fuera de allowlist", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = () => {
      fetchCalls += 1;
      return Promise.resolve(new Response("{}", { status: 200 }));
    };
    try {
      const blockedPaths = [
        ["orders"],
        ["restaurants"],
        ["admin", "stats", "..", "orders"],
        ["admin", "../orders"],
        ["admin", "..\\orders"],
        ["admin", "..%2Forders"],
        ["admin", "verification-cases", "..%5Corders"],
        ["admin", "verification-cases", "%E0%A4%A"],
        ["auth", "register"],
        [],
      ];
      for (const segments of blockedPaths) {
        const req = new NextRequest(`http://localhost:3001/api/proxy/${segments.join("/")}`, {
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

  test("SEC-05: proxy admin devuelve 502 generico sin detalles si la API no responde", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.reject(new Error("connect ECONNREFUSED 10.0.0.1:5432 secret-token stack"));
    try {
      const req = new NextRequest("http://localhost:3001/api/proxy/auth/me", {
        method: "GET",
      });
      const res = await GET(req, { params: Promise.resolve({ path: ["auth", "me"] }) });
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({
        message: "No se pudo conectar con el servicio de API",
      });
      expect(text).not.toMatch(/ECONNREFUSED|10\.0\.0\.1|secret-token|stack/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("SEC-05: proxy admin reenvia todas las cookies Set-Cookie con getSetCookie()", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiBaseUrl = process.env["NEXT_PUBLIC_API_BASE_URL"];
    process.env["NEXT_PUBLIC_API_BASE_URL"] = "https://api.domigoo.test";
    globalThis.fetch = () => {
      const headers = new Headers({
        "content-type": "application/json",
      });
      headers.append("set-cookie", "domigoo_session=adm1; Path=/; HttpOnly");
      headers.append("set-cookie", "domigoo_csrf=adm2; Path=/; SameSite=Lax");
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers,
        }),
      );
    };
    try {
      const req = new NextRequest("http://localhost:3001/api/proxy/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier: "admin@domigoo.test", password: "secret" }),
      });
      const res = await POST(req, {
        params: Promise.resolve({ path: ["auth", "login"] }),
      });
      expect(res.status).toBe(200);
      const cookies = res.headers.getSetCookie();
      expect(cookies).toHaveLength(2);
      expect(cookies).toEqual([
        "domigoo_session=adm1; Path=/; HttpOnly",
        "domigoo_csrf=adm2; Path=/; SameSite=Lax",
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

  test("SEC-03: middleware marca ausencia/presencia de domigoo_session y aplica Cache-Control no-store", () => {
    const anonReq = new NextRequest("http://localhost:3001/");
    const anonRes = middleware(anonReq);
    expect(anonRes.headers.get("cache-control")).toBe(
      "no-store, no-cache, must-revalidate, private",
    );
    expect(anonRes.headers.get("x-middleware-request-" + ADMIN_SESSION_HEADER)).toBe("0");
    const authReq = new NextRequest("http://localhost:3001/", {
      headers: {
        cookie: `${SESSION_COOKIE}=signed-session-token`,
      },
    });
    const authRes = middleware(authReq);
    expect(authRes.headers.get("cache-control")).toBe(
      "no-store, no-cache, must-revalidate, private",
    );
    expect(authRes.headers.get("x-middleware-request-" + ADMIN_SESSION_HEADER)).toBe("1");
  });

  test("SEC-03: AdminPortal solo muestra secciones operativas cuando adminUserId esta autenticado", () => {
    const tsx = readFileSync(adminPortalPath, "utf8");
    expect(tsx).toContain("hasSessionCookie = false");
    expect(tsx).toMatch(/\{adminUserId \? \(\s*<>\s*<a href="#admin-verificacion"/);
    expect(tsx).toMatch(/\{adminUserId \? \(\s*<>\s*<section id="admin-verificacion"/);
  });

  test("UI-02 y UI-03: admin.css cumple objetivos tactiles >= 44px y evita desbordes a 360px", () => {
    const css = readFileSync(adminCssPath, "utf8");
    const navBlock = extractRuleBlock(css, ".adm-nav-item");
    expect(navBlock).toMatch(/min-height:\s*44px/);
    expect(navBlock).toMatch(/min-width:\s*44px/);
    expect(extractRuleBlock(css, ".adm-layout")).toMatch(/align-content:\s*start/);
    expect(extractRuleBlock(css, ".adm-content")).toMatch(/min-width:\s*0/);
    expect(extractRuleBlock(css, ".adm-card")).toMatch(/min-width:\s*0/);
    expect(extractRuleBlock(css, ".adm-card")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(extractRuleBlock(css, ".adm-stat-box")).toMatch(/min-width:\s*0/);
    expect(extractRuleBlock(css, ".adm-case-item")).toMatch(/min-width:\s*0/);
    expect(css).toMatch(/@media\s*\(max-width:\s*400px\)/);
  });
});
