import { z } from "zod";
import { businessDate, moneyInput, optionalText, paymentMethod, requiredText } from "./common";

const optionalUuid = z.string().optional().nullable().transform((v) => (v && v !== "__none__" ? v : null)).pipe(z.uuid().nullable());

export const expenseSchema = z.object({
  description: requiredText(200, "Description"),
  amount: moneyInput({ min: 1 }),
  categoryId: z.uuid({ message: "Choose a category" }),
  expenseDate: businessDate,
  paymentMethod,
  orderId: optionalUuid,
  attachmentKey: optionalText(255),
  notes: optionalText(1000),
});

export type ExpenseFormValues = z.input<typeof expenseSchema>;

export const correctExpenseSchema = z.object({
  expenseId: z.uuid(),
  reason: requiredText(300, "Reason").min(3),
  replacement: expenseSchema.nullable(),
});

export const openCashSchema = z.object({
  businessDate,
  openingBalance: moneyInput(),
  notes: optionalText(300),
});

export const closeCashSchema = z.object({
  sessionId: z.uuid(),
  actualClosing: moneyInput(),
  explanation: optionalText(500),
});
