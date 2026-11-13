import fs from "node:fs";
import path from "node:path";
import { getAdminServerConfig } from "./env.js";

describe("Configuración y reglas de @domigoo/admin (M31)", () => {
  it("usa APP_NAME en la configuración del servidor", () => {
    const prev = process.env["APP_NAME"];
    process.env["APP_NAME"] = "DOMIGOO-ADMIN";
    expect(getAdminServerConfig().appName).toBe("DOMIGOO-ADMIN");
    if (prev === undefined) {
      delete process.env["APP_NAME"];
    } else {
      process.env["APP_NAME"] = prev;
    }
  });

  it("no ofrece botón de cobrar tarjeta y usa reconocimiento de declaración", () => {
    const clientFile = path.resolve(process.cwd(), "src/components/admin-portal.tsx");
    const content = fs.readFileSync(clientFile, "utf8");
    expect(content).not.toMatch(/cobrar tarjeta/i);
    expect(content).toContain("Reconocer declaración de pago");
    expect(content).not.toContain("DATABASE_URL");
    expect(content).not.toContain("APP_ENCRYPTION_KEY");
  });
});
