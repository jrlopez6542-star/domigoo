import { clearSessionCookie, sessionCookieHeader } from "./session-cookie.js";

describe("sessionCookieHeader", () => {
  it("marca HttpOnly y SameSite, y Secure solo fuera de local", () => {
    const local = sessionCookieHeader("token-de-prueba", false);
    expect(local).toContain("HttpOnly");
    expect(local).toContain("SameSite=Lax");
    expect(local).not.toContain("Secure");

    const deployed = sessionCookieHeader("token-de-prueba", true);
    expect(deployed).toContain("Secure");
    expect(clearSessionCookie(true)).toContain("Max-Age=0");
  });
});
