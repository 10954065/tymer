import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { createdAt, tsz, updatedAt } from "./columns";
import { backupStatus, syncConflictStatus } from "./enums";
import { sales } from "./sales";

/** Single-row business configuration (id is always 1). */
export const businessSettings = pgTable(
  "business_settings",
  {
    id: integer("id").primaryKey().default(1),
    businessName: varchar("business_name", { length: 160 }).notNull().default("SMARTLIVING BUYNFRY VENTURES"),
    address: text("address"),
    phone: varchar("phone", { length: 60 }),
    email: varchar("email", { length: 160 }),
    receiptFooter: text("receipt_footer").default("Thank you for shopping with us!"),
    allowNegativeStock: boolean("allow_negative_stock").notNull().default(false),
    defaultReorderThreshold: integer("default_reorder_threshold").notNull().default(5),
    /** Maximum discount a cashier may give without manager rights, in basis points (1000 = 10%). */
    cashierMaxDiscountBps: integer("cashier_max_discount_bps").notNull().default(1000),
    /** Sales tax rate in basis points applied at checkout (0 = no tax). */
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    taxLabel: varchar("tax_label", { length: 40 }).default("VAT"),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("business_settings_singleton_ck", sql`${t.id} = 1`),
    check("business_settings_discount_ck", sql`${t.cashierMaxDiscountBps} between 0 and 10000`),
    check("business_settings_tax_ck", sql`${t.taxRateBps} between 0 and 10000`),
  ],
);

/** Append-only audit trail. Only changed fields are stored to keep rows small. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id),
    action: varchar("action", { length: 64 }).notNull(),
    entityType: varchar("entity_type", { length: 40 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    reference: varchar("reference", { length: 100 }),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId),
    index("audit_created_idx").on(t.createdAt),
    index("audit_user_idx").on(t.userId),
  ],
);

/** Offline sales that could not be recorded automatically and need owner review. Never deleted. */
export const syncConflicts = pgTable(
  "sync_conflicts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
    deviceId: varchar("device_id", { length: 64 }),
    submittedBy: uuid("submitted_by").references(() => users.id),
    payload: jsonb("payload").notNull(),
    reason: varchar("reason", { length: 40 }).notNull(),
    details: jsonb("details"),
    status: syncConflictStatus("status").notNull().default("PENDING"),
    saleId: uuid("sale_id").references(() => sales.id),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: tsz("resolved_at"),
    resolutionNote: text("resolution_note"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sync_conflicts_key_uq").on(t.idempotencyKey),
    index("sync_conflicts_status_idx").on(t.status, t.createdAt),
  ],
);

/** Reported by the backup workflow after each run; only verified runs count as valid backups. */
export const backupRuns = pgTable(
  "backup_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: backupStatus("status").notNull(),
    startedAt: tsz("started_at").notNull(),
    finishedAt: tsz("finished_at").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    checksum: varchar("checksum", { length: 128 }),
    verified: boolean("verified").notNull().default(false),
    location: text("location"),
    details: jsonb("details"),
    createdAt: createdAt(),
  },
  (t) => [index("backup_runs_created_idx").on(t.createdAt)],
);
