import { z } from "zod";
import { businessDate, email, moneyInput, optionalText, paymentMethod, phone, requiredText } from "./common";

export const supplierSchema = z.object({
  name: requiredText(120, "Supplier name"),
  contactPerson: optionalText(120),
  phone,
  email,
  address: optionalText(300),
  notes: optionalText(1000),
});

export const updateSupplierSchema = supplierSchema.extend({ id: z.uuid(), isActive: z.boolean() });

export const purchaseItemSchema = z.object({
  productId: z.uuid({ message: "Choose a product" }),
  quantity: z.coerce.number().int("Whole number").min(1, "At least 1").max(1_000_000),
  unitCost: moneyInput(),
});

export const purchaseSchema = z.object({
  supplierId: z.uuid({ message: "Choose a supplier" }),
  purchaseDate: businessDate,
  supplierReference: optionalText(100),
  notes: optionalText(1000),
  items: z.array(purchaseItemSchema).min(1, "Add at least one product").max(200),
  receiveNow: z.boolean().default(false),
});

export const supplierPaymentSchema = z.object({
  purchaseId: z.uuid(),
  amount: moneyInput({ min: 1 }),
  method: paymentMethod,
  externalReference: optionalText(100),
  notes: optionalText(300),
});

export const reverseSchema = z.object({
  paymentId: z.uuid(),
  reason: requiredText(300, "Reason").min(3, "Give a short reason"),
});

export type PurchaseFormValues = z.input<typeof purchaseSchema>;
