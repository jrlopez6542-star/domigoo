import fs from "node:fs";
import path from "node:path";
import { buildAdminLoginPayload, buildVerificationDecisionPayload } from "./contracts.js";
import { getAdminServerConfig } from "./env.js";

describe("Configuración y contratos de @domigoo/admin (M31/M39)", () => {
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

  it("construye login ADMIN con email o phoneE164 y decisión con outcome, reasonCode y comment", () => {
    expect(buildAdminLoginPayload("admin@ejemplo.com", "ClaveSegura123")).toEqual({
      email: "admin@ejemplo.com",
      password: "ClaveSegura123",
      client: "ADMIN",
    });
    expect(buildAdminLoginPayload("+573001112233", "ClaveSegura123")).toEqual({
      phoneE164: "+573001112233",
      password: "ClaveSegura123",
      client: "ADMIN",
    });

    expect(
      buildVerificationDecisionPayload({
        outcome: "APPROVED",
        reasonCode: "docs_verified",
        comment: "Documentos completos",
      }),
    ).toEqual({
      outcome: "APPROVED",
      reasonCode: "DOCS_VERIFIED",
      comment: "Documentos completos",
    });
  });

  it("no ofrece botón de cobrar tarjeta y no contiene campos heredados decision/reason", () => {
    const clientFile = path.resolve(process.cwd(), "src/components/admin-portal.tsx");
    const content = fs.readFileSync(clientFile, "utf8");
    expect(content).not.toMatch(/cobrar tarjeta/i);
    expect(content).toContain("Reconocer declaración de pago");
    expect(content).toContain("reasonCode");
    expect(content).toContain("eligibleCouriers");
    expect(content).not.toContain("DATABASE_URL");
    expect(content).not.toContain("APP_ENCRYPTION_KEY");

    const proxyRoute = path.resolve(process.cwd(), "src/app/api/proxy/[...path]/route.ts");
    expect(fs.existsSync(proxyRoute)).toBe(true);
    const proxyContent = fs.readFileSync(proxyRoute, "utf8");
    expect(proxyContent).toContain("getAdminServerConfig");
    expect(proxyContent).toContain("set-cookie");
  });
});
