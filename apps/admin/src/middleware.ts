import { NextResponse, type NextRequest } from "next/server";

export const SESSION_COOKIE = "domigoo_session";

export const ADMIN_SESSION_HEADER = "x-domigoo-admin-session";

export function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value;
  const hasSessionCookie = typeof sessionCookie === "string" && sessionCookie.trim().length > 0;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(ADMIN_SESSION_HEADER, hasSessionCookie ? "1" : "0");
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
