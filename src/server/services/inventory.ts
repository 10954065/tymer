import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { AppError, notFound } from "@/lib/errors";
import { mulDivRound } from "@/lib/money";
import type { DbClient, Tx } from "@/server/db/client";
import { businessSettings, inventoryMovements, productPriceChanges, products, users } from "@/server/db/schema";
import { recordAudit } from "./audit";
import type { Actor } from "./users";

export type MovementType = (typeof inventoryMovements.$inferSelect)["type"];
export type ProductStatus = (typeof products.$inferSelect)["status"];

export interface StockChange {
  productId: string;
  type: MovementType;
  /** Signed quantity: positive adds stock, negative removes stock. */
  quantityChange: number;
  unitCost?: number | null;
  referenceType?: string | null;
  referenceId?: string | null;
  reason?: string | null;
  userId: string | null;
  /** Override the shop-wide negative stock setting (owner-approved offline sync only). */
  allowNegative?: boolean;
  /** Restock-and-reactivate: also bring ARCHIVED / DISCONTINUED products back into the catalogue. */
  reactivate?: boolean;
}

export interface StockChangeResult {
  productId: string;
  name: string;
  sku: string;
  costPrice: number;
  sellingPrice: number;
  previousQuantity: number;
  newQuantity: number;
  status: ProductStatus;
  becameOutOfStock: boolean;
  reactivated: boolean;
}

export async function isNegativeStockAllowed(db: DbClient): Promise<boolean> {
  const [row] = await db
    .select({ allow: businessSettings.allowNegativeStock })
    .from(businessSettings)
    .where(eq(businessSettings.id, 1))
    .limit(1);
  return row?.allow ?? false;
}

/** Decides the automatic catalogue status after a stock change. Manual archives are never overridden. */
export function nextStockStatus(
  current: ProductStatus,
  newQuantity: number,
  reactivate = false,
): { status: ProductStatus; becameOutOfStock: boolean; reactivated: boolean } {
  if (newQuantity <= 0) {
    if (current === "ACTIVE") return { status: "OUT_OF_STOCK", becameOutOfStock: true, reactivated: false };
    return { status: current, becameOutOfStock: false, reactivated: false };
  }
  if (current === "OUT_OF_STOCK" || (reactivate && (current === "ARCHIVED" || current === "DISCONTINUED"))) {
    return { status: "ACTIVE", becameOutOfStock: false, reactivated: true };
  }
  return { status: current, becameOutOfStock: false, reactivated: false };
}

/**
 * The only way stock quantities change. Locks the product row, validates, updates quantity and status,
 * and appends exactly one inventory movement. Must run inside a transaction.
 */
export async function applyStockChange(tx: Tx, change: StockChange, allowNegativeSetting?: boolean): Promise<StockChangeResult> {
  if (!Number.isInteger(change.quantityChange) || change.quantityChange === 0) {
    throw new AppError("VALIDATION", "Quantity change must be a non-zero whole number");
  }
  const [product] = await tx
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      quantity: products.quantity,
      status: products.status,
      costPrice: products.costPrice,
      sellingPrice: products.sellingPrice,
    })
    .from(products)
    .where(eq(products.id, change.productId))
    .for("update");
  if (!product) throw notFound("Product");

  const newQuantity = product.quantity + change.quantityChange;
  if (newQuantity < 0 && change.quantityChange < 0) {
    const allowNegative = change.allowNegative ?? allowNegativeSetting ?? (await isNegativeStockAllowed(tx));
    if (!allowNegative) {
      throw new AppError("INSUFFICIENT_STOCK", `Only ${Math.max(product.quantity, 0)} × ${product.name} in stock`, {
        details: { productId: product.id, available: product.quantity, requested: -change.quantityChange },
      });
    }
  }

  const next = nextStockStatus(product.status, newQuantity, change.reactivate);
  const now = new Date();
  await tx
    .update(products)
    .set({
      quantity: newQuantity,
      status: next.status,
      ...(next.becameOutOfStock ? { outOfStockAt: now } : {}),
      ...(next.reactivated ? { outOfStockAt: null, archivedAt: null, archiveReason: null } : {}),
    })
    .where(eq(products.id, product.id));

  await tx.insert(inventoryMovements).values({
    productId: product.id,
    type: change.type,
    quantityChange: change.quantityChange,
    previousQuantity: product.quantity,
    newQuantity,
    unitCost: change.unitCost ?? null,
    referenceType: change.referenceType ?? null,
    referenceId: change.referenceId ?? null,
    reason: change.reason ?? null,
    userId: change.userId,
  });

  if (next.becameOutOfStock || next.reactivated) {
    await recordAudit(tx, {
      userId: change.userId,
      action: next.becameOutOfStock ? "product.out_of_stock" : "product.reactivated",
      entityType: "product",
      entityId: product.id,
      before: { status: product.status, quantity: product.quantity },
      after: { status: next.status, quantity: newQuantity },
      reference: change.referenceType && change.referenceId ? `${change.referenceType}:${change.referenceId}` : null,
    });
  }

  return {
    productId: product.id,
    name: product.name,
    sku: product.sku,
    costPrice: product.costPrice,
    sellingPrice: product.sellingPrice,
    previousQuantity: product.quantity,
    newQuantity,
    status: next.status,
    becameOutOfStock: next.becameOutOfStock,
    reactivated: next.reactivated,
  };
}

