export const SESSION_COOKIE = "domigoo_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

export function sessionCookieHeader(token: string, secure: boolean): string {
  return serialize(token, MAX_AGE_SECONDS, secure);
}

export function clearSessionCookie(secure: boolean): string {
  return serialize("", 0, secure);
}

export function readSessionCookie(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const parts = header.split(";");
  for (const part of parts) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      const value = rest.join("=");
      return value === "" ? undefined : value;
    }
  }
  return undefined;
}

function serialize(token: string, maxAge: number, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${String(maxAge)}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}
