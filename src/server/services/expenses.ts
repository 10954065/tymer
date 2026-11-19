import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { AppError, notFound } from "@/lib/errors";
import type { DateRange } from "@/lib/dates";
import type { PaymentMethod } from "@/lib/validation/common";
import type { DbClient, Tx } from "@/server/db/client";
import { expenseCategories, expenses, orders, users } from "@/server/db/schema";
import { diffFields, recordAudit } from "./audit";
import type { Actor } from "./users";

export interface ExpenseInput {
  description: string;
  amount: number;
  categoryId: string;
  expenseDate: string;
  paymentMethod: PaymentMethod;
  orderId: string | null;
  attachmentKey: string | null;
  notes: string | null;
}

export async function listExpenseCategories(db: DbClient) {
  return db.select({ id: expenseCategories.id, name: expenseCategories.name }).from(expenseCategories).where(eq(expenseCategories.isActive, true)).orderBy(asc(expenseCategories.name));
}

export async function createExpenseCategory(tx: Tx, actor: Actor, name: string) {
  const [existing] = await tx.select({ id: expenseCategories.id }).from(expenseCategories).where(eq(sql`lower(${expenseCategories.name})`, name.toLowerCase()));
  if (existing) throw new AppError("CONFLICT", "That category already exists");
  const [row] = await tx.insert(expenseCategories).values({ name }).returning({ id: expenseCategories.id });
  await recordAudit(tx, { userId: actor.id, action: "expense_category.created", entityType: "expense_category", entityId: row.id, after: { name } });
  return row;
}

async function assertOrderOpenForCosts(tx: Tx, orderId: string | null) {
  if (!orderId) return;
  const [order] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
  if (!order) throw notFound("Order");
}

export async function createExpense(tx: Tx, actor: Actor, input: ExpenseInput): Promise<{ id: string; expenseNumber: string }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("VALIDATION", "Amount must be greater than zero");
  await assertOrderOpenForCosts(tx, input.orderId);
  const [row] = await tx.insert(expenses).values({ ...input, createdBy: actor.id }).returning({ id: expenses.id, expenseNumber: expenses.expenseNumber });
  await recordAudit(tx, {
    userId: actor.id,
    action: "expense.created",
    entityType: "expense",
    entityId: row.id,
    reference: row.expenseNumber,
    after: { amount: input.amount, date: input.expenseDate, method: input.paymentMethod, orderId: input.orderId },
  });
  return row;
}

/**
 * Corrects an expense without editing it: posts an equal negative reversal on the same date (so the original period
 * nets to zero) and, optionally, a replacement expense with the right values.
 */
export async function correctExpense(
  tx: Tx,
  actor: Actor,
  input: { expenseId: string; reason: string; replacement: ExpenseInput | null },
): Promise<{ reversalId: string; replacementId: string | null }> {
  const [original] = await tx.select().from(expenses).where(eq(expenses.id, input.expenseId)).for("update");
  if (!original) throw notFound("Expense");
  if (original.reversalOfId) throw new AppError("VALIDATION", "A reversal entry cannot itself be corrected");
  const [already] = await tx.select({ id: expenses.id }).from(expenses).where(eq(expenses.reversalOfId, original.id));
  if (already) throw new AppError("CONFLICT", "This expense has already been corrected");
  const [reversal] = await tx
    .insert(expenses)
    .values({
      description: `Reversal of ${original.expenseNumber}: ${original.description}`.slice(0, 200),
      amount: -original.amount,
      categoryId: original.categoryId,
      expenseDate: original.expenseDate,
      paymentMethod: original.paymentMethod,
      orderId: original.orderId,
      reversalOfId: original.id,
      notes: input.reason,
      createdBy: actor.id,
    })
    .returning({ id: expenses.id });
  const replacement = input.replacement ? await createExpense(tx, actor, input.replacement) : null;
  await recordAudit(tx, {
    userId: actor.id,
    action: "expense.corrected",
    entityType: "expense",
    entityId: original.id,
    reference: original.expenseNumber,
    reason: input.reason,
    before: { amount: original.amount, date: original.expenseDate, method: original.paymentMethod },
    after: replacement && input.replacement ? { amount: input.replacement.amount, date: input.replacement.expenseDate, replacement: replacement.expenseNumber } : { amount: 0 },
  });
  return { reversalId: reversal.id, replacementId: replacement?.id ?? null };
}

