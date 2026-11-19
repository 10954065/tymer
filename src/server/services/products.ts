import { and, asc, desc, eq, ilike, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { AppError, notFound } from "@/lib/errors";
import type { DbClient, Tx } from "@/server/db/client";
import { categories, productPriceChanges, products, suppliers, users } from "@/server/db/schema";
import { diffFields, recordAudit } from "./audit";
import { applyStockChange, isNegativeStockAllowed, type ProductStatus } from "./inventory";
import type { Actor } from "./users";

export interface ProductFields {
  name: string;
  sku: string | null;
  barcode: string | null;
  categoryId: string | null;
  supplierId: string | null;
  description: string | null;
  costPrice: number;
  sellingPrice: number;
  reorderThreshold: number;
  imageKey: string | null;
}

export type ProductListFilter = "active" | "low" | "archived" | "all";

export interface ProductListItem {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryName: string | null;
  costPrice: number;
  sellingPrice: number;
  quantity: number;
  reorderThreshold: number;
  status: ProductStatus;
  imageKey: string | null;
  outOfStockAt: Date | null;
  archivedAt: Date | null;
}

function normaliseSku(sku: string): string {
  return sku.trim().toUpperCase();
}

async function generateSku(db: DbClient, name: string): Promise<string> {
  const prefix = (name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 3) || "SKU").toUpperCase().padEnd(3, "X");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `${prefix}-${randomInt(1000, 100000)}`;
    if (!(await skuExists(db, candidate))) return candidate;
  }
  throw new AppError("CONFLICT", "Could not generate a unique SKU; please enter one");
}

async function skuExists(db: DbClient, sku: string, exceptId?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(sql`upper(${products.sku})`, normaliseSku(sku)), exceptId ? ne(products.id, exceptId) : undefined))
    .limit(1);
  return Boolean(row);
}

async function barcodeExists(db: DbClient, barcode: string, exceptId?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.barcode, barcode), exceptId ? ne(products.id, exceptId) : undefined))
    .limit(1);
  return Boolean(row);
}

async function assertUniqueCodes(db: DbClient, fields: { sku: string; barcode: string | null }, exceptId?: string) {
  if (await skuExists(db, fields.sku, exceptId)) {
    throw new AppError("CONFLICT", `SKU ${fields.sku} is already used by another product`, { fieldErrors: { sku: "Already in use" } });
  }
  if (fields.barcode && (await barcodeExists(db, fields.barcode, exceptId))) {
    throw new AppError("CONFLICT", "That barcode is already used by another product", { fieldErrors: { barcode: "Already in use" } });
  }
}

export async function createProduct(
  tx: Tx,
  actor: Actor,
  input: ProductFields & { initialStock: number },
): Promise<{ id: string; sku: string }> {
  const sku = input.sku ? normaliseSku(input.sku) : await generateSku(tx, input.name);
  await assertUniqueCodes(tx, { sku, barcode: input.barcode });
  if (!Number.isInteger(input.initialStock) || input.initialStock < 0) {
    throw new AppError("VALIDATION", "Opening stock must be zero or more", { fieldErrors: { initialStock: "Invalid" } });
  }

  const [created] = await tx
    .insert(products)
    .values({
      name: input.name,
      sku,
      barcode: input.barcode,
      categoryId: input.categoryId,
      supplierId: input.supplierId,
      description: input.description,
      costPrice: input.costPrice,
      sellingPrice: input.sellingPrice,
      reorderThreshold: input.reorderThreshold,
      imageKey: input.imageKey,
      initialStock: input.initialStock,
      quantity: 0,
      status: input.initialStock > 0 ? "ACTIVE" : "OUT_OF_STOCK",
      outOfStockAt: input.initialStock > 0 ? null : new Date(),
      createdBy: actor.id,
    })
    .returning({ id: products.id, sku: products.sku });

  if (input.initialStock > 0) {
    await applyStockChange(tx, {
      productId: created.id,
      type: "INITIAL_STOCK",
      quantityChange: input.initialStock,
      unitCost: input.costPrice,
      referenceType: "product",
      referenceId: created.id,
      reason: "Opening stock",
      userId: actor.id,
    });
  }
  await recordAudit(tx, {
    userId: actor.id,
    action: "product.created",
    entityType: "product",
    entityId: created.id,
    after: { name: input.name, sku, costPrice: input.costPrice, sellingPrice: input.sellingPrice, initialStock: input.initialStock },
  });
  return created;
}

