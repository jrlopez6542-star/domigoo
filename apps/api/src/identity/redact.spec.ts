import { redactDiff } from "../audit/redact-diff.js";
import { redact } from "./redact.js";

describe("redact", () => {
  it("quita contraseñas, cookies, tokens, ciphertexts y documento del texto y del diff", () => {
    const original =
      "fallo password=clave-de-prueba-12 Authorization: Bearer abc.def cookie=domigoo_session=secreto pushToken=fcm-123 documentNumber=10203040 pickupPinCiphertext=v1:aa:bb:cc";
    const cleaned = redact(original);
    expect(cleaned).not.toContain("clave-de-prueba-12");
    expect(cleaned).not.toContain("abc.def");
    expect(cleaned).not.toContain("domigoo_session=secreto");
    expect(cleaned).not.toContain("fcm-123");
    expect(cleaned).not.toContain("10203040");
    expect(cleaned).not.toContain("v1:aa:bb:cc");
    expect(cleaned).toContain("[redactado]");

    const diff = redactDiff({
      pickupPinCiphertext: "v1:11:22:33",
      deliveryPinCiphertext: "v1:44:55:66",
      tokenCiphertext: "v1:77:88:99",
      pushToken: "fcm-xyz",
      documentNumber: "900123456",
      status: "PICKED_UP",
    });
    expect(diff).toEqual({
      pickupPinCiphertext: "[redactado]",
      deliveryPinCiphertext: "[redactado]",
      tokenCiphertext: "[redactado]",
      pushToken: "[redactado]",
      documentNumber: "[redactado]",
      status: "PICKED_UP",
    });
  });
});
