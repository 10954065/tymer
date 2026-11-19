import { z } from "zod";
import { email, optionalText, phone, requiredText } from "./common";

/** Percentages are entered as e.g. "12.5" and stored as basis points (1250). */
const percentToBps = z.coerce
  .number({ message: "Enter a percentage" })
  .min(0, "Cannot be negative")
  .max(100, "Cannot exceed 100%")
  .transform((v) => Math.round(v * 100));

export const settingsSchema = z.object({
  businessName: requiredText(160, "Business name"),
  address: optionalText(300),
  phone,
  email,
  receiptFooter: optionalText(300),
  allowNegativeStock: z.boolean(),
  defaultReorderThreshold: z.coerce.number().int().min(0).max(100_000),
  cashierMaxDiscountPercent: percentToBps,
  taxRatePercent: percentToBps,
  taxLabel: optionalText(40),
});

export type SettingsFormValues = z.input<typeof settingsSchema>;
