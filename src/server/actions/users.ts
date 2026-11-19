"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/errors";
import { createUserSchema, resetPasswordSchema, updateUserSchema } from "@/lib/validation/users";
import { actorOf, requireActionPermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { createUser, resetUserPassword, unlockUser, updateUser } from "@/server/services/users";
import { parseInput, runAction } from "./run";

export async function createUserAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const session = await requireActionPermission("staff:manage");
    const data = parseInput(createUserSchema, input);
    const user = await getDb().transaction((tx) => createUser(tx, actorOf(session), data));
    revalidatePath("/staff");
    return { id: user.id };
  });
}

export async function updateUserAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const session = await requireActionPermission("staff:manage");
    const data = parseInput(updateUserSchema, input);
    const user = await getDb().transaction((tx) => updateUser(tx, actorOf(session), data));
    revalidatePath("/staff");
    return { id: user.id };
  });
}

export async function resetUserPasswordAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("staff:manage");
    const data = parseInput(resetPasswordSchema, input);
    await getDb().transaction((tx) => resetUserPassword(tx, actorOf(session), data));
    revalidatePath("/staff");
    return undefined;
  });
}

export async function unlockUserAction(id: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("staff:manage");
    const userId = parseInput(z.uuid(), id);
    await getDb().transaction((tx) => unlockUser(tx, actorOf(session), userId));
    revalidatePath("/staff");
    return undefined;
  });
}
