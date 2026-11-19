import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { createdAt, money, tsz, updatedAt } from "./columns";
import { movementType, productStatus } from "./enums";

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 80 }).notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("categories_name_lower_uq").on(sql`lower(${t.name})`)],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    contactPerson: varchar("contact_person", { length: 120 }),
    phone: varchar("phone", { length: 30 }),
    email: varchar("email", { length: 160 }),
    address: text("address"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("suppliers_name_lower_uq").on(sql`lower(${t.name})`)],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 160 }).notNull(),
    sku: varchar("sku", { length: 60 }).notNull(),
    barcode: varchar("barcode", { length: 64 }),
    categoryId: uuid("category_id").references(() => categories.id),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    description: text("description"),
    /** Current weighted-average unit cost in pesewas. Historical costs live on sale items and movements. */
    costPrice: money("cost_price").notNull().default(0),
    sellingPrice: money("selling_price").notNull(),
    quantity: integer("quantity").notNull().default(0),
    reorderThreshold: integer("reorder_threshold").notNull().default(5),
    initialStock: integer("initial_stock").notNull().default(0),
    imageKey: varchar("image_key", { length: 255 }),
    status: productStatus("status").notNull().default("ACTIVE"),
    outOfStockAt: tsz("out_of_stock_at"),
    archivedAt: tsz("archived_at"),
    archiveReason: text("archive_reason"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("products_sku_upper_uq").on(sql`upper(${t.sku})`),
    uniqueIndex("products_barcode_uq").on(t.barcode).where(sql`${t.barcode} is not null`),
    index("products_status_name_idx").on(t.status, t.name),
    index("products_category_idx").on(t.categoryId),
    check("products_cost_ck", sql`${t.costPrice} >= 0`),
    check("products_price_ck", sql`${t.sellingPrice} >= 0`),
    check("products_reorder_ck", sql`${t.reorderThreshold} >= 0`),
    check("products_initial_ck", sql`${t.initialStock} >= 0`),
  ],
);

/** Lightweight price history: one row per cost/selling price change. */
export const productPriceChanges = pgTable(
  "product_price_changes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    oldCostPrice: money("old_cost_price").notNull(),
    newCostPrice: money("new_cost_price").notNull(),
    oldSellingPrice: money("old_selling_price").notNull(),
    newSellingPrice: money("new_selling_price").notNull(),
    reason: text("reason"),
    userId: uuid("user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("price_changes_product_idx").on(t.productId, t.createdAt)],
);

/**
 * Append-only stock ledger. Every change to products.quantity has exactly one row here.
 * UPDATE/DELETE are blocked by a database trigger.
 */
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    type: movementType("type").notNull(),
    quantityChange: integer("quantity_change").notNull(),
    previousQuantity: integer("previous_quantity").notNull(),
    newQuantity: integer("new_quantity").notNull(),
    unitCost: money("unit_cost"),
    referenceType: varchar("reference_type", { length: 32 }),
    referenceId: uuid("reference_id"),
    reason: text("reason"),
    userId: uuid("user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("movements_product_idx").on(t.productId, t.id),
    index("movements_created_idx").on(t.createdAt),
    index("movements_reference_idx").on(t.referenceType, t.referenceId),
    check("movements_nonzero_ck", sql`${t.quantityChange} <> 0`),
    check(
      "movements_balance_ck",
      sql`${t.newQuantity} = ${t.previousQuantity} + ${t.quantityChange}`,
    ),
  ],
);
