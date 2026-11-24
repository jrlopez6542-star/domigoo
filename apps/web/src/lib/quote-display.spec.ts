import fs from "node:fs";
import path from "node:path";
import { ProxyError } from "./api-client.js";
import { formatQuote, formatQuoteError, QUOTE_UNAVAILABLE_TEXT } from "./quote-display.js";

describe("formatQuote y contrato de cotización en /cliente/tarifa (ORDEN 018)", () => {
  it("formatea respuesta válida de POST /v1/tariffs/quote con $ COP (es-CO) y km con 1 decimal", () => {
    const text = formatQuote({
      versionId: "ver-1",
      zoneCode: "TOCANCIPA_25817",
      distanceMeters: 1250,
      deliveryFeeCop: 5500,
    });
    const expectedFee = (5500).toLocaleString("es-CO");
    expect(text).toBe(`Domicilio estimado: $${expectedFee} COP · Distancia estimada: 1,3 km`);
    expect(text).toContain("$");
    expect(
      formatQuote({ versionId: "v", zoneCode: null, distanceMeters: 12345, deliveryFeeCop: 12000 }),
    ).toBe(
      `Domicilio estimado: $${(12000).toLocaleString("es-CO")} COP · Distancia estimada: 12,3 km`,
    );
    expect(text).toContain("km");
    expect(text).not.toContain("?");
  });

  it("acepta deliveryFeeCop=0 y distanceMeters=0 como valores válidos", () => {
    const text = formatQuote({
      versionId: "ver-1",
      zoneCode: null,
      distanceMeters: 0,
      deliveryFeeCop: 0,
    });
    expect(text).toBe("Domicilio estimado: $0 COP · Distancia estimada: 0,0 km");
    expect(text).not.toContain("?");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["objeto vacío", {}],
    ["solo deliveryFeeCop", { deliveryFeeCop: 5500 }],
    ["solo distanceMeters", { distanceMeters: 800 }],
    ["deliveryFeeCop NaN", { deliveryFeeCop: Number.NaN, distanceMeters: 800 }],
    ["distanceMeters NaN", { deliveryFeeCop: 5500, distanceMeters: Number.NaN }],
    ["distanceMeters Infinity", { deliveryFeeCop: 5500, distanceMeters: Number.POSITIVE_INFINITY }],
    ["deliveryFeeCop decimal", { deliveryFeeCop: 5500.5, distanceMeters: 800 }],
    ["deliveryFeeCop negativo", { deliveryFeeCop: -100, distanceMeters: 800 }],
    ["distanceMeters negativo", { deliveryFeeCop: 5500, distanceMeters: -50 }],
    ["campos legacy distanceKm y totalCop", { distanceKm: 1.4, totalCop: 5500 }],
    ["strings en lugar de números", { deliveryFeeCop: "5500", distanceMeters: "800" }],
  ])("devuelve 'Valor por confirmar' sin '?' para entrada inválida: %s", (_label, input) => {
    const result = formatQuote(input);
    expect(result).toBe(QUOTE_UNAVAILABLE_TEXT);
    expect(result).not.toContain("?");
  });

  it("formatQuoteError devuelve 'Valor por confirmar' y conserva mensaje de cobertura solo en 422", () => {
    const coverageMsg =
      "La dirección está fuera de la zona de cobertura del municipio de Tocancipá (DIVIPOLA 25817)";
    expect(formatQuoteError(new ProxyError(coverageMsg, 422, "OUT_OF_COVERAGE_ZONE"))).toEqual({
      quoteText: "Valor por confirmar",
      quoteError: coverageMsg,
    });
    expect(formatQuoteError(new ProxyError("Not Found", 404))).toEqual({
      quoteText: "Valor por confirmar",
      quoteError: "",
    });
    expect(formatQuoteError(new Error("Fallo de red"))).toEqual({
      quoteText: "Valor por confirmar",
      quoteError: "",
    });
  });

  it("client-portal.tsx usa TariffQuoteResponse y formatQuote sin campos legacy ni '?'", () => {
    const content = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/client-portal.tsx"),
      "utf8",
    );
    const start = content.indexOf("async function handleEstimateDelivery(");
    const end = content.indexOf("if (checkingSession)");
    const fnBody = content.slice(start, end);

    expect(fnBody).toContain("TariffQuoteResponse");
    expect(fnBody).toContain("formatQuote(data)");
    expect(fnBody).toContain("formatQuoteError(err)");
    expect(fnBody).not.toContain("distanceKm");
    expect(fnBody).not.toContain("totalCop");
    expect(fnBody).not.toContain('"?');
    expect(fnBody).not.toContain("? km");
  });
});
