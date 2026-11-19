import { z } from "zod";
import { moneyInput, optionalText, paymentMethod, requiredText } from "./common";

export const orderItemSchema = z
  .object({
    kind: z.enum(["PRODUCT", "SERVICE"]),
    productId: z.string().optional().nullable().transform((v) => (v ? v : null)),
    description: requiredText(200, "Description"),
    quantity: z.coerce.number().int("Whole number").min(1, "At least 1").max(100_000),
    unitPrice: moneyInput(),
  })
  .refine((i) => i.kind === "SERVICE" || (i.productId && z.uuid().safeParse(i.productId).success), { message: "Choose a product", path: ["productId"] });

export const orderSchema = z.object({
  customerId: z.uuid({ message: "Choose a customer" }),
  title: requiredText(160, "Order title"),
  description: optionalText(2000),
  items: z.array(orderItemSchema).min(1, "Add at least one line").max(100),
  estimatedMaterialsCost: moneyInput(),
  estimatedLabourCost: moneyInput(),
  expectedCompletionDate: z.string().optional().nullable().transform((v) => (v ? v : null)),
  fulfilment: z.enum(["COLLECTION", "DELIVERY"]),
  deliveryAddress: optionalText(300),
  deliveryNotes: optionalText(500),
  internalNotes: optionalText(2000),
});

export type OrderFormValues = z.input<typeof orderSchema>;

export const orderPaymentSchema = z.object({
  orderId: z.uuid(),
  amount: moneyInput({ min: 1 }),
  method: paymentMethod,
  externalReference: optionalText(100),
  notes: optionalText(300),
});

export const cancelOrderSchema = z.object({
  orderId: z.uuid(),
  reason: requiredText(300, "Reason").min(3),
  refund: z.object({ method: paymentMethod, amount: z.number().int().min(0) }).nullable(),
});

export const orderStatusSchema = z.object({ orderId: z.uuid(), status: z.enum(["IN_PROGRESS", "READY"]) });
