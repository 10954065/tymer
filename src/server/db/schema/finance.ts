import { sql } from "drizzle-orm";
import {
  boolean,
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
import { products, suppliers } from "./catalog";
import { createdAt, money, tsz, updatedAt } from "./columns";
import {
  cashSessionStatus,
  paymentKind,
  paymentMethod,
  purchaseStatus,
  supplierPaymentKind,
} from "./enums";
import { orders } from "./orders";
import { customers, saleReturns, sales } from "./sales";

export const paymentNumberSeq = pgSequence("payment_number_seq", { startWith: 1 });
export const purchaseNumberSeq = pgSequence("purchase_number_seq", { startWith: 1 });
export const supplierPaymentNumberSeq = pgSequence("supplier_payment_number_seq", { startWith: 1 });
export const expenseNumberSeq = pgSequence("expense_number_seq", { startWith: 1 });

/**
 * Customer payment ledger (append-only). Amount is signed:
 * RECEIPT > 0, REFUND < 0, REVERSAL < 0 (cancels a mistaken receipt).
 * Exactly one of sale_id / order_id is set.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentNumber: varchar("payment_number", { length: 20 })
      .notNull()
      .default(sql`'PAY-' || lpad(nextval('payment_number_seq')::text, 6, '0')`),
    kind: paymentKind("kind").notNull(),
    method: paymentMethod("method").notNull(),
    amount: money("amount").notNull(),
    saleId: uuid("sale_id").references(() => sales.id),
    orderId: uuid("order_id").references(() => orders.id),
    customerId: uuid("customer_id").references(() => customers.id),
    returnId: uuid("return_id").references(() => saleReturns.id),
    reversesPaymentId: uuid("reverses_payment_id"),
    externalReference: varchar("external_reference", { length: 100 }),
    notes: text("notes"),
    receivedBy: uuid("received_by")
      .notNull()
      .references(() => users.id),
    receivedAt: tsz("received_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("payments_number_uq").on(t.paymentNumber),
    uniqueIndex("payments_reverses_uq").on(t.reversesPaymentId).where(sql`${t.reversesPaymentId} is not null`),
    index("payments_sale_idx").on(t.saleId),
    index("payments_order_idx").on(t.orderId),
    index("payments_customer_idx").on(t.customerId),
    index("payments_received_idx").on(t.receivedAt),
    check("payments_target_ck", sql`(${t.saleId} is not null) <> (${t.orderId} is not null)`),
    check(
      "payments_sign_ck",
      sql`(${t.kind} = 'RECEIPT' and ${t.amount} > 0) or (${t.kind} <> 'RECEIPT' and ${t.amount} < 0)`,
    ),
    check("payments_reversal_ck", sql`(${t.kind} = 'REVERSAL') = (${t.reversesPaymentId} is not null)`),
  ],
);

export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseNumber: varchar("purchase_number", { length: 20 })
      .notNull()
      .default(sql`'PUR-' || lpad(nextval('purchase_number_seq')::text, 6, '0')`),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    status: purchaseStatus("status").notNull().default("DRAFT"),
    supplierReference: varchar("supplier_reference", { length: 100 }),
    purchaseDate: date("purchase_date", { mode: "string" }).notNull(),
    total: money("total").notNull().default(0),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    receivedAt: tsz("received_at"),
    receivedBy: uuid("received_by").references(() => users.id),
    cancelledAt: tsz("cancelled_at"),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    uniqueIndex("purchases_number_uq").on(t.purchaseNumber),
    index("purchases_supplier_idx").on(t.supplierId),
    index("purchases_date_idx").on(t.purchaseDate),
    check("purchases_total_ck", sql`${t.total} >= 0`),
  ],
);

export const purchaseItems = pgTable(
  "purchase_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    quantity: integer("quantity").notNull(),
    unitCost: money("unit_cost").notNull(),
    lineTotal: money("line_total").notNull(),
  },
  (t) => [
    index("purchase_items_purchase_idx").on(t.purchaseId),
    index("purchase_items_product_idx").on(t.productId),
    check("purchase_items_qty_ck", sql`${t.quantity} > 0`),
    check("purchase_items_total_ck", sql`${t.lineTotal} = ${t.quantity} * ${t.unitCost} and ${t.unitCost} >= 0`),
  ],
);

/** Payments made to suppliers (append-only, signed like customer payments). */
export const supplierPayments = pgTable(
  "supplier_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentNumber: varchar("payment_number", { length: 20 })
      .notNull()
      .default(sql`'SPY-' || lpad(nextval('supplier_payment_number_seq')::text, 6, '0')`),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    kind: supplierPaymentKind("kind").notNull(),
    method: paymentMethod("method").notNull(),
    amount: money("amount").notNull(),
    reversesPaymentId: uuid("reverses_payment_id"),
    externalReference: varchar("external_reference", { length: 100 }),
    notes: text("notes"),
    paidBy: uuid("paid_by")
      .notNull()
      .references(() => users.id),
    paidAt: tsz("paid_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("supplier_payments_number_uq").on(t.paymentNumber),
    uniqueIndex("supplier_payments_reverses_uq").on(t.reversesPaymentId).where(sql`${t.reversesPaymentId} is not null`),
    index("supplier_payments_purchase_idx").on(t.purchaseId),
    index("supplier_payments_paid_idx").on(t.paidAt),
    check(
      "supplier_payments_sign_ck",
      sql`(${t.kind} = 'PAYMENT' and ${t.amount} > 0) or (${t.kind} = 'REVERSAL' and ${t.amount} < 0 and ${t.reversesPaymentId} is not null)`,
    ),
  ],
);

export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 80 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("expense_categories_name_lower_uq").on(sql`lower(${t.name})`)],
);

