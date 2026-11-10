import { randomBytes, timingSafeEqual } from "node:crypto";
import { argon2id } from "@noble/hashes/argon2.js";

const ITERATIONS = 2;
const MEMORY_KIB = 19_456;
const PARALLELISM = 1;
const HASH_BYTES = 32;
const SALT_BYTES = 16;

const OPTIONS = {
  t: ITERATIONS,
  m: MEMORY_KIB,
  p: PARALLELISM,
  dkLen: HASH_BYTES,
} as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = argon2id(Buffer.from(password, "utf8"), salt, OPTIONS);
  return encode(salt, hash);
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parsed = decode(encoded);
  if (parsed === null) {
    return false;
  }
  const hash = argon2id(Buffer.from(password, "utf8"), parsed.salt, OPTIONS);
  if (hash.length !== parsed.hash.length) {
    return false;
  }
  return timingSafeEqual(hash, parsed.hash);
}

function encode(salt: Uint8Array, hash: Uint8Array): string {
  return `$argon2id$v=19$m=${String(MEMORY_KIB)},t=${String(ITERATIONS)},p=${String(PARALLELISM)}$${b64(salt)}$${b64(hash)}`;
}

function decode(encoded: string): { salt: Uint8Array; hash: Uint8Array } | null {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[1] !== "argon2id" || parts[2] !== "v=19") {
    return null;
  }
  if (parts[3] !== `m=${String(MEMORY_KIB)},t=${String(ITERATIONS)},p=${String(PARALLELISM)}`) {
    return null;
  }
  const saltPart = parts[4];
  const hashPart = parts[5];
  if (saltPart === undefined || hashPart === undefined) {
    return null;
  }
  const salt = fromB64(saltPart);
  const hash = fromB64(hashPart);
  if (salt.length !== SALT_BYTES || hash.length !== HASH_BYTES) {
    return null;
  }
  return { salt, hash };
}

function b64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function fromB64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}
