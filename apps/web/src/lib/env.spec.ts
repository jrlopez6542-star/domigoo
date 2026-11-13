import fs from "node:fs";
import path from "node:path";
import { getWebServerConfig } from "./env.js";

describe("Seguridad y configuración de @domigoo/web (M29/M30)", () => {
  it("usa APP_NAME en la configuración del servidor", () => {
    const prev = process.env["APP_NAME"];
    process.env["APP_NAME"] = "DOMIGOO-TEST";
    expect(getWebServerConfig().appName).toBe("DOMIGOO-TEST");
    if (prev === undefined) {
      delete process.env["APP_NAME"];
    } else {
      process.env["APP_NAME"] = prev;
    }
  });

  it("no referencia DATABASE_URL ni APP_ENCRYPTION_KEY en componentes cliente", () => {
    const clientFile = path.resolve(process.cwd(), "src/components/restaurant-portal.tsx");
    const content = fs.readFileSync(clientFile, "utf8");
    expect(content).not.toContain("DATABASE_URL");
    expect(content).not.toContain("APP_ENCRYPTION_KEY");
    expect(content).toContain("Valor de la comida (COP)");
    expect(content).toContain("Valor del domicilio (COP)");
  });
});
