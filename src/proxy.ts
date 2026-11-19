import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/cookie";

/**
 * Optimistic routing only: sends visitors without a session cookie to /login.
 * Real authentication and authorization happen server-side in every page, action and API route.
 */
const PUBLIC_PATHS = ["/login", "/offline"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPublic || request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }
  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Skip API routes (they authenticate themselves), Next internals and static/PWA assets.
    "/((?!api/|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/).*)",
  ],
};
