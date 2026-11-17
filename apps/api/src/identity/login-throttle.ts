const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export class LoginLimitedError extends Error {
  constructor(readonly retryAfterSeconds = 900) {
    super("Demasiados intentos. Espera antes de volver a intentar.");
    this.name = "LoginLimitedError";
  }
}

export function assertLoginAllowed(key: string, now = Date.now()): void {
  const bucket = buckets.get(key);
  if (bucket !== undefined && bucket.resetAt > now && bucket.count >= MAX_FAILURES) {
    throw new LoginLimitedError();
  }
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  const bucket = buckets.get(key);
  if (bucket === undefined || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  bucket.count += 1;
}

export function clearLoginFailures(key: string): void {
  buckets.delete(key);
}

export function resetLoginThrottle(): void {
  buckets.clear();
}
