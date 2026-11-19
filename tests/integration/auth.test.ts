import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { auditLogs, sessions, users } from "@/server/db/schema";
import { deleteExpiredSessions, validateSessionToken } from "@/server/auth/sessions";
import { hashToken } from "@/server/auth/tokens";
import { changeOwnPassword, login, MAX_FAILED_ATTEMPTS } from "@/server/services/auth";
import { createTestUser, TEST_PASSWORD } from "../support/factories";
import { resetDatabase } from "../support/db";

const db = () => getDb();

describe("authentication", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("signs in with correct credentials (case-insensitive username) and creates a hashed session", async () => {
    const user = await createTestUser("CASHIER");
    const result = await login(db(), { username: user.username.toUpperCase(), password: TEST_PASSWORD });

    expect(result.user).toMatchObject({ id: user.id, role: "CASHIER" });
    const [stored] = await db().select().from(sessions).where(eq(sessions.userId, user.id));
    expect(stored.id).toBe(hashToken(result.token));
    expect(stored.id).not.toBe(result.token);
  });

  it("rejects wrong passwords and unknown users with the same generic message", async () => {
    const user = await createTestUser();
    await expect(login(db(), { username: user.username, password: "wrong-pass1" })).rejects.toThrow(
      "Incorrect username or password",
    );
    await expect(login(db(), { username: "nobody", password: TEST_PASSWORD })).rejects.toThrow(
      "Incorrect username or password",
    );
  });

  it("rejects deactivated accounts", async () => {
    const user = await createTestUser("MANAGER", { isActive: false });
    await expect(login(db(), { username: user.username, password: TEST_PASSWORD })).rejects.toThrow();
  });

  it(`locks the account after ${MAX_FAILED_ATTEMPTS} failed attempts`, async () => {
    const user = await createTestUser();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
      await expect(login(db(), { username: user.username, password: "bad-pass1" })).rejects.toThrow();
    }
    await expect(login(db(), { username: user.username, password: TEST_PASSWORD })).rejects.toThrow(/locked/);
    const audit = await db().select().from(auditLogs).where(eq(auditLogs.action, "auth.locked"));
    expect(audit).toHaveLength(1);
  });

  it("validates live sessions and rejects expired ones", async () => {
    const user = await createTestUser();
    const { token } = await login(db(), { username: user.username, password: TEST_PASSWORD });
    const valid = await validateSessionToken(db(), token);
    expect(valid?.user.id).toBe(user.id);

    await db().update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await validateSessionToken(db(), token)).toBeNull();
    expect(await validateSessionToken(db(), "not-a-real-token")).toBeNull();
  });

  it("invalidates sessions when the user is deactivated", async () => {
    const user = await createTestUser();
    const { token } = await login(db(), { username: user.username, password: TEST_PASSWORD });
    await db().update(users).set({ isActive: false }).where(eq(users.id, user.id));
    expect(await validateSessionToken(db(), token)).toBeNull();
  });

  it("cleans up expired sessions", async () => {
    const user = await createTestUser();
    await login(db(), { username: user.username, password: TEST_PASSWORD });
    await db().update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await deleteExpiredSessions(db())).toBe(1);
  });

  it("changes password, clears the forced-change flag and signs out other sessions", async () => {
    const user = await createTestUser("OWNER", { mustChangePassword: true });
    const first = await login(db(), { username: user.username, password: TEST_PASSWORD });
    const second = await login(db(), { username: user.username, password: TEST_PASSWORD });
    const current = await validateSessionToken(db(), second.token);

    await changeOwnPassword(db(), user.id, current!.sessionId, { currentPassword: TEST_PASSWORD, newPassword: "NewPass456" });

    expect(await validateSessionToken(db(), first.token)).toBeNull();
    expect(await validateSessionToken(db(), second.token)).not.toBeNull();
    const [updated] = await db().select().from(users).where(eq(users.id, user.id));
    expect(updated.mustChangePassword).toBe(false);
    await expect(login(db(), { username: user.username, password: "NewPass456" })).resolves.toBeTruthy();
  });

  it("enforces the password policy on change", async () => {
    const user = await createTestUser();
    await expect(
      changeOwnPassword(db(), user.id, "x", { currentPassword: TEST_PASSWORD, newPassword: "short" }),
    ).rejects.toThrow(/at least 8/);
    await expect(
      changeOwnPassword(db(), user.id, "x", { currentPassword: "wrong", newPassword: "Valid1234" }),
    ).rejects.toThrow(/incorrect/);
  });
});
