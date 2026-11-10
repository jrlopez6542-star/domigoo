import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  allowedTransitions,
  canTransition,
  ORDER_STATUSES,
  type OrderStatus,
} from "./order-machine.js";

describe("máquina del pedido", () => {
  it("acepta cada flecha permitida", () => {
    for (const [from, to] of allowedTransitions()) {
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it("rechaza cancelar el restaurante después de recoger y saltar de borrador a entregado", () => {
    expect(canTransition("PICKED_UP", "CANCELLED_RESTAURANT")).toBe(false);
    expect(canTransition("PICKED_UP", "CANCELLED_COURIER")).toBe(false);
    expect(canTransition("DRAFT", "DELIVERED")).toBe(false);
  });

  it("no deja salir de un estado terminal", () => {
    const terminals: OrderStatus[] = [
      "DELIVERED",
      "EXPIRED",
      "CANCELLED_RESTAURANT",
      "CANCELLED_COURIER",
      "CANCELLED_ADMIN",
      "FAILED",
    ];
    for (const from of terminals) {
      for (const to of ORDER_STATUSES) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it("no importa el cliente de la base", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "order-machine.ts"),
      "utf8",
    );
    expect(source.includes("prisma")).toBe(false);
  });
});
