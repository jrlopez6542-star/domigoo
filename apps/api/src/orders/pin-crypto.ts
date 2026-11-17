import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export type PinKind = "PICKUP" | "DELIVERY";

/**
 * Genera un PIN numérico usando CSPRNG y rechazo de sesgo de módulo (rejection sampling).
 * Solo acepta bytes < 250 para distribuir uniformemente en 0..9.
 */
export function generatePin(length = 6): string {
  if (!Number.isInteger(length) || length < 4 || length > 12) {
    throw new Error("La longitud del PIN debe estar entre 4 y 12 dígitos");
  }
  let pin = "";
  while (pin.length < length) {
    const buf = randomBytes(length * 2);
    for (const byte of buf) {
      if (byte < 250) {
        pin += String(byte % 10);
        if (pin.length === length) {
          break;
        }
      }
    }
  }
  return pin;
}

export function hashPin(pin: string, orderId: string, kind: PinKind, pepper: string): string {
  return createHmac("sha256", pepper).update(`${orderId}:${kind}:${pin}`, "utf8").digest("hex");
}

export function verifyPinHmac(
  candidatePin: string,
  expectedHashHex: string,
  orderId: string,
  kind: PinKind,
  pepper: string,
): boolean {
  if (!/^[0-9a-f]{64}$/i.test(expectedHashHex)) {
    return false;
  }
  const actualBuf = Buffer.from(hashPin(candidatePin, orderId, kind, pepper), "hex");
  const expectedBuf = Buffer.from(expectedHashHex, "hex");
  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(actualBuf, expectedBuf);
}

export function encryptPin(pin: string, orderId: string, kind: PinKind, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error("La clave AES-256-GCM debe tener exactamente 32 bytes");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${orderId}:${kind}`, "utf8"));
  const encrypted = Buffer.concat([cipher.update(pin, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptPin(
  ciphertext: string,
  orderId: string,
  kind: PinKind,
  key: Buffer,
): string {
  if (key.length !== 32) {
    throw new Error("La clave AES-256-GCM debe tener exactamente 32 bytes");
  }
  const parts = ciphertext.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Formato de PIN cifrado inválido");
  }
  const iv = Buffer.from(parts[1] ?? "", "hex");
  const tag = Buffer.from(parts[2] ?? "", "hex");
  const data = Buffer.from(parts[3] ?? "", "hex");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(`${orderId}:${kind}`, "utf8"));
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}
