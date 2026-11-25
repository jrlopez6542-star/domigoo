import fs from "node:fs";
import path from "node:path";
import { formatAdminSessionLabel, formatBogotaDateTime } from "./contracts.js";

const UUID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

describe("ORDEN 022 - Admin: sin UUID visibles en sesión y casos de verificación", () => {
  it("formatAdminSessionLabel usa nombre, correo, teléfono o identificador y nunca el id", () => {
    expect(formatAdminSessionLabel({ id: UUID, displayName: "Ana Admin" })).toBe(
      "Sesión activa: Ana Admin",
    );
    expect(formatAdminSessionLabel({ id: UUID, email: "ana@domigoo.test" })).toBe(
      "Sesión activa: ana@domigoo.test",
    );
    expect(formatAdminSessionLabel({ id: UUID, phoneE164: "+573001234567" })).toBe(
      "Sesión activa: +573001234567",
    );
    expect(formatAdminSessionLabel({ id: UUID }, "admin@domigoo.test")).toBe(
      "Sesión activa: admin@domigoo.test",
    );
    expect(formatAdminSessionLabel({ id: UUID })).toBe("Sesión activa");
    expect(formatAdminSessionLabel(null)).toBe("Sesión activa");
    expect(formatAdminSessionLabel({ id: UUID, email: "  " })).not.toContain(UUID);
  });

  it("formatBogotaDateTime muestra fecha es-CO en hora de Bogotá y nunca ISO crudo", () => {
    const shown = formatBogotaDateTime("2026-11-24T15:30:00.000Z");
    expect(shown).toContain("24/11/2026");
    expect(shown).toMatch(/10:30/);
    expect(shown).not.toContain("T15:30");
    expect(formatBogotaDateTime(null)).toBe("Sin fecha");
    expect(formatBogotaDateTime(undefined)).toBe("Sin fecha");
  });

  it("admin-portal.tsx no pinta adminUserId, id del caso ni courierId en la interfaz", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/components/admin-portal.tsx"),
      "utf8",
    );
    expect(source).not.toContain("Sesión activa: {adminUserId}");
    expect(source).not.toContain("<code>{c.id}</code>");
    expect(source).not.toContain("<code>{c.courierId}</code>");
    expect(source).not.toMatch(/\{c\.courierId\}/);
    expect(source).toContain("formatAdminSessionLabel(");
    expect(source).toContain("c.courierName");
    expect(source).toContain("formatBogotaDateTime(c.submittedAt)");
  });
});
