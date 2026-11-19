import { z } from "zod";
import { tryParseMoney } from "@/lib/money";
import { isBusinessDate } from "@/lib/dates";

export const uuid = z.uuid({ message: "Invalid identifier" });

export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const requiredText = (max = 160, label = "This field") =>
  z.string().trim().min(1, `${label} is required`).max(max, `At most ${max} characters`);

export const phone = z
  .string()
  .trim()
  .max(30)
  .regex(/^[+\d][\d\s-]{6,}$/, "Enter a valid phone number")
  .or(z.literal(""))
  .optional()
  .nullable()
  .transform((v) => (v ? v.replace(/\s+/g, " ") : null));

export const email = z
  .email("Enter a valid email address")
  .max(160)
  .or(z.literal(""))
  .optional()
  .nullable()
  .transform((v) => (v ? v.toLowerCase() : null));

/** Accepts "12.50" strings (from forms) or integer pesewas; outputs integer pesewas. */
export const moneyInput = (options: { min?: number } = {}) =>
  z.union([z.string(), z.number()]).transform((value, ctx) => {
    const pesewas = typeof value === "number" && Number.isInteger(value) ? value : tryParseMoney(String(value));
    if (pesewas === null) {
      ctx.addIssue({ code: "custom", message: "Enter a valid amount (e.g. 25.00)" });
      return z.NEVER;
    }
    const min = options.min ?? 0;
    if (pesewas < min) {
      ctx.addIssue({ code: "custom", message: min > 0 ? "Amount must be greater than zero" : "Amount cannot be negative" });
      return z.NEVER;
    }
    if (pesewas > 100_000_000_000) {
      ctx.addIssue({ code: "custom", message: "Amount is too large" });
      return z.NEVER;
    }
    return pesewas;
  });

export const quantity = z.coerce
  .number({ message: "Enter a quantity" })
  .int("Quantity must be a whole number")
  .min(1, "Quantity must be at least 1")
  .max(1_000_000, "Quantity is too large");

export const businessDate = z.string().refine(isBusinessDate, "Enter a valid date");

export const PAYMENT_METHODS = ["CASH", "MTN_MOMO", "TELECEL_CASH", "AT_MONEY", "BANK_TRANSFER", "CARD", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  MTN_MOMO: "MTN Mobile Money",
  TELECEL_CASH: "Telecel Cash",
  AT_MONEY: "AT Money",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  OTHER: "Other",
};
export const paymentMethod = z.enum(PAYMENT_METHODS, { message: "Choose a payment method" });

export const pageParam = z.coerce.number().int().min(1).max(100_000).catch(1);
export const searchParam = z.string().trim().max(100).catch("");