export async function updateProduct(
  tx: Tx,
  actor: Actor,
  id: string,
  input: ProductFields & { priceChangeReason?: string | null },
): Promise<void> {
  const [current] = await tx.select().from(products).where(eq(products.id, id)).for("update");
  if (!current) throw notFound("Product");
  const sku = input.sku ? normaliseSku(input.sku) : current.sku;
  await assertUniqueCodes(tx, { sku, barcode: input.barcode }, id);

  const next = {
    name: input.name,
    sku,
    barcode: input.barcode,
    categoryId: input.categoryId,
    supplierId: input.supplierId,
    description: input.description,
    costPrice: input.costPrice,
    sellingPrice: input.sellingPrice,
    reorderThreshold: input.reorderThreshold,
    imageKey: input.imageKey,
  };
  const changes = diffFields(current as unknown as Record<string, unknown>, next);
  if (!changes) return;

  await tx.update(products).set(next).where(eq(products.id, id));
  if (current.costPrice !== next.costPrice || current.sellingPrice !== next.sellingPrice) {
    await tx.insert(productPriceChanges).values({
      productId: id,
      oldCostPrice: current.costPrice,
      newCostPrice: next.costPrice,
      oldSellingPrice: current.sellingPrice,
      newSellingPrice: next.sellingPrice,
      reason: input.priceChangeReason ?? null,
      userId: actor.id,
    });
  }
  await recordAudit(tx, {
    userId: actor.id,
    action: "product.updated",
    entityType: "product",
    entityId: id,
    ...changes,
    reason: input.priceChangeReason ?? null,
  });
}

/** Manually removes a product from the catalogue. History is kept; the product can be reactivated later. */
export async function archiveProduct(
  tx: Tx,
  actor: Actor,
  input: { id: string; reason: string; discontinue: boolean },
): Promise<void> {
  const [current] = await tx.select({ status: products.status }).from(products).where(eq(products.id, input.id)).for("update");
  if (!current) throw notFound("Product");
  const status: ProductStatus = input.discontinue ? "DISCONTINUED" : "ARCHIVED";
  if (current.status === status) return;
  await tx
    .update(products)
    .set({ status, archivedAt: new Date(), archiveReason: input.reason })
    .where(eq(products.id, input.id));
  await recordAudit(tx, {
    userId: actor.id,
    action: input.discontinue ? "product.discontinued" : "product.archived",
    entityType: "product",
    entityId: input.id,
    before: { status: current.status },
    after: { status },
    reason: input.reason,
  });
}

/** Brings a manually archived product back. Without stock it returns as OUT_OF_STOCK until restocked. */
export async function reactivateProduct(tx: Tx, actor: Actor, id: string): Promise<ProductStatus> {
  const [current] = await tx
    .select({ status: products.status, quantity: products.quantity })
    .from(products)
    .where(eq(products.id, id))
    .for("update");
  if (!current) throw notFound("Product");
  const status: ProductStatus = current.quantity > 0 ? "ACTIVE" : "OUT_OF_STOCK";
  if (current.status === status) return status;
  await tx.update(products).set({ status, archivedAt: null, archiveReason: null }).where(eq(products.id, id));
  await recordAudit(tx, {
    userId: actor.id,
    action: "product.reactivated",
    entityType: "product",
    entityId: id,
    before: { status: current.status },
    after: { status },
  });
  return status;
}

