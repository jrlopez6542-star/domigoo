import { AuthError, CURRENT_LEGAL_VERSION, parseRegistrationInput } from "./identity.service.js";

describe("parseRegistrationInput (M45 casillas legales)", () => {
  const base = {
    email: "usuario@example.invalid",
    password: "clave-segura-123",
    client: "WEB",
  };

  it("rechaza el registro si faltan las casillas obligatorias de términos o datos personales", () => {
    expect(() => parseRegistrationInput(base)).toThrow(AuthError);
    expect(() =>
      parseRegistrationInput({
        ...base,
        consents: { termsAccepted: true, privacyAccepted: false },
      }),
    ).toThrow(AuthError);
    expect(() =>
      parseRegistrationInput({
        ...base,
        consents: { termsAccepted: false, privacyAccepted: true },
      }),
    ).toThrow(AuthError);
  });

  it("exige autorización explícita de datos sensibles cuando el perfil es COURIER", () => {
    expect(() =>
      parseRegistrationInput({
        ...base,
        client: "MOBILE",
        role: "COURIER",
        consents: { termsAccepted: true, privacyAccepted: true, sensitiveDataAccepted: false },
      }),
    ).toThrow(AuthError);

    const parsed = parseRegistrationInput({
      ...base,
      client: "MOBILE",
      role: "COURIER",
      consents: { termsAccepted: true, privacyAccepted: true, sensitiveDataAccepted: true },
    });
    expect(parsed.role).toBe("COURIER");
    expect(parsed.consents.sensitiveDataAccepted).toBe(true);
    expect(parsed.consents.marketingAccepted).toBe(false);
    expect(parsed.consents.version).toBe(CURRENT_LEGAL_VERSION);
  });

  it("permite registrar restaurante o cliente sin marketing opcional", () => {
    const parsed = parseRegistrationInput({
      ...base,
      role: "RESTAURANT",
      consents: { termsAccepted: true, privacyAccepted: true },
    });
    expect(parsed.role).toBe("RESTAURANT");
    expect(parsed.consents.marketingAccepted).toBe(false);
    expect(parsed.consents.termsAccepted).toBe(true);
    expect(parsed.consents.privacyAccepted).toBe(true);
  });
});
