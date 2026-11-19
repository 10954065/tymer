"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/errors";
import { can } from "@/lib/permissions";
import {
  checkoutSchema,
  customerSchema,
  returnSchema,
  reversePaymentSchema,
  salePaymentSchema,
  updateCustomerSchema,
  voidSaleSchema,
} from "@/lib/validation/sales";
import { actorOf, requireActionPermission } from "@/server/auth/current-user";
import { CACHE_TAGS, FINANCIAL_TAGS, invalidate } from "@/server/cache";
import { getDb } from "@/server/db/client";
import { createCustomer, searchCustomers, updateCustomer } from "@/server/services/customers";
import { recordSalePayment, reversePayment } from "@/server/services/payments";
import { createReturn } from "@/server/services/returns";
import { checkout, voidSale, type CheckoutResult } from "@/server/services/sales";
import { parseInput, runAction } from "./run";

function afterMoneyChange(saleId?: string) {
  invalidate(CACHE_TAGS.catalog, ...FINANCIAL_TAGS);
  revalidatePath("/sales");
  revalidatePath("/payments");
  if (saleId) revalidatePath(`/sales/${saleId}`);
}

export async function checkoutAction(input: unknown): Promise<ActionResult<CheckoutResult>> {
  return runAction(async () => {
    const session = await requireActionPermission("pos:use");
    const data = parseInput(checkoutSchema, input);
    // Online sales always use current server prices; client-supplied prices are ignored here.
    const result = await checkout(
      getDb(),
      actorOf(session),
      { ...data, items: data.items.map(({ unitPrice: _ignored, ...item }) => item), source: "POS" },
      { canOverrideDiscount: can(session.user.role, "sales:discount_override") },
    );
    afterMoneyChange(result.saleId);
    return result;
  });
}

export async function voidSaleAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("sales:void");
    const data = parseInput(voidSaleSchema, input);
    await getDb().transaction((tx) => voidSale(tx, actorOf(session), data));
    afterMoneyChange(data.saleId);
    return undefined;
  });
}

export async function returnSaleAction(input: unknown): Promise<ActionResult<{ returnNumber: string; refunded: number }>> {
  return runAction(async () => {
    const session = await requireActionPermission("sales:return");
    const data = parseInput(returnSchema, input);
    const result = await getDb().transaction((tx) => createReturn(tx, actorOf(session), data));
    afterMoneyChange(data.saleId);
    return { returnNumber: result.returnNumber, refunded: result.refunded };
  });
}

export async function recordSalePaymentAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("payments:record");
    const data = parseInput(salePaymentSchema, input);
    await getDb().transaction((tx) => recordSalePayment(tx, actorOf(session), data));
    afterMoneyChange(data.saleId);
    return undefined;
  });
}

export async function reversePaymentAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("payments:reverse");
    const data = parseInput(reversePaymentSchema, input);
    await getDb().transaction((tx) => reversePayment(tx, actorOf(session), data));
    afterMoneyChange();
    revalidatePath("/orders", "layout");
    revalidatePath("/sales", "layout");
    return undefined;
  });
}

export async function searchCustomersAction(term: unknown): Promise<ActionResult<{ id: string; fullName: string; phone: string | null }[]>> {
  return runAction(async () => {
    await requireActionPermission("customers:view");
    const q = parseInput(z.string().max(100), term);
    return searchCustomers(getDb(), q);
  });
}

export async function createCustomerAction(input: unknown): Promise<ActionResult<{ id: string; fullName: string; phone: string | null }>> {
  return runAction(async () => {
    const session = await requireActionPermission("customers:create");
    const data = parseInput(customerSchema, input);
    const created = await getDb().transaction((tx) => createCustomer(tx, actorOf(session), data));
    revalidatePath("/customers");
    return created;
  });
}

export async function updateCustomerAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("customers:manage");
    const { id, ...data } = parseInput(updateCustomerSchema, input);
    await getDb().transaction((tx) => updateCustomer(tx, actorOf(session), id, data));
    revalidatePath("/customers", "layout");
    return undefined;
  });
}
