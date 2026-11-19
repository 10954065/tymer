"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppError, type ActionResult } from "@/lib/errors";
import { homePathFor } from "@/lib/permissions";
import { changePasswordSchema, loginSchema } from "@/lib/validation/users";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/cookie";
import { requireActionPermission } from "@/server/auth/current-user";
import { checkRateLimit } from "@/server/auth/rate-limit";
import { invalidateSessionToken } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import { changeOwnPassword, login } from "@/server/services/auth";
import { parseInput, runAction } from "./run";

async function requestMeta() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ipAddress: forwarded || h.get("x-real-ip") || "unknown", userAgent: h.get("user-agent") };
}

export async function loginAction(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const data = parseInput(loginSchema, input);
    const meta = await requestMeta();
    const limit = checkRateLimit(`login:${meta.ipAddress}`, 20, 15 * 60_000);
    if (!limit.allowed) {
      throw new AppError("RATE_LIMITED", "Too many sign-in attempts. Please wait a few minutes and try again.");
    }
    const result = await login(getDb(), data, meta);
    (await cookies()).set(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));
    return { redirectTo: result.user.mustChangePassword ? "/account?required=1" : homePathFor(result.user.role) };
  });
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await invalidateSessionToken(getDb(), token);
  }
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function changePasswordAction(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const session = await requireActionPermission();
    const data = parseInput(changePasswordSchema, input);
    await changeOwnPassword(getDb(), session.user.id, session.sessionId, data);
    return { redirectTo: homePathFor(session.user.role) };
  });
}
