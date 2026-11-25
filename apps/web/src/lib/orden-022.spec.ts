import fs from "node:fs";
import path from "node:path";
import {
  branchHoursSignature,
  buildBranchHoursSlots,
  hydrateBranchHoursForm,
  minutesToTimeString,
  parseBranchHoursSignature,
} from "./portal-helpers.js";

describe("ORDEN 022 - Web: horario medianoche (1440 <-> 00:00), preservación de edición y couriers/me", () => {
  it("minutesToTimeString para cierre convierte 1440 a 00:00 y hydrateBranchHoursForm lo refleja", () => {
    expect(minutesToTimeString(1440, { isClosing: true })).toBe("00:00");
    expect(minutesToTimeString(1380, { isClosing: true })).toBe("23:00");
    expect(
      hydrateBranchHoursForm([
        { weekday: 5, opensMinute: 1080, closesMinute: 1440, closed: false },
        { weekday: 6, opensMinute: 1080, closesMinute: 1440, closed: false },
      ]),
    ).toEqual({
      weekdays: [5, 6],
      opensTime: "18:00",
      closesTime: "00:00",
      hasMixedSchedule: false,
      notice: null,
    });
  });

  it("buildBranchHoursSlots acepta closesTime 00:00 como 1440 si opensMinute > 0 y rechaza 00:00 -> 00:00", () => {
    expect(
      buildBranchHoursSlots({
        weekdays: [5, 6],
        opensTime: "18:00",
        closesTime: "00:00",
      }),
    ).toEqual({
      ok: true,
      slots: [
        { weekday: 5, opensMinute: 1080, closesMinute: 1440, closed: false },
        { weekday: 6, opensMinute: 1080, closesMinute: 1440, closed: false },
      ],
    });

    expect(
      buildBranchHoursSlots({
        weekdays: [1],
        opensTime: "00:01",
        closesTime: "00:00",
      }),
    ).toEqual({
      ok: true,
      slots: [{ weekday: 1, opensMinute: 1, closesMinute: 1440, closed: false }],
    });

    expect(
      buildBranchHoursSlots({
        weekdays: [1],
        opensTime: "00:00",
        closesTime: "00:00",
      }),
    ).toEqual({
      ok: false,
      message: "La hora de cierre debe ser posterior a la de apertura.",
    });
  });

  it("branchHoursSignature produce firma estable entre referencias nuevas con igual contenido y detecta cambios reales", () => {
    const firstRef = [
      { weekday: 1, opensMinute: 480, closesMinute: 1260, closed: false },
      { weekday: 2, opensMinute: 480, closesMinute: 1260, closed: false },
    ];
    const clonedRef = firstRef.map((slot) => ({ ...slot }));
    const changedRef = [
      { weekday: 1, opensMinute: 540, closesMinute: 1440, closed: false },
      { weekday: 2, opensMinute: 540, closesMinute: 1440, closed: false },
    ];

    expect(branchHoursSignature(firstRef)).toBe(branchHoursSignature(clonedRef));
    expect(branchHoursSignature(undefined)).toBe(branchHoursSignature([]));
    expect(branchHoursSignature(firstRef)).not.toBe(branchHoursSignature(changedRef));
    expect(parseBranchHoursSignature(branchHoursSignature(firstRef))).toEqual(firstRef);
  });

  it("restaurant-portal.tsx hidrata el formulario usando la firma serializada de hours y no la referencia directa del arreglo", () => {
    const restaurantTsx = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/restaurant-portal.tsx"),
      "utf8",
    );
    expect(restaurantTsx).toContain("branchHoursSignature(selectedBranch?.hours)");
    expect(restaurantTsx).toContain("[selectedBranchId, selectedBranchHoursSignature]");
    expect(restaurantTsx).not.toContain("[selectedBranchId, selectedBranchHours]");
  });

  it("courier-portal.tsx consulta couriers/me al cargar sesión, muestra estado en español y conserva Pendiente por crear en 404", () => {
    const courierTsx = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/courier-portal.tsx"),
      "utf8",
    );
    expect(courierTsx).toContain(
      'callProxy<{\n        id: string;\n        status: string;\n        firstName: string;\n        lastName: string;\n      }>("couriers/me", "GET")',
    );
    expect(courierTsx).toContain("void loadMyProfile()");
    expect(courierTsx).toContain("courierStatusLabel(courierStatus)");
    expect(courierTsx).toContain("Pendiente por crear");
  });
});
