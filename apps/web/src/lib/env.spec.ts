import fs from "node:fs";
import path from "node:path";
import { extractTrackingToken } from "./api-client.js";
import { buildLoginPayload } from "./contracts.js";
import { getWebServerConfig } from "./env.js";

describe("Seguridad y contratos de @domigoo/web (M29/M30/M39/M46)", () => {
  it("usa APP_NAME y ADMIN_APP_URL en la configuración del servidor", () => {
    const prevApp = process.env["APP_NAME"];
    const prevAdmin = process.env["ADMIN_APP_URL"];
    process.env["APP_NAME"] = "DOMIGOO-TEST";
    process.env["ADMIN_APP_URL"] = "https://admin.ejemplo.com/";
    expect(getWebServerConfig().appName).toBe("DOMIGOO-TEST");
    expect(getWebServerConfig().adminAppUrl).toBe("https://admin.ejemplo.com");
    if (prevApp === undefined) {
      delete process.env["APP_NAME"];
    } else {
      process.env["APP_NAME"] = prevApp;
    }
    if (prevAdmin === undefined) {
      delete process.env["ADMIN_APP_URL"];
    } else {
      process.env["ADMIN_APP_URL"] = prevAdmin;
    }
  });

  it("construye el payload de login con email o phoneE164 según identificador", () => {
    expect(buildLoginPayload("restaurante@ejemplo.com", "ClaveSegura123", "WEB")).toEqual({
      email: "restaurante@ejemplo.com",
      password: "ClaveSegura123",
      client: "WEB",
    });
    expect(buildLoginPayload("+573001112233", "ClaveSegura123", "WEB")).toEqual({
      phoneE164: "+573001112233",
      password: "ClaveSegura123",
      client: "WEB",
    });
  });

  it("extrae el token de seguimiento desde código directo o URL completa", () => {
    expect(extractTrackingToken("trk_abc123")).toBe("trk_abc123");
    expect(extractTrackingToken("https://domigoo-web.vercel.app/tracking/trk_xyz789?foo=1")).toBe(
      "trk_xyz789",
    );
    expect(extractTrackingToken("   ")).toBe("");
  });

  it("no referencia DATABASE_URL ni APP_ENCRYPTION_KEY y usa los campos reales de la API", () => {
    const clientFile = path.resolve(process.cwd(), "src/components/restaurant-portal.tsx");
    const content = fs.readFileSync(clientFile, "utf8");
    expect(content).not.toContain("DATABASE_URL");
    expect(content).not.toContain("APP_ENCRYPTION_KEY");
    expect(content).toContain("Valor de la comida (COP)");
    expect(content).toContain("Valor del domicilio (COP)");
    expect(content).toContain("addressLine");
    expect(content).toContain("establishmentName");
    expect(content).toContain("phoneE164");
    expect(content).toContain('"tariffs/quote"');
  });

  it("MOD-01: client-portal.tsx no promete catálogo ni carrito y menciona WhatsApp sin enlaces wa.me", () => {
    const clientPortalFile = path.resolve(process.cwd(), "src/components/client-portal.tsx");
    const content = fs.readFileSync(clientPortalFile, "utf8");
    const lower = content.toLowerCase();
    expect(lower).not.toContain("carrito");
    expect(lower).not.toContain("catalogo");
    expect(lower).not.toContain("catálogo");
    expect(lower).not.toContain("m50");
    expect(lower).not.toContain("proximamente");
    expect(lower).not.toContain("próximamente");
    expect(lower).not.toContain("wa.me");
    expect(content).toContain("WhatsApp");
  });

  it("ORDEN 013: domigoo.css define .dg-alert--info con borde sólido y .dg-badge con contraste Indigo #29243e", () => {
    const cssFile = path.resolve(process.cwd(), "src/styles/domigoo.css");
    const css = fs.readFileSync(cssFile, "utf8");

    const infoMatch = /\.dg-alert--info\s*\{([^}]*)\}/.exec(css);
    expect(infoMatch).not.toBeNull();
    const infoBlock = infoMatch?.[1] ?? "";
    expect(infoBlock).toContain("background: var(--dg-brand-soft);");
    expect(infoBlock).toContain("border: 1px solid var(--domigoo-turquoise);");
    expect(infoBlock).toContain("color: var(--domigoo-indigo);");

    const badgeMatch = /(?:^|\n)\.dg-badge\s*\{([^}]*)\}/.exec(css);
    expect(badgeMatch).not.toBeNull();
    const badgeBlock = badgeMatch?.[1] ?? "";
    expect(badgeBlock).toContain("background: rgba(121, 213, 208, 0.14);");
    expect(badgeBlock).toContain("color: #29243e;");
    expect(badgeBlock).not.toContain("color: #79d5d0;");

    const clientPortalFile = path.resolve(process.cwd(), "src/components/client-portal.tsx");
    const portal = fs.readFileSync(clientPortalFile, "utf8");
    const pedirStart = portal.indexOf("export function ClientPedirScreen()");
    const pedirEnd = portal.indexOf("export function ClientSeguirScreen()");
    const pedirSection = portal.slice(pedirStart, pedirEnd);
    expect(pedirSection).toContain("dg-alert dg-alert--info");
    expect(pedirSection).not.toContain("dg-alert--soon");
  });
});