/** Locks several products in a stable order to avoid deadlocks between concurrent checkouts. */
export async function lockProducts(tx: Tx, productIds: string[]): Promise<void> {
  const ids = [...new Set(productIds)].sort();
  if (ids.length === 0) return;
  await tx.select({ id: products.id }).from(products).where(inArray(products.id, ids)).orderBy(products.id).for("update");
}

/** Weighted-average cost after receiving `quantity` units at `unitCost`. */
export function weightedAverageCost(currentQty: number, currentCost: number, quantity: number, unitCost: number): number {
  const existing = Math.max(currentQty, 0);
  if (existing + quantity <= 0) return unitCost;
  return mulDivRound(existing * currentCost + quantity * unitCost, 1, existing + quantity);
}

/**
 * Receives stock at a unit cost: updates weighted-average cost (with price history) and adds a PURCHASE movement.
 * Reactivates out-of-stock products automatically and archived/discontinued ones when `reactivate` is set.
 */
export async function receiveStock(
  tx: Tx,
  input: {
    productId: string;
    quantity: number;
    unitCost: number;
    userId: string;
    referenceType?: string;
    referenceId?: string;
    reason?: string | null;
    reactivate?: boolean;
    type?: MovementType;
  },
): Promise<StockChangeResult> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new AppError("VALIDATION", "Quantity received must be a positive whole number");
  }
  if (!Number.isInteger(input.unitCost) || input.unitCost < 0) {
    throw new AppError("VALIDATION", "Unit cost must be zero or more");
  }
  const [current] = await tx
    .select({ quantity: products.quantity, costPrice: products.costPrice, sellingPrice: products.sellingPrice })
    .from(products)
    .where(eq(products.id, input.productId))
    .for("update");
  if (!current) throw notFound("Product");

  const newCost = weightedAverageCost(current.quantity, current.costPrice, input.quantity, input.unitCost);
  if (newCost !== current.costPrice) {
    await tx.update(products).set({ costPrice: newCost }).where(eq(products.id, input.productId));
    await tx.insert(productPriceChanges).values({
      productId: input.productId,
      oldCostPrice: current.costPrice,
      newCostPrice: newCost,
      oldSellingPrice: current.sellingPrice,
      newSellingPrice: current.sellingPrice,
      reason: "Weighted-average cost after stock received",
      userId: input.userId,
    });
  }
  return applyStockChange(tx, {
    productId: input.productId,
    type: input.type ?? "PURCHASE",
    quantityChange: input.quantity,
    unitCost: input.unitCost,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    reason: input.reason ?? null,
    userId: input.userId,
    reactivate: input.reactivate,
  });
}

