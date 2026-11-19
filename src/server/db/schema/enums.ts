import { pgEnum } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["OWNER", "MANAGER", "CASHIER", "INVENTORY_STAFF"]);

export const productStatus = pgEnum("product_status", [
  "ACTIVE",
  "OUT_OF_STOCK",
  "ARCHIVED",
  "DISCONTINUED",
]);

export const movementType = pgEnum("movement_type", [
  "INITIAL_STOCK",
  "PURCHASE",
  "SALE",
  "CUSTOMER_RETURN",
  "DAMAGE",
  "LOSS",
  "MANUAL_ADJUSTMENT",
  "REVERSAL",
]);

export const paymentMethod = pgEnum("payment_method", [
  "CASH",
  "MTN_MOMO",
  "TELECEL_CASH",
  "AT_MONEY",
  "BANK_TRANSFER",
  "CARD",
  "OTHER",
]);

/** RECEIPT = money in (positive amount); REFUND / REVERSAL = money out or cancellation (negative amount). */
export const paymentKind = pgEnum("payment_kind", ["RECEIPT", "REFUND", "REVERSAL"]);

export const saleStatus = pgEnum("sale_status", ["COMPLETED", "VOIDED"]);

export const orderStatus = pgEnum("order_status", [
  "NEW",
  "DEPOSIT_PAID",
  "IN_PROGRESS",
  "READY",
  "COMPLETED",
  "CANCELLED",
]);

export const orderItemKind = pgEnum("order_item_kind", ["PRODUCT", "SERVICE"]);

export const fulfilmentType = pgEnum("fulfilment_type", ["COLLECTION", "DELIVERY"]);

export const purchaseStatus = pgEnum("purchase_status", ["DRAFT", "RECEIVED", "CANCELLED"]);

export const supplierPaymentKind = pgEnum("supplier_payment_kind", ["PAYMENT", "REVERSAL"]);

export const cashSessionStatus = pgEnum("cash_session_status", ["OPEN", "CLOSED"]);

export const syncConflictStatus = pgEnum("sync_conflict_status", [
  "PENDING",
  "RESOLVED_RECORDED",
  "DISMISSED",
]);

export const backupStatus = pgEnum("backup_status", ["SUCCESS", "FAILED"]);
