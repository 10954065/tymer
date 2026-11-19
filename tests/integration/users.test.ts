import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { auditLogs, sessions, users } from "@/server/db/schema";
import { login } from "@/server/services/auth";
import { bootstrapOwner, createUser, resetUserPassword, updateUser } from "@/server/services/users";
import { actor, createTestUser, TEST_PASSWORD } from "../support/factories";
import { resetDatabase } from "../support/db";

const db = () => getDb();

describe("staff management", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("creates staff with a forced password change and an audit record", async () => {
    const owner = await createTestUser("OWNER");
    const created = await createUser(db(), actor(owner), {
      fullName: "Ama Mensah",
      username: "Ama",
      email: null,
      phone: null,
      role: "CASHIER",
      password: "Cashier123",
    });
    expect(created).toMatchObject({ username: "ama", role: "CASHIER", mustChangePassword: true });
    const audit = await db().select().from(auditLogs).where(eq(auditLogs.entityId, created.id));
    expect(audit[0].action).toBe("user.created");
    expect(JSON.stringify(audit[0].after)).not.toContain("Cashier123");
  });

  it("rejects duplicate usernames", async () => {
    const owner = await createTestUser("OWNER");
    const input = { fullName: "A", username: "dup", email: null, phone: null, role: "CASHIER" as const, password: "Cashier123" };
    await createUser(db(), actor(owner), input);
    await expect(createUser(db(), actor(owner), { ...input, username: "DUP" })).rejects.toThrow(/already taken/);
  });

  it("keeps at least one active owner", async () => {
    const owner = await createTestUser("OWNER");
    const base = { id: owner.id, fullName: owner.fullName, email: null, phone: null };
    await expect(updateUser(db(), actor(owner), { ...base, role: "MANAGER", isActive: true })).rejects.toThrow(/active owner/);
  });

  it("prevents self-deactivation", async () => {
    const owner = await createTestUser("OWNER");
    await createTestUser("OWNER");
    await expect(
      updateUser(db(), actor(owner), { id: owner.id, fullName: owner.fullName, email: null, phone: null, role: "OWNER", isActive: false }),
    ).rejects.toThrow(/your own account/);
  });

  it("signs a user out when their role changes and records only changed fields", async () => {
    const owner = await createTestUser("OWNER");
    const cashier = await createTestUser("CASHIER");
    await login(db(), { username: cashier.username, password: TEST_PASSWORD });

    await updateUser(db(), actor(owner), {
      id: cashier.id,
      fullName: cashier.fullName,
      email: null,
      phone: null,
      role: "MANAGER",
      isActive: true,
    });

    expect(await db().select().from(sessions).where(eq(sessions.userId, cashier.id))).toHaveLength(0);
    const [audit] = await db().select().from(auditLogs).where(eq(auditLogs.action, "user.updated"));
    expect(audit.before).toEqual({ role: "CASHIER" });
    expect(audit.after).toEqual({ role: "MANAGER" });
  });

  it("resets a password, unlocks the account and forces a change", async () => {
    const owner = await createTestUser("OWNER");
    const staff = await createTestUser("INVENTORY_STAFF", { lockedUntil: new Date(Date.now() + 60_000), failedLoginAttempts: 3 });
    await resetUserPassword(db(), actor(owner), { id: staff.id, password: "Fresh1234" });
    const [updated] = await db().select().from(users).where(eq(users.id, staff.id));
    expect(updated).toMatchObject({ mustChangePassword: true, lockedUntil: null, failedLoginAttempts: 0 });
    await expect(login(db(), { username: staff.username, password: "Fresh1234" })).resolves.toBeTruthy();
  });

  it("bootstraps the first owner only once", async () => {
    expect(await bootstrapOwner(db(), { fullName: "Boss", username: "boss", password: "Owner1234" })).toEqual({ created: true });
    expect(await bootstrapOwner(db(), { fullName: "Boss", username: "boss2", password: "Owner1234" })).toEqual({ created: false });
  });
});
