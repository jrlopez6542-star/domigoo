import { quoteCop } from "./quote.js";
import { isNightInBogota } from "./bogota-time.js";

describe("quoteCop", () => {
  it("calcula en pesos enteros, con mínimo y recargo nocturno", () => {
    const day = quoteCop({
      baseFeeCop: 3000,
      perKmCop: 1000,
      minimumFeeCop: 0,
      distanceMeters: 2500,
      nightMultiplierBps: 12000,
      isNight: false,
    });
    expect(day).toBe(5500);
    expect(Number.isInteger(day)).toBe(true);

    const night = quoteCop({
      baseFeeCop: 3000,
      perKmCop: 1000,
      minimumFeeCop: 0,
      distanceMeters: 2500,
      nightMultiplierBps: 12000,
      isNight: true,
    });
    expect(night).toBe(6600);

    const floored = quoteCop({
      baseFeeCop: 3000,
      perKmCop: 1000,
      minimumFeeCop: 7000,
      distanceMeters: 2500,
      nightMultiplierBps: 10000,
      isNight: false,
    });
    expect(floored).toBe(7000);
  });
});

describe("isNightInBogota", () => {
  it("usa la hora de América/Bogotá y cruza la medianoche", () => {
    expect(isNightInBogota(new Date("2026-01-15T03:30:00.000Z"), 1320, 360)).toBe(true);
    expect(isNightInBogota(new Date("2026-01-15T18:00:00.000Z"), 1320, 360)).toBe(false);
  });
});
