import { bigint, timestamp } from "drizzle-orm/pg-core";

/** Monetary value in pesewas (1 GHS = 100 pesewas). Never store money as floating point. */
export const money = (name: string) => bigint(name, { mode: "number" });

export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const tsz = (name: string) => timestamp(name, { withTimezone: true });
