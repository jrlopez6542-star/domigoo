import fs from "node:fs";
import path from "node:path";
import { ProxyError } from "./api-client.js";
import { orderStatusLabel, STATUS_LABELS } from "./order-status.js";
import {
  isRestaurantOrBranchInactive,
  resolveRestaurantOrderActionError,
  RESTAURANT_INACTIVE_MESSAGE,
} from "./portal-helpers.js";

describe("ORDEN 019 - Web: restaurante no activo y etiquetas de estado sin códigos entre paréntesis", () => {
  it("isRestaurantOrBranchInactive detecta sucursal o restaurante no ACTIVE", () => {
    expect(isRestaurantOrBranchInactive(undefined)).toBe(false);
    expect(isRestaurantOrBranchInactive({ status: "DRAFT" })).toBe(true);
    expect(isRestaurantOrBranchInactive({ status: "PAUSED" })).toBe(true);
    expect(isRestaurantOrBranchInactive({ status: "CLOSED" })).toBe(true);
    expect(isRestaurantOrBranchInactive({ status: "ACTIVE" })).toBe(false);
    expect(
      isRestaurantOrBranchInactive({ status: "ACTIVE", restaurantStatus: "PENDING_REVIEW" }),
    ).toBe(true);
    expect(isRestaurantOrBranchInactive({ status: "ACTIVE", restaurantStatus: "SUSPENDED" })).toBe(
      true,
    );
    expect(isRestaurantOrBranchInactive({ status: "ACTIVE", restaurantStatus: "ACTIVE" })).toBe(
      false,
    );
  });

  it("resolveRestaurantOrderActionError traduce 404 al mensaje claro en segunda persona y conserva otros errores", () => {
    expect(
      resolveRestaurantOrderActionError(new ProxyError("Not Found", 404), "Error genérico"),
    ).toBe(RESTAURANT_INACTIVE_MESSAGE);
    expect(
      resolveRestaurantOrderActionError(
        new ProxyError("La dirección está fuera de cobertura", 422),
        "Error genérico",
      ),
    ).toBe("La dirección está fuera de cobertura");
    expect(resolveRestaurantOrderActionError(new Error("Fallo de red"), "Error genérico")).toBe(
      "Fallo de red",
    );
    expect(resolveRestaurantOrderActionError("desconocido", "Error genérico")).toBe(
      "Error genérico",
    );
  });

  it("orderStatusLabel no incluye códigos en mayúsculas entre paréntesis para ningún estado conocido", () => {
    for (const [code, label] of Object.entries(STATUS_LABELS)) {
      expect(orderStatusLabel(code)).toBe(label);
      expect(label).not.toMatch(/\([A-Z_]{3,}\)/);
    }
    expect(orderStatusLabel("DELIVERED")).toBe("Entregado");
    expect(orderStatusLabel("EXPIRED")).toBe("Expirado");
  });

  it("tracking/[token]/page.tsx no muestra códigos entre paréntesis ni en estado actual ni en historial", () => {
    const trackingPage = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/tracking/[token]/page.tsx"),
      "utf8",
    );
    expect(trackingPage).toContain("orderStatusLabel(tracking.status)");
    expect(trackingPage).toContain("orderStatusLabel(ev.toStatus)");
    expect(trackingPage).not.toContain("({tracking.status})");
    expect(trackingPage).not.toContain("({ev.toStatus})");
  });

  it("restaurant-portal.tsx muestra aviso en /restaurante y /restaurante/nuevo-domicilio, deshabilita crear/publicar y maneja 404 sin error técnico", () => {
    const portal = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/restaurant-portal.tsx"),
      "utf8",
    );
    expect(portal).toContain("isRestaurantOrBranchInactive");
    expect(portal).toContain("resolveRestaurantOrderActionError");
    expect(portal).toContain("RESTAURANT_INACTIVE_MESSAGE");

    const homeStart = portal.indexOf("export function RestaurantHomeScreen()");
    const homeEnd = portal.indexOf("export function RestaurantNegocioScreen()");
    const homeBlock = portal.slice(homeStart, homeEnd);
    expect(homeBlock).toContain('data-testid="restaurante-inactivo-banner"');
    expect(homeBlock).toContain("RESTAURANT_INACTIVE_MESSAGE");

    const nuevoStart = portal.indexOf("export function RestaurantNuevoDomicilioScreen()");
    const nuevoEnd = portal.indexOf("export function RestaurantPedidosScreen()");
    const nuevoBlock = portal.slice(nuevoStart, nuevoEnd);
    expect(nuevoBlock).toContain('data-testid="restaurante-inactivo-banner"');
    expect(nuevoBlock).toContain(
      '!sessionUser || busyAction === "draft" || hasNoBranches || restaurantNotActive',
    );
    expect(nuevoBlock).toContain(
      '!sessionUser || !orderId || busyAction === "publish" || restaurantNotActive',
    );
  });
});
