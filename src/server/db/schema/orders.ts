import { sql } from "drizzle-orm";
import {
  check,
  date,
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
import { fulfilmentType, orderItemKind, orderStatus } from "./enums";
import { customers } from "./sales";

export const orderNumberSeq = pgSequence("order_number_seq", { startWith: 1 });

/**
 * Customer orders / custom decoration jobs.
 * Revenue is recognised when the order is COMPLETED (total_amount). Deposits are payments, not revenue.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderNumber: varchar("order_number", { length: 20 })
      .notNull()
      .default(sql`'ORD-' || lpad(nextval('order_number_seq')::text, 6, '0')`),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    title: varchar("title", { length: 160 }).notNull(),
    description: text("description"),
    status: orderStatus("status").notNull().default("NEW"),
    /** Agreed price for the whole order (sum of item line totals). */
    totalAmount: money("total_amount").notNull().default(0),
    estimatedMaterialsCost: money("estimated_materials_cost").notNull().default(0),
    estimatedLabourCost: money("estimated_labour_cost").notNull().default(0),
    /** Cost of stocked products consumed, snapshotted at completion. */
    productCostTotal: money("product_cost_total").notNull().default(0),
    expectedCompletionDate: date("expected_completion_date", { mode: "string" }),
    fulfilment: fulfilmentType("fulfilment").notNull().default("COLLECTION"),
    deliveryAddress: text("delivery_address"),
    deliveryNotes: text("delivery_notes"),
    internalNotes: text("internal_notes"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: tsz("completed_at"),
    cancelledAt: tsz("cancelled_at"),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    uniqueIndex("orders_number_uq").on(t.orderNumber),
    index("orders_customer_idx").on(t.customerId),
    index("orders_status_idx").on(t.status, t.createdAt),
    index("orders_completed_idx").on(t.completedAt),
    check(
      "orders_money_ck",
      sql`${t.totalAmount} >= 0 and ${t.estimatedMaterialsCost} >= 0 and ${t.estimatedLabourCost} >= 0 and ${t.productCostTotal} >= 0`,
    ),
    check("orders_completed_ck", sql`(${t.status} = 'COMPLETED') = (${t.completedAt} is not null)`),
    check("orders_cancelled_ck", sql`(${t.status} = 'CANCELLED') = (${t.cancelledAt} is not null)`),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    kind: orderItemKind("kind").notNull(),
    productId: uuid("product_id").references(() => products.id),
    description: varchar("description", { length: 200 }).notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    lineTotal: money("line_total").notNull(),
    /** Unit cost snapshot taken when stock is deducted on completion. */
    unitCost: money("unit_cost"),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    check("order_items_qty_ck", sql`${t.quantity} > 0`),
    check("order_items_total_ck", sql`${t.lineTotal} = ${t.quantity} * ${t.unitPrice} and ${t.unitPrice} >= 0`),
    check("order_items_product_ck", sql`(${t.kind} = 'PRODUCT') = (${t.productId} is not null)`),
  ],
);