function filterCondition(filter: ProductListFilter): SQL | undefined {
  switch (filter) {
    case "active":
      return eq(products.status, "ACTIVE");
    case "low":
      return and(eq(products.status, "ACTIVE"), lte(products.quantity, products.reorderThreshold));
    case "archived":
      return inArray(products.status, ["OUT_OF_STOCK", "ARCHIVED", "DISCONTINUED"]);
    default:
      return undefined;
  }
}

export async function listProducts(
  db: DbClient,
  options: { search?: string; categoryId?: string; filter?: ProductListFilter; page?: number; pageSize?: number },
): Promise<{ items: ProductListItem[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 25, 5), 100);
  const page = Math.max(options.page ?? 1, 1);
  const term = options.search?.trim();
  const where = and(
    filterCondition(options.filter ?? "all"),
    options.categoryId ? eq(products.categoryId, options.categoryId) : undefined,
    term
      ? or(ilike(products.name, `%${term}%`), ilike(products.sku, `%${term}%`), eq(products.barcode, term))
      : undefined,
  );
  const [items, [counted]] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        barcode: products.barcode,
        categoryName: categories.name,
        costPrice: products.costPrice,
        sellingPrice: products.sellingPrice,
        quantity: products.quantity,
        reorderThreshold: products.reorderThreshold,
        status: products.status,
        imageKey: products.imageKey,
        outOfStockAt: products.outOfStockAt,
        archivedAt: products.archivedAt,
      })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(where)
      .orderBy(options.filter === "archived" ? desc(sql`coalesce(${products.archivedAt}, ${products.outOfStockAt})`) : asc(products.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(products).where(where),
  ]);
  return { items, total: counted?.n ?? 0, page, pageSize };
}

