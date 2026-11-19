import { z } from "zod";
import { moneyInput, optionalText, requiredText } from "./common";

/** Empty strings and the select "__none__" sentinel both mean "not set". */
const optionalUuid = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v && v !== "__none__" ? v : null))
  .pipe(z.uuid().nullable());

const optionalCode = (max: number, pattern: RegExp, message: string) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || pattern.test(v), message);

export const productFieldsSchema = z.object({
  name: requiredText(160, "Product name"),
  sku: optionalCode(60, /^[A-Za-z0-9._-]+$/, "Use letters, numbers, dots or dashes"),
  barcode: optionalCode(64, /^[A-Za-z0-9-]+$/, "Barcodes contain letters, numbers or dashes"),
  categoryId: optionalUuid,
  supplierId: optionalUuid,
  description: optionalText(1000),
  costPrice: moneyInput(),
  sellingPrice: moneyInput(),
  reorderThreshold: z.coerce.number().int("Whole number").min(0).max(100_000),
  imageKey: optionalText(255),
});

export const createProductSchema = productFieldsSchema.extend({
  initialStock: z.coerce.number().int("Whole number").min(0, "Cannot be negative").max(1_000_000),
});

export const updateProductSchema = productFieldsSchema.extend({
  id: z.uuid(),
  priceChangeReason: optionalText(300),
});

export const adjustStockSchema = z.object({
  productId: z.uuid(),
  kind: z.enum(["DAMAGE", "LOSS", "MANUAL_ADJUSTMENT"]),
  direction: z.enum(["increase", "decrease"]),
  quantity: z.coerce.number().int("Whole number").min(1, "At least 1").max(1_000_000),
  reason: requiredText(300, "Reason").min(3, "Give a short reason"),
});

export const restockSchema = z.object({
  productId: z.uuid(),
  quantity: z.coerce.number().int("Whole number").min(1, "At least 1").max(1_000_000),
  unitCost: moneyInput(),
  reason: optionalText(300),
});

export const archiveProductSchema = z.object({
  id: z.uuid(),
  reason: requiredText(300, "Reason").min(3, "Give a short reason"),
  discontinue: z.boolean(),
});

export const categorySchema = z.object({
  name: requiredText(80, "Category name"),
  description: optionalText(300),
});

export const updateCategorySchema = categorySchema.extend({ id: z.uuid(), isActive: z.boolean() });

export type CreateProductValues = z.input<typeof createProductSchema>;
export type UpdateProductValues = z.input<typeof updateProductSchema>;
