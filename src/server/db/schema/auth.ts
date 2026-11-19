import { sql } from "drizzle-orm";
import {
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
import { createdAt, tsz, updatedAt } from "./columns";
import { userRole } from "./enums";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: varchar("full_name", { length: 120 }).notNull(),
    username: varchar("username", { length: 60 }).notNull(),
    email: varchar("email", { length: 160 }),
    phone: varchar("phone", { length: 30 }),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: tsz("locked_until"),
    lastLoginAt: tsz("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_username_lower_uq").on(sql`lower(${t.username})`),
    check("users_failed_attempts_ck", sql`${t.failedLoginAttempts} >= 0`),
  ],
);

/** Server-side sessions. `id` is the SHA-256 hash of the random cookie token, never the token itself. */
export const sessions = pgTable(
  "sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: tsz("expires_at").notNull(),
    lastSeenAt: tsz("last_seen_at").notNull().defaultNow(),
    userAgent: varchar("user_agent", { length: 255 }),
    ipAddress: varchar("ip_address", { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);
