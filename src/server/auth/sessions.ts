import { and, eq, lt, ne } from "drizzle-orm";
import type { Role } from "@/lib/permissions";
import type { DbClient } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import { generateSessionToken, hashToken } from "./tokens";

export { SESSION_COOKIE } from "./cookie";

/** Refresh the sliding expiry at most this often to avoid a database write on every request. */
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

export function sessionTtlMs(): number {
  const hours = Number(process.env.SESSION_TTL_HOURS ?? 12);
  return (Number.isFinite(hours) && hours > 0 ? hours : 12) * 60 * 60 * 1000;
}

export interface SessionUser {
  id: string;
  fullName: string;
  username: string;
  role: Role;
  mustChangePassword: boolean;
}

export interface ValidatedSession {
  sessionId: string;
  expiresAt: Date;
  user: SessionUser;
}

export async function createSession(
  db: DbClient,
  userId: string,
  meta: { userAgent?: string | null; ipAddress?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + sessionTtlMs());
  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    expiresAt,
    userAgent: meta.userAgent?.slice(0, 255) ?? null,
    ipAddress: meta.ipAddress?.slice(0, 64) ?? null,
  });
  return { token, expiresAt };
}

export async function validateSessionToken(db: DbClient, token: string): Promise<ValidatedSession | null> {
  if (!token || token.length > 128) return null;
  const sessionId = hashToken(token);
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      fullName: users.fullName,
      username: users.username,
      role: users.role,
      isActive: users.isActive,
      mustChangePassword: users.mustChangePassword,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!row) return null;
  const now = Date.now();
  if (row.expiresAt.getTime() <= now || !row.isActive) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  let expiresAt = row.expiresAt;
  if (now - row.lastSeenAt.getTime() > REFRESH_INTERVAL_MS) {
    expiresAt = new Date(now + sessionTtlMs());
    await db.update(sessions).set({ lastSeenAt: new Date(now), expiresAt }).where(eq(sessions.id, sessionId));
  }

  return {
    sessionId,
    expiresAt,
    user: {
      id: row.userId,
      fullName: row.fullName,
      username: row.username,
      role: row.role,
      mustChangePassword: row.mustChangePassword,
    },
  };
}

export async function invalidateSessionToken(db: DbClient, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

/** Signs a user out everywhere, optionally keeping the current session. */
export async function invalidateUserSessions(db: DbClient, userId: string, exceptSessionId?: string): Promise<void> {
  await db
    .delete(sessions)
    .where(exceptSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)) : eq(sessions.userId, userId));
}

export async function deleteExpiredSessions(db: DbClient): Promise<number> {
  const deleted = await db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({ id: sessions.id });
  return deleted.length;
}
