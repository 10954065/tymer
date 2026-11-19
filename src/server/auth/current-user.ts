import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { AppError } from "@/lib/errors";
import { can, type Permission } from "@/lib/permissions";
import { getDb } from "@/server/db/client";
import { SESSION_COOKIE } from "./cookie";
import { validateSessionToken, type ValidatedSession } from "./sessions";

/** Reads and validates the session once per request. */
export const getCurrentSession = cache(async (): Promise<ValidatedSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSessionToken(getDb(), token);
});

/** For pages and layouts: redirects to /login when signed out. */
export async function requireSession(): Promise<ValidatedSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}

/** For pages: redirects to the no-access page when the role lacks the permission. */
export async function requirePagePermission(permission: Permission): Promise<ValidatedSession> {
  const session = await requireSession();
  if (session.user.mustChangePassword) redirect("/account?required=1");
  if (!can(session.user.role, permission)) redirect("/no-access");
  return session;
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function requireActionPermission(permission?: Permission): Promise<ValidatedSession> {
  const session = await getCurrentSession();
  if (!session) throw new AppError("UNAUTHENTICATED", "Your session has expired. Please sign in again.");
  if (permission && !can(session.user.role, permission)) {
    throw new AppError("FORBIDDEN", "You do not have permission to perform this action.");
  }
  return session;
}

export function actorOf(session: ValidatedSession) {
  return { id: session.user.id, role: session.user.role };
}
