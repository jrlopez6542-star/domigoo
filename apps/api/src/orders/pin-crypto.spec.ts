import { defaultPinEnv } from "../config/env.js";
import { decryptPin, encryptPin, generatePin, hashPin, verifyPinHmac } from "./pin-crypto.js";

describe("pin-crypto (M25)", () => {
  const { pinPepper, appEncryptionKey } = defaultPinEnv();
  const orderId = "11111111-1111-1111-1111-111111111111";
  const otherOrderId = "22222222-2222-2222-2222-222222222222";

  it("genera PINes numéricos de la longitud solicitada", () => {
    const pin6 = generatePin(6);
    expect(pin6).toMatch(/^\d{6}$/);

    const pin4 = generatePin(4);
    expect(pin4).toMatch(/^\d{4}$/);
  });

  it("verifica HMAC-SHA-256 en tiempo constante ligado a orderId y kind", () => {
    const pin = "482910";
    const h = hashPin(pin, orderId, "PICKUP", pinPepper);

    expect(verifyPinHmac("482910", h, orderId, "PICKUP", pinPepper)).toBe(true);
    expect(verifyPinHmac("482911", h, orderId, "PICKUP", pinPepper)).toBe(false);
    expect(verifyPinHmac("482910", h, orderId, "DELIVERY", pinPepper)).toBe(false);
    expect(verifyPinHmac("482910", h, otherOrderId, "PICKUP", pinPepper)).toBe(false);
  });

  it("cifra y descifra con AES-256-GCM y rechaza reutilización en otro kind u orderId", () => {
    const pin = "739204";
    const ct = encryptPin(pin, orderId, "PICKUP", appEncryptionKey);

    expect(ct).not.toContain(pin);
    expect(decryptPin(ct, orderId, "PICKUP", appEncryptionKey)).toBe(pin);

    expect(() => decryptPin(ct, orderId, "DELIVERY", appEncryptionKey)).toThrow();
    expect(() => decryptPin(ct, otherOrderId, "PICKUP", appEncryptionKey)).toThrow();
  });
});