/**
 * Expenses. Amount and date are immutable; corrections create a reversal row (negative amount,
 * same expense_date) plus a new expense. Expenses linked to an order are direct order costs and are
 * excluded from operating expenses.
 */
export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expenseNumber: varchar("expense_number", { length: 20 })
      .notNull()
      .default(sql`'EXP-' || lpad(nextval('expense_number_seq')::text, 6, '0')`),
    description: varchar("description", { length: 200 }).notNull(),
    amount: money("amount").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => expenseCategories.id),
    expenseDate: date("expense_date", { mode: "string" }).notNull(),
    paymentMethod: paymentMethod("payment_method").notNull(),
    orderId: uuid("order_id").references(() => orders.id),
    reversalOfId: uuid("reversal_of_id"),
    attachmentKey: varchar("attachment_key", { length: 255 }),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("expenses_number_uq").on(t.expenseNumber),
    uniqueIndex("expenses_reversal_uq").on(t.reversalOfId).where(sql`${t.reversalOfId} is not null`),
    index("expenses_date_idx").on(t.expenseDate),
    index("expenses_category_idx").on(t.categoryId),
    index("expenses_order_idx").on(t.orderId),
    check(
      "expenses_sign_ck",
      sql`(${t.reversalOfId} is null and ${t.amount} > 0) or (${t.reversalOfId} is not null and ${t.amount} < 0)`,
    ),
  ],
);

/** One cash drawer session per business day. Expected cash is snapshotted at close. */
export const cashSessions = pgTable(
  "cash_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    status: cashSessionStatus("status").notNull().default("OPEN"),
    openingBalance: money("opening_balance").notNull(),
    openingNotes: text("opening_notes"),
    openedBy: uuid("opened_by")
      .notNull()
      .references(() => users.id),
    openedAt: tsz("opened_at").notNull().defaultNow(),
    cashReceived: money("cash_received"),
    cashRefunds: money("cash_refunds"),
    cashExpenses: money("cash_expenses"),
    cashSupplierPayments: money("cash_supplier_payments"),
    expectedClosing: money("expected_closing"),
    actualClosing: money("actual_closing"),
    difference: money("difference"),
    explanation: text("explanation"),
    closedBy: uuid("closed_by").references(() => users.id),
    closedAt: tsz("closed_at"),
  },
  (t) => [
    uniqueIndex("cash_sessions_date_uq").on(t.businessDate),
    check("cash_sessions_opening_ck", sql`${t.openingBalance} >= 0`),
    check(
      "cash_sessions_closed_ck",
      sql`${t.status} = 'OPEN' or (${t.actualClosing} is not null and ${t.expectedClosing} is not null and ${t.closedAt} is not null)`,
    ),
  ],
);
