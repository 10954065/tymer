"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/errors";
import { closeCashSchema, correctExpenseSchema, expenseSchema, openCashSchema } from "@/lib/validation/expenses";
import { actorOf, requireActionPermission } from "@/server/auth/current-user";
import { FINANCIAL_TAGS, invalidate } from "@/server/cache";
import { getDb } from "@/server/db/client";
import { closeCashSession, openCashSession } from "@/server/services/cash";
import { correctExpense, createExpense } from "@/server/services/expenses";
import { parseInput, runAction } from "./run";

function refresh() {
  invalidate(...FINANCIAL_TAGS);
  revalidatePath("/expenses");
  revalidatePath("/cash");
  revalidatePath("/orders", "layout");
}

export async function createExpenseAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const session = await requireActionPermission("expenses:manage");
    const data = parseInput(expenseSchema, input);
    const row = await getDb().transaction((tx) => createExpense(tx, actorOf(session), data));
    refresh();
    return { id: row.id };
  });
}

export async function correctExpenseAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("expenses:manage");
    const data = parseInput(correctExpenseSchema, input);
    await getDb().transaction((tx) => correctExpense(tx, actorOf(session), data));
    refresh();
    return undefined;
  });
}

export async function openCashAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("cash:manage");
    const data = parseInput(openCashSchema, input);
    await getDb().transaction((tx) => openCashSession(tx, actorOf(session), data));
    revalidatePath("/cash");
    return undefined;
  });
}

export async function closeCashAction(input: unknown): Promise<ActionResult<{ expected: number; difference: number }>> {
  return runAction(async () => {
    const session = await requireActionPermission("cash:manage");
    const data = parseInput(closeCashSchema, input);
    const result = await getDb().transaction((tx) => closeCashSession(tx, actorOf(session), data));
    revalidatePath("/cash");
    return result;
  });
}
