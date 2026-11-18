import { NextResponse, type NextRequest } from "next/server";

const ROLE_PREFIX: Record<string, string> = {
  CUSTOMER: "/cliente",
  RESTAURANT: "/restaurante",
  COURIER: "/domiciliario",
};

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const activeRole = request.cookies.get("domigoo_role")?.value;

  if (activeRole && activeRole in ROLE_PREFIX) {
    const allowedPrefix = ROLE_PREFIX[activeRole];
    if (allowedPrefix && !pathname.startsWith(allowedPrefix)) {
      const target = new URL(allowedPrefix, request.url);
      const redirectResponse = NextResponse.redirect(target);
      redirectResponse.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
      return redirectResponse;
    }
  }

  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  return response;
}

export const config = {
  matcher: ["/cliente/:path*", "/restaurante/:path*", "/domiciliario/:path*"],
};
