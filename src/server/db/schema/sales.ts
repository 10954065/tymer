import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgSequence,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { products } from "./catalog";
import { createdAt, money, tsz, updatedAt } from "./columns";
import { saleStatus } from "./enums";

export const saleNumberSeq = pgSequence("sale_number_seq", { startWith: 1 });
export const returnNumberSeq = pgSequence("return_number_seq", { startWith: 1 });

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: varchar("full_name", { length: 120 }).notNull(),
    phone: varchar("phone", { length: 30 }),
    email: varchar("email", { length: 160 }),
    address: text("address"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("customers_phone_uq").on(t.phone).where(sql`${t.phone} is not null`),
    index("customers_name_idx").on(sql`lower(${t.fullName})`),
  ],
);

/**
 * A completed POS sale. Totals are snapshots computed inside the checkout transaction.
 * Revenue (ex-tax) = subtotal - discount_total. Balance = total - returned value - net payments.
 */
export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleNumber: varchar("sale_number", { length: 20 })
      .notNull()
      .default(sql`'SAL-' || lpad(nextval('sale_number_seq')::text, 6, '0')`),
    idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    status: saleStatus("status").notNull().default("COMPLETED"),
    subtotal: money("subtotal").notNull(),
    discountTotal: money("discount_total").notNull().default(0),
    taxTotal: money("tax_total").notNull().default(0),
    total: money("total").notNull(),
    costTotal: money("cost_total").notNull(),
    source: varchar("source", { length: 16 }).notNull().default("POS"),
    deviceId: varchar("device_id", { length: 64 }),
    clientCreatedAt: tsz("client_created_at"),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    voidedAt: tsz("voided_at"),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidReason: text("void_reason"),
  },
  (t) => [
    uniqueIndex("sales_number_uq").on(t.saleNumber),
    uniqueIndex("sales_idempotency_uq").on(t.idempotencyKey),
    index("sales_created_idx").on(t.createdAt),
    index("sales_customer_idx").on(t.customerId),
    check("sales_amounts_ck", sql`${t.subtotal} >= 0 and ${t.discountTotal} >= 0 and ${t.taxTotal} >= 0 and ${t.costTotal} >= 0`),
    check("sales_total_ck", sql`${t.total} = ${t.subtotal} - ${t.discountTotal} + ${t.taxTotal}`),
    check("sales_void_ck", sql`(${t.status} = 'VOIDED') = (${t.voidedAt} is not null)`),
  ],
);

/** Immutable snapshot of each line at sale time. Later product edits never alter these rows. */
export const saleItems = pgTable(
  "sale_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    productName: varchar("product_name", { length: 160 }).notNull(),
    sku: varchar("sku", { length: 60 }).notNull(),
    quantity: integer("quantity").notNull(),
    unitCost: money("unit_cost").notNull(),
    unitPrice: money("unit_price").notNull(),
    discount: money("discount").notNull().default(0),
    tax: money("tax").notNull().default(0),
    lineTotal: money("line_total").notNull(),
    returnedQuantity: integer("returned_quantity").notNull().default(0),
  },
  (t) => [
    index("sale_items_sale_idx").on(t.saleId),
    index("sale_items_product_idx").on(t.productId),
    check("sale_items_qty_ck", sql`${t.quantity} > 0`),
    check("sale_items_returned_ck", sql`${t.returnedQuantity} >= 0 and ${t.returnedQuantity} <= ${t.quantity}`),
    check("sale_items_money_ck", sql`${t.unitCost} >= 0 and ${t.unitPrice} >= 0 and ${t.discount} >= 0 and ${t.tax} >= 0`),
    check("sale_items_discount_ck", sql`${t.discount} <= ${t.quantity} * ${t.unitPrice}`),
    check("sale_items_total_ck", sql`${t.lineTotal} = ${t.quantity} * ${t.unitPrice} - ${t.discount} + ${t.tax}`),
  ],
);

/** A customer return against a sale. Value fields reduce revenue in the period the return is recorded. */
export const saleReturns = pgTable(
  "sale_returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    returnNumber: varchar("return_number", { length: 20 })
      .notNull()
      .default(sql`'RET-' || lpad(nextval('return_number_seq')::text, 6, '0')`),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id),
    idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
    reason: text("reason").notNull(),
    /** Revenue reversed, excluding tax. */
    valueTotal: money("value_total").notNull(),
    taxTotal: money("tax_total").notNull().default(0),
    /** Cost of goods put back into stock (reduces COGS). */
    restockedCostTotal: money("restocked_cost_total").notNull().default(0),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sale_returns_number_uq").on(t.returnNumber),
    uniqueIndex("sale_returns_idempotency_uq").on(t.idempotencyKey),
    index("sale_returns_sale_idx").on(t.saleId),
    index("sale_returns_created_idx").on(t.createdAt),
    check("sale_returns_money_ck", sql`${t.valueTotal} >= 0 and ${t.taxTotal} >= 0 and ${t.restockedCostTotal} >= 0`),
  ],
);

export const saleReturnItems = pgTable(
  "sale_return_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => saleReturns.id),
    saleItemId: uuid("sale_item_id")
      .notNull()
      .references(() => saleItems.id),
    quantity: integer("quantity").notNull(),
    restocked: boolean("restocked").notNull(),
    value: money("value").notNull(),
    tax: money("tax").notNull().default(0),
    unitCost: money("unit_cost").notNull(),
  },
  (t) => [
    index("sale_return_items_return_idx").on(t.returnId),
    check("sale_return_items_qty_ck", sql`${t.quantity} > 0`),
  ],
);

export const syncDevices = pgTable("sync_devices", {
  id: varchar("id", { length: 64 }).primaryKey(),
  label: varchar("label", { length: 120 }),
  lastSyncAt: tsz("last_sync_at"),
  lastUserId: uuid("last_user_id").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
