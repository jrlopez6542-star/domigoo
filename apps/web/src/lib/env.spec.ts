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
});
