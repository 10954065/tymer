/** Session cookie settings. Kept dependency-free so `proxy.ts` can import it. */
export const SESSION_COOKIE = "slb_session";

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}
