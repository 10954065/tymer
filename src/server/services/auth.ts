import { eq, sql } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import type { DbClient } from "@/server/db/client";
import { users } from "@/server/db/schema";
import {
  assertPasswordPolicy,
  hashPassword,
  verifyAgainstDummy,
  verifyPassword,
} from "@/server/auth/password";
import { createSession, invalidateUserSessions, type SessionUser } from "@/server/auth/sessions";
import { recordAudit } from "./audit";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

const GENERIC_LOGIN_ERROR = "Incorrect username or password";

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: SessionUser;
}

export async function login(
  db: DbClient,
  input: { username: string; password: string },
  meta: { userAgent?: string | null; ipAddress?: string | null } = {},
): Promise<LoginResult> {
  const username = input.username.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.username})`, username))
    .limit(1);

  if (!user) {
    await verifyAgainstDummy(input.password);
    throw new AppError("UNAUTHENTICATED", GENERIC_LOGIN_ERROR);
  }
  if (!user.isActive) {
    await verifyAgainstDummy(input.password);
    throw new AppError("UNAUTHENTICATED", GENERIC_LOGIN_ERROR);
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new AppError("RATE_LIMITED", `Account temporarily locked. Try again in ${minutes} minute(s).`);
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    const attempts = user.failedLoginAttempts + 1;
    const lock = attempts >= MAX_FAILED_ATTEMPTS;
    await db
      .update(users)
      .set({
        failedLoginAttempts: lock ? 0 : attempts,
        lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
      })
      .where(eq(users.id, user.id));
    if (lock) {
      await recordAudit(db, {
        userId: user.id,
        action: "auth.locked",
        entityType: "user",
        entityId: user.id,
        reason: `${MAX_FAILED_ATTEMPTS} failed sign-in attempts`,
      });
    }
    throw new AppError("UNAUTHENTICATED", GENERIC_LOGIN_ERROR);
  }

  await db
    .update(users)
    .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, user.id));
  const session = await createSession(db, user.id, meta);
  return {
    ...session,
    user: {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

export async function changeOwnPassword(
  db: DbClient,
  userId: string,
  currentSessionId: string,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError("NOT_FOUND", "User not found");
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new AppError("VALIDATION", "Current password is incorrect", {
      fieldErrors: { currentPassword: "Incorrect password" },
    });
  }
  if (input.currentPassword === input.newPassword) {
    throw new AppError("VALIDATION", "Choose a different password", { fieldErrors: { newPassword: "Must differ from current" } });
  }
  assertPasswordPolicy(input.newPassword);
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(input.newPassword), mustChangePassword: false })
    .where(eq(users.id, userId));
  await invalidateUserSessions(db, userId, currentSessionId);
  await recordAudit(db, { userId, action: "auth.password_changed", entityType: "user", entityId: userId });
}