export async function getProduct(db: DbClient, id: string) {
  const [row] = await db
    .select({
      product: products,
      categoryName: categories.name,
      supplierName: suppliers.name,
      createdByName: users.fullName,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
    .leftJoin(users, eq(users.id, products.createdBy))
    .where(eq(products.id, id))
    .limit(1);
  if (!row) throw notFound("Product");
  return { ...row.product, categoryName: row.categoryName, supplierName: row.supplierName, createdByName: row.createdByName };
}

export interface ProductStats {
  initialStock: number;
  purchased: number;
  sold: number;
  returned: number;
  writtenOff: number;
  adjusted: number;
  reversed: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  lastSoldAt: string | null;
}

/** Lifetime figures for one product, from the stock ledger and sale/order snapshots. */
export async function getProductStats(db: DbClient, id: string): Promise<ProductStats> {
  const result = await db.execute<{
    initial: number;
    purchased: number;
    sold: number;
    returned: number;
    written_off: number;
    adjusted: number;
    reversed: number;
    sales_value: number;
    sales_cost: number;
    returns_value: number;
    returns_cost: number;
    order_value: number;
    order_cost: number;
    last_sold_at: string | null;
  }>(sql`
    WITH m AS (
      SELECT
        coalesce(sum(quantity_change) FILTER (WHERE type = 'INITIAL_STOCK'), 0)::int AS initial,
        coalesce(sum(quantity_change) FILTER (WHERE type = 'PURCHASE'), 0)::int AS purchased,
        coalesce(-sum(quantity_change) FILTER (WHERE type = 'SALE'), 0)::int AS sold,
        coalesce(sum(quantity_change) FILTER (WHERE type = 'CUSTOMER_RETURN'), 0)::int AS returned,
        coalesce(-sum(quantity_change) FILTER (WHERE type IN ('DAMAGE', 'LOSS')), 0)::int AS written_off,
        coalesce(sum(quantity_change) FILTER (WHERE type = 'MANUAL_ADJUSTMENT'), 0)::int AS adjusted,
        coalesce(sum(quantity_change) FILTER (WHERE type = 'REVERSAL'), 0)::int AS reversed
      FROM inventory_movements WHERE product_id = ${id}
    ),
    si AS (
      SELECT si.id, si.quantity, si.unit_cost, si.line_total - si.tax AS value, s.created_at
      FROM sale_items si JOIN sales s ON s.id = si.sale_id AND s.status = 'COMPLETED'
      WHERE si.product_id = ${id}
    ),
    ri AS (
      SELECT sri.value, CASE WHEN sri.restocked THEN sri.quantity * sri.unit_cost ELSE 0 END AS cost
      FROM sale_return_items sri JOIN si ON si.id = sri.sale_item_id
    ),
    oi AS (
      SELECT oi.line_total, oi.quantity * coalesce(oi.unit_cost, 0) AS cost
      FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.status = 'COMPLETED'
      WHERE oi.product_id = ${id}
    )
    SELECT m.*,
      (SELECT coalesce(sum(value), 0)::bigint FROM si) AS sales_value,
      (SELECT coalesce(sum(quantity::bigint * unit_cost), 0)::bigint FROM si) AS sales_cost,
      (SELECT coalesce(sum(value), 0)::bigint FROM ri) AS returns_value,
      (SELECT coalesce(sum(cost), 0)::bigint FROM ri) AS returns_cost,
      (SELECT coalesce(sum(line_total), 0)::bigint FROM oi) AS order_value,
      (SELECT coalesce(sum(cost), 0)::bigint FROM oi) AS order_cost,
      (SELECT to_char(max(created_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM si) AS last_sold_at
    FROM m`);
  const r = result.rows[0];
  const revenue = r.sales_value - r.returns_value + r.order_value;
  const cogs = r.sales_cost - r.returns_cost + r.order_cost;
  return {
    initialStock: r.initial,
    purchased: r.purchased,
    sold: r.sold,
    returned: r.returned,
    writtenOff: r.written_off,
    adjusted: r.adjusted,
    reversed: r.reversed,
    revenue,
    cogs,
    grossProfit: revenue - cogs,
    lastSoldAt: r.last_sold_at,
  };
}

export async function getPriceHistory(db: DbClient, productId: string, limit = 20) {
  return db
    .select({
      id: productPriceChanges.id,
      oldCostPrice: productPriceChanges.oldCostPrice,
      newCostPrice: productPriceChanges.newCostPrice,
      oldSellingPrice: productPriceChanges.oldSellingPrice,
      newSellingPrice: productPriceChanges.newSellingPrice,
      reason: productPriceChanges.reason,
      userName: users.fullName,
      createdAt: productPriceChanges.createdAt,
    })
    .from(productPriceChanges)
    .leftJoin(users, eq(users.id, productPriceChanges.userId))
    .where(eq(productPriceChanges.productId, productId))
    .orderBy(desc(productPriceChanges.id))
    .limit(limit);
}

export interface CatalogItem {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  sellingPrice: number;
  quantity: number;
  categoryId: string | null;
  categoryName: string | null;
  imageKey: string | null;
}

/**
 * Products that can be sold at the POS: ACTIVE ones (with stock). Zero-stock products are automatically
 * excluded because they become OUT_OF_STOCK; when negative stock is allowed they remain sellable.
 */
export async function getPosCatalog(db: DbClient): Promise<CatalogItem[]> {
  const allowNegative = await isNegativeStockAllowed(db);
  return db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      barcode: products.barcode,
      sellingPrice: products.sellingPrice,
      quantity: products.quantity,
      categoryId: products.categoryId,
      categoryName: categories.name,
      imageKey: products.imageKey,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(allowNegative ? inArray(products.status, ["ACTIVE", "OUT_OF_STOCK"]) : eq(products.status, "ACTIVE"))
    .orderBy(asc(products.name));
}

export async function listProductOptions(db: DbClient) {
  return db
    .select({ id: products.id, name: products.name, sku: products.sku, costPrice: products.costPrice, status: products.status })
    .from(products)
    .orderBy(asc(products.name));
}
