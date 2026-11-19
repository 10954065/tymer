import { z } from "zod";
import { moneyInput, optionalText, paymentMethod, requiredText } from "./common";

const pesewas = z.number().int().min(0).max(100_000_000_000);

export const checkoutSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  customerId: z.uuid().nullable(),
  items: z
    .array(
      z.object({
        productId: z.uuid(),
        quantity: z.number().int().min(1).max(100_000),
        discount: pesewas.default(0),
        unitPrice: pesewas.optional(),
      }),
    )
    .min(1, "The cart is empty")
    .max(200),
  cartDiscount: pesewas.default(0),
  payments: z
    .array(z.object({ method: paymentMethod, amount: pesewas, externalReference: optionalText(100) }))
    .max(10),
  notes: optionalText(500),
  deviceId: z.string().max(64).nullable().optional(),
  clientCreatedAt: z.coerce.date().nullable().optional(),
});

export type CheckoutPayload = z.input<typeof checkoutSchema>;

export const salePaymentSchema = z.object({
  saleId: z.uuid(),
  amount: moneyInput({ min: 1 }),
  method: paymentMethod,
  externalReference: optionalText(100),
  notes: optionalText(300),
});

export const voidSaleSchema = z.object({
  saleId: z.uuid(),
  reason: requiredText(300, "Reason").min(3, "Give a short reason"),
});

export const returnSchema = z.object({
  saleId: z.uuid(),
  idempotencyKey: z.string().min(8).max(100),
  reason: requiredText(300, "Reason").min(3, "Give a short reason"),
  items: z.array(z.object({ saleItemId: z.uuid(), quantity: z.number().int().min(1), restock: z.boolean() })).min(1, "Select items to return"),
  refund: z.object({ method: paymentMethod, amount: pesewas }).nullable(),
});

export const reversePaymentSchema = z.object({
  paymentId: z.uuid(),
  reason: requiredText(300, "Reason").min(3, "Give a short reason"),
});

export const customerSchema = z.object({
  fullName: requiredText(120, "Name"),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[+\d][\d\s-]{6,}$/, "Enter a valid phone number")
    .or(z.literal(""))
    .optional()
    .nullable()
    .transform((v) => (v ? v.replace(/\s+/g, "") : null)),
  email: z.email("Enter a valid email").or(z.literal("")).optional().nullable().transform((v) => (v ? v.toLowerCase() : null)),
  address: optionalText(300),
  notes: optionalText(1000),
});

export const updateCustomerSchema = customerSchema.extend({ id: z.uuid(), isActive: z.boolean() });