export type AdjustmentKind = "DAMAGE" | "LOSS" | "MANUAL_ADJUSTMENT";

/** Manual stock adjustments by staff. Damage and loss always remove stock; a reason is mandatory. */
export async function adjustStock(
  tx: Tx,
  actor: Actor,
  input: { productId: string; kind: AdjustmentKind; quantity: number; direction: "increase" | "decrease"; reason: string },
): Promise<StockChangeResult> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new AppError("VALIDATION", "Give a reason for the adjustment", { fieldErrors: { reason: "Required" } });
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new AppError("VALIDATION", "Quantity must be a positive whole number", { fieldErrors: { quantity: "Invalid" } });
  }
  const decrease = input.kind !== "MANUAL_ADJUSTMENT" || input.direction === "decrease";
  const [product] = await tx.select({ costPrice: products.costPrice }).from(products).where(eq(products.id, input.productId));
  if (!product) throw notFound("Product");

  const result = await applyStockChange(tx, {
    productId: input.productId,
    type: input.kind,
    quantityChange: decrease ? -input.quantity : input.quantity,
    unitCost: product.costPrice,
    referenceType: "adjustment",
    reason,
    userId: actor.id,
  });
  await recordAudit(tx, {
    userId: actor.id,
    action: `inventory.${input.kind.toLowerCase()}`,
    entityType: "product",
    entityId: input.productId,
    before: { quantity: result.previousQuantity },
    after: { quantity: result.newQuantity },
    reason,
  });
  return result;
}

export interface MovementRow {
  id: number;
  productId: string;
  productName: string;
  sku: string;
  type: MovementType;
  quantityChange: number;
  previousQuantity: number;
  newQuantity: number;
  unitCost: number | null;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  userName: string | null;
  createdAt: Date;
}

/** Keyset-paginated movement ledger (newest first). Pass the last seen id as `beforeId` for the next page. */
export async function listMovements(
  db: DbClient,
  options: { productId?: string; type?: MovementType; beforeId?: number; limit?: number } = {},
): Promise<{ rows: MovementRow[]; nextBeforeId: number | null }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const rows = await db
    .select({
      id: inventoryMovements.id,
      productId: inventoryMovements.productId,
      productName: products.name,
      sku: products.sku,
      type: inventoryMovements.type,
      quantityChange: inventoryMovements.quantityChange,
      previousQuantity: inventoryMovements.previousQuantity,
      newQuantity: inventoryMovements.newQuantity,
      unitCost: inventoryMovements.unitCost,
      referenceType: inventoryMovements.referenceType,
      referenceId: inventoryMovements.referenceId,
      reason: inventoryMovements.reason,
      userName: users.fullName,
      createdAt: inventoryMovements.createdAt,
    })
    .from(inventoryMovements)
    .innerJoin(products, eq(products.id, inventoryMovements.productId))
    .leftJoin(users, eq(users.id, inventoryMovements.userId))
    .where(
      and(
        options.productId ? eq(inventoryMovements.productId, options.productId) : undefined,
        options.type ? eq(inventoryMovements.type, options.type) : undefined,
        options.beforeId ? lt(inventoryMovements.id, options.beforeId) : undefined,
      ),
    )
    .orderBy(desc(inventoryMovements.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { rows: page, nextBeforeId: hasMore ? page[page.length - 1].id : null };
}

/** Sum of movements must always equal the stored quantity; used by tests and the health page. */
export async function findLedgerMismatches(db: DbClient): Promise<{ productId: string; quantity: number; ledger: number }[]> {
  const result = await db.execute<{ product_id: string; quantity: number; ledger: number }>(sql`
    SELECT p.id AS product_id, p.quantity, coalesce(sum(m.quantity_change), 0)::int AS ledger
    FROM products p LEFT JOIN inventory_movements m ON m.product_id = p.id
    GROUP BY p.id HAVING p.quantity <> coalesce(sum(m.quantity_change), 0)`);
  return result.rows.map((r) => ({ productId: r.product_id, quantity: r.quantity, ledger: r.ledger }));
}
