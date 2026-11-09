import { parseColombianPhone } from "./phone.js";

describe("parseColombianPhone", () => {
  it("acepta un móvil colombiano en E.164", () => {
    expect(parseColombianPhone(" +573001112233 ")).toBe("+573001112233");
  });

  it("rechaza un número sin indicativo, corto o de otro país", () => {
    expect(() => parseColombianPhone("3001112233")).toThrow(/Colombia/);
    expect(() => parseColombianPhone("+57300111223")).toThrow(/Colombia/);
    expect(() => parseColombianPhone("+14155552671")).toThrow(/Colombia/);
  });
});
