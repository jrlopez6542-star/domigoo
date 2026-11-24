import fs from "node:fs";
import path from "node:path";
import {
  VERIFICATION_OUTCOME_ACTION_LABELS,
  VERIFICATION_STATUS_LABELS,
  verificationCaseStatusLabel,
  verificationOutcomeActionLabel,
} from "./contracts.js";
import { orderStatusLabel, STATUS_LABELS } from "./order-status.js";

describe("ORDEN 019 - Admin: etiquetas visibles en español sin códigos entre paréntesis", () => {
  it("orderStatusLabel traduce estados conocidos al español sin códigos entre paréntesis", () => {
    for (const [code, label] of Object.entries(STATUS_LABELS)) {
      expect(orderStatusLabel(code)).toBe(label);
      expect(label).not.toMatch(/\([A-Z_]{3,}\)/);
    }
    expect(orderStatusLabel("DELIVERED")).toBe("Entregado");
    expect(orderStatusLabel("SEEKING_COURIER")).toBe("Buscando domiciliario");
    expect(orderStatusLabel("OTRO_ESTADO")).toBe("OTRO_ESTADO");
  });

  it("verificationOutcomeActionLabel y verificationCaseStatusLabel no muestran códigos entre paréntesis", () => {
    expect(verificationOutcomeActionLabel("APPROVED")).toBe("Aprobar");
    expect(verificationOutcomeActionLabel("REJECTED")).toBe("Rechazar");
    expect(verificationOutcomeActionLabel("NEEDS_CHANGES")).toBe("Solicitar cambios");
    for (const label of Object.values(VERIFICATION_OUTCOME_ACTION_LABELS)) {
      expect(label).not.toMatch(/\([A-Z_]{3,}\)/);
    }

    expect(verificationCaseStatusLabel("PENDING_HUMAN")).toBe("Pendiente de revisión");
    expect(verificationCaseStatusLabel("APPROVED")).toBe("Aprobado");
    expect(verificationCaseStatusLabel("REJECTED")).toBe("Rechazado");
    expect(verificationCaseStatusLabel("NEEDS_CHANGES")).toBe("Requiere cambios");
    expect(verificationCaseStatusLabel("OTRO")).toBe("OTRO");
    for (const label of Object.values(VERIFICATION_STATUS_LABELS)) {
      expect(label).not.toMatch(/\([A-Z_]{3,}\)/);
    }
  });

  it("admin-portal.tsx conserva values internos y no muestra códigos entre paréntesis en selects, labels ni listas", () => {
    const tsx = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/admin-portal.tsx"),
      "utf8",
    );
    expect(tsx).toContain('value="APPROVED"');
    expect(tsx).toContain('value="REJECTED"');
    expect(tsx).toContain('value="NEEDS_CHANGES"');
    expect(tsx).not.toContain("(APPROVED)");
    expect(tsx).not.toContain("(REJECTED)");
    expect(tsx).not.toContain("(NEEDS_CHANGES)");
    expect(tsx).not.toContain("(outcome)");
    expect(tsx).not.toContain("(reasonCode)");
    expect(tsx).not.toContain("(comment)");
    expect(tsx).toContain("orderStatusLabel(statusKey)");
    expect(tsx).toContain("verificationCaseStatusLabel(c.status)");
  });
});