/** Non-financial details (description, category, notes, attachment) may be edited with an audit trail. */
export async function updateExpenseDetails(
  tx: Tx,
  actor: Actor,
  id: string,
  input: { description: string; categoryId: string; notes: string | null; attachmentKey: string | null },
): Promise<void> {
  const [current] = await tx.select().from(expenses).where(eq(expenses.id, id));
  if (!current) throw notFound("Expense");
  const changes = diffFields(current as unknown as Record<string, unknown>, input);
  if (!changes) return;
  await tx.update(expenses).set(input).where(eq(expenses.id, id));
  await recordAudit(tx, { userId: actor.id, action: "expense.details_updated", entityType: "expense", entityId: id, reference: current.expenseNumber, ...changes });
}

export interface ExpenseRow {
  id: string;
  expenseNumber: string;
  description: string;
  amount: number;
  categoryId: string;
  categoryName: string;
  expenseDate: string;
  paymentMethod: PaymentMethod;
  orderId: string | null;
  orderNumber: string | null;
  reversalOfId: string | null;
  isCorrected: boolean;
  attachmentKey: string | null;
  notes: string | null;
  createdByName: string | null;
}

export async function listExpenses(
  db: DbClient,
  options: { range: DateRange; categoryId?: string; page?: number; pageSize?: number },
): Promise<{ items: ExpenseRow[]; total: number; page: number; pageSize: number; operating: number; direct: number; byCategory: { name: string; amount: number }[] }> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 5), 200);
  const page = Math.max(options.page ?? 1, 1);
  const where = and(
    gte(expenses.expenseDate, options.range.from),
    lte(expenses.expenseDate, options.range.to),
    options.categoryId ? eq(expenses.categoryId, options.categoryId) : undefined,
  );
  const corrected = sql<boolean>`exists (SELECT 1 FROM expenses r WHERE r.reversal_of_id = ${expenses.id})`;
  const [items, [agg], byCategory] = await Promise.all([
    db
      .select({
        id: expenses.id,
        expenseNumber: expenses.expenseNumber,
        description: expenses.description,
        amount: expenses.amount,
        categoryId: expenses.categoryId,
        categoryName: expenseCategories.name,
        expenseDate: expenses.expenseDate,
        paymentMethod: expenses.paymentMethod,
        orderId: expenses.orderId,
        orderNumber: orders.orderNumber,
        reversalOfId: expenses.reversalOfId,
        isCorrected: corrected,
        attachmentKey: expenses.attachmentKey,
        notes: expenses.notes,
        createdByName: users.fullName,
      })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .leftJoin(orders, eq(orders.id, expenses.orderId))
      .leftJoin(users, eq(users.id, expenses.createdBy))
      .where(where)
      .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({
        n: sql<number>`count(*)::int`,
        operating: sql<number>`coalesce(sum(${expenses.amount}) FILTER (WHERE ${expenses.orderId} IS NULL), 0)::bigint`,
        direct: sql<number>`coalesce(sum(${expenses.amount}) FILTER (WHERE ${expenses.orderId} IS NOT NULL), 0)::bigint`,
      })
      .from(expenses)
      .where(where),
    db
      .select({ name: expenseCategories.name, amount: sql<number>`sum(${expenses.amount})::bigint` })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(where)
      .groupBy(expenseCategories.name)
      .orderBy(desc(sql`sum(${expenses.amount})`)),
  ]);
  return { items, total: agg?.n ?? 0, page, pageSize, operating: agg?.operating ?? 0, direct: agg?.direct ?? 0, byCategory: byCategory.filter((c) => c.amount !== 0) };
}
