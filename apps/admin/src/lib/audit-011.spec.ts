import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminPortalPath = path.resolve(__dirname, "../components/admin-portal.tsx");
describe("ORDEN 011 - Admin BUG-06 reason y ordersByStatus", () => {
  test("admin-portal.tsx muestra reason del caso de verificacion y ordersByStatus en estadisticas", () => {
    const tsx = readFileSync(adminPortalPath, "utf8");
    expect(tsx).toContain("c.reason");
    expect(tsx).toContain("Motivo:");
    expect(tsx).toContain('data-testid="admin-stats-by-status"');
    expect(tsx).toContain("Object.entries(stats.ordersByStatus)");
  });
});
