import { redact } from "./redact.js";

describe("redact", () => {
  it("quita contraseñas, cookies y tokens del texto", () => {
    const original =
      "fallo password=clave-de-prueba-12 Authorization: Bearer abc.def cookie=domigoo_session=secreto";
    const cleaned = redact(original);
    expect(cleaned).not.toContain("clave-de-prueba-12");
    expect(cleaned).not.toContain("abc.def");
    expect(cleaned).not.toContain("domigoo_session=secreto");
    expect(cleaned).toContain("[redactado]");
  });
});
