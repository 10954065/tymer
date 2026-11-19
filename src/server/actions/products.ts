"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/errors";
import { can } from "@/lib/permissions";
import {
  adjustStockSchema,
  archiveProductSchema,
  categorySchema,
  createProductSchema,
  restockSchema,
  updateCategorySchema,
  updateProductSchema,
} from "@/lib/validation/products";
import { actorOf, requireActionPermission } from "@/server/auth/current-user";
import { CACHE_TAGS, FINANCIAL_TAGS, invalidate } from "@/server/cache";
import { getDb } from "@/server/db/client";
import { createCategory, updateCategory } from "@/server/services/categories";
import { adjustStock, receiveStock } from "@/server/services/inventory";
import { archiveProduct, createProduct, getProduct, reactivateProduct, updateProduct } from "@/server/services/products";
import { parseInput, runAction } from "./run";

function invalidateStock(productId?: string) {
  invalidate(CACHE_TAGS.catalog, ...FINANCIAL_TAGS);
  revalidatePath("/products");
  revalidatePath("/inventory");
  if (productId) revalidatePath(`/products/${productId}`);
}

export async function createProductAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const session = await requireActionPermission("products:manage");
    const data = parseInput(createProductSchema, input);
    const created = await getDb().transaction((tx) => createProduct(tx, actorOf(session), data));
    invalidateStock(created.id);
    return { id: created.id };
  });
}

export async function updateProductAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const session = await requireActionPermission("products:manage");
    const data = parseInput(updateProductSchema, input);
    await getDb().transaction(async (tx) => {
      // Staff without cost visibility can never change the cost price, even with a crafted request.
      if (!can(session.user.role, "products:view_cost")) {
        const current = await getProduct(tx, data.id);
        data.costPrice = current.costPrice;
      }
      await updateProduct(tx, actorOf(session), data.id, data);
    });
    invalidateStock(data.id);
    return { id: data.id };
  });
}

export async function adjustStockAction(input: unknown): Promise<ActionResult<{ newQuantity: number }>> {
  return runAction(async () => {
    const session = await requireActionPermission("inventory:adjust");
    const data = parseInput(adjustStockSchema, input);
    const result = await getDb().transaction((tx) => adjustStock(tx, actorOf(session), data));
    invalidateStock(data.productId);
    return { newQuantity: result.newQuantity };
  });
}

/** "Restock and reactivate": receives stock into the existing product record and returns it to the catalogue. */
export async function restockProductAction(input: unknown): Promise<ActionResult<{ newQuantity: number }>> {
  return runAction(async () => {
    const session = await requireActionPermission("inventory:adjust");
    const data = parseInput(restockSchema, input);
    const result = await getDb().transaction((tx) =>
      receiveStock(tx, {
        productId: data.productId,
        quantity: data.quantity,
        unitCost: data.unitCost,
        userId: session.user.id,
        referenceType: "restock",
        reason: data.reason ?? "Restock",
        reactivate: true,
      }),
    );
    invalidateStock(data.productId);
    return { newQuantity: result.newQuantity };
  });
}

export async function archiveProductAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("products:manage");
    const data = parseInput(archiveProductSchema, input);
    await getDb().transaction((tx) => archiveProduct(tx, actorOf(session), data));
    invalidateStock(data.id);
    return undefined;
  });
}

export async function reactivateProductAction(id: unknown): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const session = await requireActionPermission("products:manage");
    const productId = parseInput(z.uuid(), id);
    const status = await getDb().transaction((tx) => reactivateProduct(tx, actorOf(session), productId));
    invalidateStock(productId);
    return { status };
  });
}

export async function createCategoryAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const session = await requireActionPermission("categories:manage");
    const data = parseInput(categorySchema, input);
    const created = await getDb().transaction((tx) => createCategory(tx, actorOf(session), data));
    invalidate(CACHE_TAGS.categories, CACHE_TAGS.catalog);
    revalidatePath("/categories");
    return created;
  });
}

export async function updateCategoryAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireActionPermission("categories:manage");
    const data = parseInput(updateCategorySchema, input);
    await getDb().transaction((tx) => updateCategory(tx, actorOf(session), data));
    invalidate(CACHE_TAGS.categories, CACHE_TAGS.catalog);
    revalidatePath("/categories");
    return undefined;
  });
}
