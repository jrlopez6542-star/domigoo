import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const restaurantPortalPath = path.resolve(__dirname, "../components/restaurant-portal.tsx");
const trackingPagePath = path.resolve(__dirname, "../app/tracking/[token]/page.tsx");
const trackingRefreshPath = path.resolve(__dirname, "../components/tracking-refresh-button.tsx");
describe("ORDEN 011 - Web BUG-02 cancelar restaurante y BUG-06 tracking timeline", () => {
  test("BUG-02: restaurant-portal.tsx permite cancelar solo en estados permitidos por order-machine, con motivo, confirmacion y 44px", () => {
    const tsx = readFileSync(restaurantPortalPath, "utf8");
    expect(tsx).toMatch(
      /RESTAURANT_CANCELLABLE_STATUSES\s*=\s*new Set\(\[\s*"SEEKING_COURIER",\s*"ACCEPTED",\s*"ARRIVING_PICKUP",\s*"AT_PICKUP",?\s*\]\)/,
    );
    expect(tsx).toContain("orders/${encodeURIComponent(targetOrderId)}/cancel");
    expect(tsx).toContain("Motivo de cancelación");
    expect(tsx).toContain("Confirmar cancelación");
    expect(tsx).toContain('busyAction === "cancel"');
    expect(tsx).toContain('minHeight: "44px", minWidth: "44px"');
    expect(tsx).toContain("maxLength={200}");
    expect(tsx).toContain('role="alert"');
    expect(tsx).toContain("cancelError");
  });
  test("BUG-06: tracking/[token]/page.tsx muestra linea de tiempo de events y boton Actualizar manual sin auto-refresco", () => {
    const pageTsx = readFileSync(trackingPagePath, "utf8");
    expect(pageTsx).toContain('data-testid="tracking-timeline"');
    expect(pageTsx).toContain("tracking.events");
    expect(pageTsx).toContain('timeZone: "America/Bogota"');
    expect(pageTsx).toContain("TrackingRefreshButton");
    expect(pageTsx).not.toContain("setInterval");
    const btnTsx = readFileSync(trackingRefreshPath, "utf8");
    expect(btnTsx).toContain("router.refresh()");
    expect(btnTsx).toContain("Actualizar");
    expect(btnTsx).toContain('minHeight: "44px"');
    expect(btnTsx).toContain('fontFamily: "inherit"');
    expect(btnTsx).not.toContain("setInterval");
  });
});
