import fs from "node:fs";
import path from "node:path";
import {
  MIXED_BRANCH_HOURS_NOTICE,
  hydrateBranchHoursForm,
  minutesToTimeString,
} from "./portal-helpers.js";

describe("ORDEN 021 - Web: precarga de horario guardado, limpieza sin UUID visibles y loadMyBranches", () => {
  it("minutesToTimeString convierte minutos del día a HH:MM válido para input time", () => {
    expect(minutesToTimeString(0)).toBe("00:00");
    expect(minutesToTimeString(480)).toBe("08:00");
    expect(minutesToTimeString(570)).toBe("09:30");
    expect(minutesToTimeString(1260)).toBe("21:00");
    expect(minutesToTimeString(1440)).toBe("23:59");
  });

  it("hydrateBranchHoursForm devuelve L-D 08:00-21:00 cuando no hay horario guardado", () => {
    expect(hydrateBranchHoursForm(undefined)).toEqual({
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      opensTime: "08:00",
      closesTime: "21:00",
      hasMixedSchedule: false,
      notice: null,
    });
    expect(hydrateBranchHoursForm([])).toEqual({
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      opensTime: "08:00",
      closesTime: "21:00",
      hasMixedSchedule: false,
      notice: null,
    });
  });

  it("hydrateBranchHoursForm precarga días y horario uniforme guardado sin aviso mixto", () => {
    expect(
      hydrateBranchHoursForm([
        { weekday: 5, opensMinute: 570, closesMinute: 1185, closed: false },
        { weekday: 1, opensMinute: 570, closesMinute: 1185, closed: false },
        { weekday: 3, opensMinute: 570, closesMinute: 1185, closed: false },
        { weekday: 7, opensMinute: 0, closesMinute: 0, closed: true },
      ]),
    ).toEqual({
      weekdays: [1, 3, 5],
      opensTime: "09:30",
      closesTime: "19:45",
      hasMixedSchedule: false,
      notice: null,
    });
  });

  it("hydrateBranchHoursForm ante días con horas distintas usa el primer día abierto y devuelve aviso en español", () => {
    expect(
      hydrateBranchHoursForm([
        { weekday: 6, opensMinute: 600, closesMinute: 1320, closed: false },
        { weekday: 2, opensMinute: 540, closesMinute: 1080, closed: false },
        { weekday: 4, opensMinute: 540, closesMinute: 1080, closed: false },
      ]),
    ).toEqual({
      weekdays: [2, 4, 6],
      opensTime: "09:00",
      closesTime: "18:00",
      hasMixedSchedule: true,
      notice: MIXED_BRANCH_HOURS_NOTICE,
    });
  });

  it("hydrateBranchHoursForm si todos los días están marcados como cerrados devuelve weekdays vacío", () => {
    expect(
      hydrateBranchHoursForm([{ weekday: 1, opensMinute: 480, closesMinute: 1200, closed: true }]),
    ).toEqual({
      weekdays: [],
      opensTime: "08:00",
      closesTime: "21:00",
      hasMixedSchedule: false,
      notice: null,
    });
  });

  it("restaurant-portal.tsx y courier-portal.tsx no muestran UUIDs visibles, precargan hours y sacan setRestaurantId del updater de setBranchId", () => {
    const restaurantTsx = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/restaurant-portal.tsx"),
      "utf8",
    );
    expect(restaurantTsx).not.toContain("Restaurante: {restaurantId}");
    expect(restaurantTsx).not.toContain("Sucursal: {branchId");
    expect(restaurantTsx).not.toContain("Pedido <strong>{orderView.id}</strong>");
    expect(restaurantTsx).not.toContain("Borrador: {orderId}");
    expect(restaurantTsx).not.toContain("Borrador creado (${data.id})");
    expect(restaurantTsx).not.toContain("`${orderId} (");

    expect(restaurantTsx).toContain("hydrateBranchHoursForm(");
    expect(restaurantTsx).toContain('data-testid="branch-hours-mixed-notice"');
    expect(restaurantTsx).toContain("activeOrderReferenceCode");
    expect(restaurantTsx).toContain("selectedBranch.restaurantName");
    expect(restaurantTsx).toContain("selectedBranch.name");

    const loadBranchesStart = restaurantTsx.indexOf("const loadMyBranches = useCallback");
    const loadBranchesEnd = restaurantTsx.indexOf("const loadMyOrders = useCallback");
    const loadBranchesBlock = restaurantTsx.slice(loadBranchesStart, loadBranchesEnd);
    expect(loadBranchesBlock).not.toContain("setBranchId((prev)");
    expect(loadBranchesBlock).toContain("setBranchId(chosenBranch.id)");
    expect(loadBranchesBlock).toContain("setRestaurantId(chosenBranch.restaurantId)");

    const courierTsx = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/courier-portal.tsx"),
      "utf8",
    );
    expect(courierTsx).not.toContain("ID: ${data.id}");
    expect(courierTsx).not.toContain("ID domiciliario: {courierId}");
    expect(courierTsx).not.toContain("Perfil: {courierId ? courierId");
    expect(courierTsx).not.toContain("Entrega activa: {orderView.id}");
    expect(courierTsx).not.toContain("Pedido <strong>{orderView.id}</strong>");
    expect(courierTsx).toContain("orderView.referenceCode");
  });
});
