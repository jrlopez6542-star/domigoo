import fs from "node:fs";
import path from "node:path";
import { extractTrackingToken } from "./api-client.js";
import { buildLoginPayload } from "./contracts.js";
import { getWebServerConfig } from "./env.js";
import { orderStatusLabel } from "./order-status.js";

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

  it("ORDEN 015: restaurant-portal consulta legal-documents/current y envía legalDocumentId en POST consents", () => {
    const portalFile = path.resolve(process.cwd(), "src/components/restaurant-portal.tsx");
    const portal = fs.readFileSync(portalFile, "utf8");
    const start = portal.indexOf("async function handleAllowGeoConsent()");
    const end = portal.indexOf("async function handleRevokeGeoConsent()");
    const fnBody = portal.slice(start, end);

    expect(fnBody).toContain('"legal-documents/current"');
    expect(fnBody).toContain('"GEOLOCATION_CONSENT"');
    expect(fnBody).toContain("legalDocumentId: geoDoc.id");
    expect(fnBody).toContain('"consents"');
    const guardIdx = fnBody.indexOf("if (!geoDoc?.id)");
    const geoReqIdx = fnBody.indexOf('requestBrowserLocation("dropoff")');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(geoReqIdx).toBeGreaterThan(guardIdx);
  });

  it("ORDEN 015: proxy web permite legal-documents/current exacta y rechaza legal-documents", () => {
    const proxyFile = path.resolve(process.cwd(), "src/app/api/proxy/[...path]/route.ts");
    const source = fs.readFileSync(proxyFile, "utf8");

    const exactMatch = /ALLOWED_EXACT_ROUTES\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(source);
    expect(exactMatch).not.toBeNull();
    const exactRoutes = new Set(
      Array.from((exactMatch?.[1] ?? "").matchAll(/"([^"]+)"/g), (m) => m[1] ?? ""),
    );

    const prefixMatch = /ALLOWED_PREFIXES\s*=\s*\[([^\]]*)\]/.exec(source);
    expect(prefixMatch).not.toBeNull();
    const prefixes = Array.from((prefixMatch?.[1] ?? "").matchAll(/"([^"]+)"/g), (m) => m[1] ?? "");

    const isAllowed = (route: string): boolean =>
      exactRoutes.has(route) || prefixes.some((prefix) => route.startsWith(prefix));

    expect(isAllowed("legal-documents/current")).toBe(true);
    expect(isAllowed("legal-documents")).toBe(false);
    expect(isAllowed("legal-documents/publish")).toBe(false);
  });

  it("ORDEN 016: orderStatusLabel traduce estados conocidos al español y devuelve el valor original si no existe", () => {
    expect(orderStatusLabel("DRAFT")).toBe("Borrador");
    expect(orderStatusLabel("SEEKING_COURIER")).toBe("Buscando domiciliario");
    expect(orderStatusLabel("ACCEPTED")).toBe("Domiciliario asignado");
    expect(orderStatusLabel("ARRIVING_PICKUP")).toBe("En camino al restaurante");
    expect(orderStatusLabel("AT_PICKUP")).toBe("En el restaurante");
    expect(orderStatusLabel("PICKED_UP")).toBe("Pedido recogido (en camino)");
    expect(orderStatusLabel("AT_DROPOFF")).toBe("En el punto de entrega");
    expect(orderStatusLabel("DELIVERED")).toBe("Entregado");
    expect(orderStatusLabel("CANCELLED_RESTAURANT")).toBe("Cancelado por el restaurante");
    expect(orderStatusLabel("EXPIRED")).toBe("Expirado");
    expect(orderStatusLabel("ESTADO_DESCONOCIDO")).toBe("ESTADO_DESCONOCIDO");
  });

  it("ORDEN 016: restaurant-portal muestra alerta dentro de geo-consent-screen, usa dg-inline-link y orderStatusLabel en portales y tracking", () => {
    const restPortal = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/restaurant-portal.tsx"),
      "utf8",
    );
    const consentStart = restPortal.indexOf('data-testid="geo-consent-screen"');
    const consentEnd = restPortal.indexOf('data-testid="geo-consent-manual"');
    const consentBlock = restPortal.slice(consentStart, consentEnd);
    expect(consentBlock).toContain('role="alert"');
    expect(consentBlock).toContain("{errorMessage}");
    expect(consentBlock).toContain('className="dg-inline-link"');
    expect(restPortal).not.toContain("dg-footer-link");
    const css = fs.readFileSync(path.resolve(process.cwd(), "src/styles/domigoo.css"), "utf8");
    const inlineLinkRule = css.slice(
      css.indexOf(".dg-inline-link {"),
      css.indexOf(".dg-inline-link:hover"),
    );
    expect(inlineLinkRule).toContain("color: #0f5c58;");
    expect(restPortal).toContain("orderStatusLabel(data.status)");
    expect(restPortal).toContain("orderStatusLabel(item.status)");
    expect(restPortal).toContain("orderStatusLabel(orderView.status)");

    const courierPortal = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/courier-portal.tsx"),
      "utf8",
    );
    expect(courierPortal).toContain(
      'orderStatusLabel(data.orderStatus ?? data.status ?? "ACCEPTED")',
    );
    expect(courierPortal).toContain("Estado actualizado: ${orderStatusLabel(data.status)}.");
    expect(courierPortal).toContain(
      "PIN verificado. Nuevo estado: ${orderStatusLabel(data.status)}.",
    );
    expect(courierPortal).toContain("orderStatusLabel(orderView.status)");

    const trackingPage = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/tracking/[token]/page.tsx"),
      "utf8",
    );
    expect(trackingPage).toContain('from "@/lib/order-status"');
    expect(trackingPage).toContain("orderStatusLabel(tracking.status)");
    expect(trackingPage).not.toContain("const STATUS_LABELS:");
  });
});
