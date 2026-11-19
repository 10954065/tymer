import { and, asc, eq, ne, sql } from "drizzle-orm";
import { AppError, notFound } from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import type { DbClient } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { assertPasswordPolicy, hashPassword } from "@/server/auth/password";
import { invalidateUserSessions } from "@/server/auth/sessions";
import { diffFields, recordAudit } from "./audit";

export interface Actor {
  id: string;
  role: Role;
}

const publicColumns = {
  id: users.id,
  fullName: users.fullName,
  username: users.username,
  email: users.email,
  phone: users.phone,
  role: users.role,
  isActive: users.isActive,
  mustChangePassword: users.mustChangePassword,
  lockedUntil: users.lockedUntil,
  isLocked: sql<boolean>`coalesce(${users.lockedUntil} > now(), false)`,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
};

export type StaffMember = {
  id: string;
  fullName: string;
  username: string;
  email: string | null;
  phone: string | null;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lockedUntil: Date | null;
  isLocked: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export async function listUsers(db: DbClient): Promise<StaffMember[]> {
  return db.select(publicColumns).from(users).orderBy(asc(users.fullName));
}

async function countActiveOwners(db: DbClient, excludingId?: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(eq(users.role, "OWNER"), eq(users.isActive, true), excludingId ? ne(users.id, excludingId) : undefined),
    );
  return row?.n ?? 0;
}

export async function createUser(
  db: DbClient,
  actor: Actor,
  input: { fullName: string; username: string; email: string | null; phone: string | null; role: Role; password: string },
): Promise<StaffMember> {
  assertPasswordPolicy(input.password);
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.username})`, input.username.toLowerCase()))
    .limit(1);
  if (existing) {
    throw new AppError("CONFLICT", "That username is already taken", { fieldErrors: { username: "Already taken" } });
  }
  const [created] = await db
    .insert(users)
    .values({
      fullName: input.fullName,
      username: input.username.toLowerCase(),
      email: input.email,
      phone: input.phone,
      role: input.role,
      passwordHash: await hashPassword(input.password),
      mustChangePassword: true,
    })
    .returning(publicColumns);
  await recordAudit(db, {
    userId: actor.id,
    action: "user.created",
    entityType: "user",
    entityId: created.id,
    after: { fullName: created.fullName, username: created.username, role: created.role },
  });
  return created;
}

export async function updateUser(
  db: DbClient,
  actor: Actor,
  input: { id: string; fullName: string; email: string | null; phone: string | null; role: Role; isActive: boolean },
): Promise<StaffMember> {
  const [current] = await db.select(publicColumns).from(users).where(eq(users.id, input.id)).limit(1);
  if (!current) throw notFound("Staff member");

  if (input.id === actor.id && !input.isActive) {
    throw new AppError("VALIDATION", "You cannot deactivate your own account");
  }
  const losesOwner = current.role === "OWNER" && current.isActive && (input.role !== "OWNER" || !input.isActive);
  if (losesOwner && (await countActiveOwners(db, input.id)) === 0) {
    throw new AppError("VALIDATION", "At least one active owner account is required");
  }

  const changes = diffFields(current, {
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    role: input.role,
    isActive: input.isActive,
  });
  if (!changes) return current;

  const [updated] = await db
    .update(users)
    .set({ fullName: input.fullName, email: input.email, phone: input.phone, role: input.role, isActive: input.isActive })
    .where(eq(users.id, input.id))
    .returning(publicColumns);

  if (current.role !== updated.role || (current.isActive && !updated.isActive)) {
    await invalidateUserSessions(db, updated.id);
  }
  await recordAudit(db, { userId: actor.id, action: "user.updated", entityType: "user", entityId: updated.id, ...changes });
  return updated;
}

export async function resetUserPassword(db: DbClient, actor: Actor, input: { id: string; password: string }): Promise<void> {
  assertPasswordPolicy(input.password);
  const result = await db
    .update(users)
    .set({
      passwordHash: await hashPassword(input.password),
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    })
    .where(eq(users.id, input.id))
    .returning({ id: users.id });
  if (!result.length) throw notFound("Staff member");
  await invalidateUserSessions(db, input.id);
  await recordAudit(db, { userId: actor.id, action: "user.password_reset", entityType: "user", entityId: input.id });
}

export async function unlockUser(db: DbClient, actor: Actor, id: string): Promise<void> {
  const result = await db
    .update(users)
    .set({ failedLoginAttempts: 0, lockedUntil: null })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!result.length) throw notFound("Staff member");
  await recordAudit(db, { userId: actor.id, action: "user.unlocked", entityType: "user", entityId: id });
}

/** Creates the first owner account when the database has no users yet. */
export async function bootstrapOwner(
  db: DbClient,
  input: { fullName: string; username: string; password: string },
): Promise<{ created: boolean }> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  if ((row?.n ?? 0) > 0) return { created: false };
  assertPasswordPolicy(input.password);
  const [owner] = await db
    .insert(users)
    .values({
      fullName: input.fullName,
      username: input.username.toLowerCase(),
      role: "OWNER",
      passwordHash: await hashPassword(input.password),
      mustChangePassword: true,
    })
    .returning({ id: users.id });
  await recordAudit(db, { userId: owner.id, action: "user.bootstrap_owner", entityType: "user", entityId: owner.id });
  return { created: true };
}
