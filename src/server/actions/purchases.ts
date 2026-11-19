"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/errors";
import { purchaseSchema, reverseSchema, supplierPaymentSchema, supplierSchema, updateSupplierSchema } from "@/lib/validation/purchases";
import { requiredText } from "@/lib/validation/common";
import { actorOf, requireActionPermission } from "@/server/auth/current-user";
import { CACHE_TAGS, FINANCIAL_TAGS, invalidate } from "@/server/cache";
import { getDb } from "@/server/db/client";
import {
  cancelPurchase,
  createPurchase,
  receivePurchase,
  recordSupplierPayment,
  reverseSupplierPayment,
  updateDraftPurchase,
} from "@/server/services/purchases";
import { createSupplier, updateSupplier } from "@/server/services/suppliers";
import { parseInput, runAction } from "./run";

function refresh(purchaseId?: string) {
  revalidatePath("/purchases");
  revalidatePath("/suppliers");
  if (purchaseId) revalidatePath(`/purchases/${purchaseId}`);
}

export async function createSupplierAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const session = await requireActionPermission("suppliers:manage");
    const data = parseInput(supplierSchema, input);
    const created = await getDb().transaction((tx) => createSupplier(tx, actorOf(session), data));
    invalidate(CACHE_TAGS.suppliers);
    refresh();
    return created;
  });
}

export async function updateSupplierAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("suppliers:manage");
    const { id, ...data } = parseInput(updateSupplierSchema, input);
    await getDb().transaction((tx) => updateSupplier(tx, actorOf(session), id, data));
    invalidate(CACHE_TAGS.suppliers);
    refresh();
    return undefined;
  });
}

export async function createPurchaseAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const session = await requireActionPermission("purchases:manage");
    const { receiveNow, ...data } = parseInput(purchaseSchema, input);
    const actor = actorOf(session);
    const created = await getDb().transaction(async (tx) => {
      const purchase = await createPurchase(tx, actor, data);
      if (receiveNow) await receivePurchase(tx, actor, purchase.id);
      return purchase;
    });
    if (receiveNow) invalidate(CACHE_TAGS.catalog, ...FINANCIAL_TAGS);
    refresh();
    return { id: created.id };
  });
}

export async function updatePurchaseAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("purchases:manage");
    const { id, receiveNow: _ignored, ...data } = parseInput(purchaseSchema.extend({ id: z.uuid() }), input);
    await getDb().transaction((tx) => updateDraftPurchase(tx, actorOf(session), id, data));
    refresh(id);
    return undefined;
  });
}

export async function receivePurchaseAction(id: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("purchases:manage");
    const purchaseId = parseInput(z.uuid(), id);
    await getDb().transaction((tx) => receivePurchase(tx, actorOf(session), purchaseId));
    invalidate(CACHE_TAGS.catalog, ...FINANCIAL_TAGS);
    refresh(purchaseId);
    revalidatePath("/inventory");
    return undefined;
  });
}

export async function cancelPurchaseAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("purchases:manage");
    const data = parseInput(z.object({ id: z.uuid(), reason: requiredText(300, "Reason") }), input);
    await getDb().transaction((tx) => cancelPurchase(tx, actorOf(session), data.id, data.reason));
    refresh(data.id);
    return undefined;
  });
}

export async function recordSupplierPaymentAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("purchases:pay");
    const data = parseInput(supplierPaymentSchema, input);
    await getDb().transaction((tx) => recordSupplierPayment(tx, actorOf(session), data));
    invalidate(...FINANCIAL_TAGS);
    refresh(data.purchaseId);
    revalidatePath("/cash");
    return undefined;
  });
}

export async function reverseSupplierPaymentAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("purchases:pay");
    const data = parseInput(reverseSchema, input);
    await getDb().transaction((tx) => reverseSupplierPayment(tx, actorOf(session), data));
    invalidate(...FINANCIAL_TAGS);
    refresh();
    revalidatePath("/purchases", "layout");
    return undefined;
  });
}
