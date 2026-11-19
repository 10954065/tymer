"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/errors";
import { cancelOrderSchema, orderPaymentSchema, orderSchema, orderStatusSchema } from "@/lib/validation/orders";
import { actorOf, requireActionPermission } from "@/server/auth/current-user";
import { CACHE_TAGS, FINANCIAL_TAGS, invalidate } from "@/server/cache";
import { getDb } from "@/server/db/client";
import { cancelOrder, completeOrder, createOrder, recordOrderPayment, setOrderStatus, updateOrder } from "@/server/services/orders";
import { parseInput, runAction } from "./run";

function refresh(orderId?: string) {
  revalidatePath("/orders");
  if (orderId) revalidatePath(`/orders/${orderId}`);
}

export async function createOrderAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const session = await requireActionPermission("orders:manage");
    const data = parseInput(orderSchema, input);
    const order = await getDb().transaction((tx) => createOrder(tx, actorOf(session), data));
    refresh();
    return { id: order.id };
  });
}

export async function updateOrderAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const session = await requireActionPermission("orders:manage");
    const { id, ...data } = parseInput(orderSchema.extend({ id: z.uuid() }), input);
    await getDb().transaction((tx) => updateOrder(tx, actorOf(session), id, data));
    refresh(id);
    return { id };
  });
}

export async function setOrderStatusAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("orders:manage");
    const data = parseInput(orderStatusSchema, input);
    await getDb().transaction((tx) => setOrderStatus(tx, actorOf(session), data.orderId, data.status));
    refresh(data.orderId);
    return undefined;
  });
}

export async function recordOrderPaymentAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("payments:record");
    const data = parseInput(orderPaymentSchema, input);
    await getDb().transaction((tx) => recordOrderPayment(tx, actorOf(session), data));
    invalidate(...FINANCIAL_TAGS);
    refresh(data.orderId);
    return undefined;
  });
}

export async function completeOrderAction(id: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("orders:manage");
    const orderId = parseInput(z.uuid(), id);
    await getDb().transaction((tx) => completeOrder(tx, actorOf(session), orderId));
    invalidate(CACHE_TAGS.catalog, ...FINANCIAL_TAGS);
    refresh(orderId);
    return undefined;
  });
}

export async function cancelOrderAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("orders:manage");
    const data = parseInput(cancelOrderSchema, input);
    await getDb().transaction((tx) => cancelOrder(tx, actorOf(session), data));
    invalidate(...FINANCIAL_TAGS);
    refresh(data.orderId);
    return undefined;
  });
}
