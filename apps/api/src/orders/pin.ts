import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export type PinKind = "PICKUP" | "DELIVERY";

const PICKUP_PIN_STATES = new Set(["ACCEPTED", "ARRIVING_PICKUP", "AT_PICKUP"]);

export function showsPickupPin(status: string): boolean {
  return PICKUP_PIN_STATES.has(status);
}

export function pinDecision(attempts: number, max: number): "allow" | "locked" {
  return attempts < max ? "allow" : "locked";
}

export function generatePin(length: number, random: (size: number) => Uint8Array): string {
  if (!Number.isInteger(length) || length < 4 || length > 8) {
    throw new Error("La longitud del PIN no es válida");
  }
  let pin = "";
  while (pin.length < length) {
    const bytes = random(32);
    if (bytes.length === 0) {
      throw new Error("No se pudo generar el PIN");
    }
    for (const byte of bytes) {
      if (byte < 250 && pin.length < length) {
        pin += String(byte % 10);
      }
    }
  }
  return pin;
}

export function pinMac(pepper: Uint8Array, orderId: string, kind: PinKind, pin: string): Buffer {
  return createHmac("sha256", pepper).update(`${orderId}\0${kind}\0${pin}`).digest();
}

export function macsEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function sealPin(key: Uint8Array, orderId: string, kind: PinKind, pin: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${orderId}:${kind}`));
  const body = Buffer.concat([cipher.update(pin, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function openPin(
  key: Uint8Array,
  orderId: string,
  kind: PinKind,
  ciphertext: string,
): string | null {
  try {
    const packed = Buffer.from(ciphertext, "base64");
    if (packed.length < 29) {
      return null;
    }
    const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${orderId}:${kind}`));
    decipher.setAuthTag(packed.subarray(12, 28));
    return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
