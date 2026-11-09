const SECRET_KEYS = new Set([
  "password",
  "passwordHash",
  "token",
  "tokenHash",
  "pin",
  "ciphertext",
  "authorization",
  "cookie",
]);

export function redactDiff(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactDiff(item));
  }
  if (typeof value === "object" && value !== null) {
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      redacted[key] = SECRET_KEYS.has(key) ? "[redactado]" : redactDiff(item);
    }
    return redacted;
  }
  return value;
}
