import type { Role } from "@/lib/permissions";
import { hashPassword } from "@/server/auth/password";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";

export const TEST_PASSWORD = "Password123";
let cachedHash: string | null = null;

async function passwordHash(): Promise<string> {
  cachedHash ??= await hashPassword(TEST_PASSWORD);
  return cachedHash;
}

let counter = 0;

export async function createTestUser(role: Role = "OWNER", overrides: Partial<typeof users.$inferInsert> = {}) {
  counter += 1;
  const [user] = await getDb()
    .insert(users)
    .values({
      fullName: `${role} User ${counter}`,
      username: `${role.toLowerCase()}${counter}`,
      role,
      passwordHash: await passwordHash(),
      ...overrides,
    })
    .returning();
  return user;
}

export function actor(user: { id: string; role: Role }) {
  return { id: user.id, role: user.role };
}
