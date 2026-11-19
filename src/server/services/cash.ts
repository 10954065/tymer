import { desc, eq, lt, sql } from "drizzle-orm";
import { AppError, notFound } from "@/lib/errors";
import { dayRange } from "@/lib/dates";
import type { DbClient, Tx } from "@/server/db/client";
import { cashSessions, users } from "@/server/db/schema";
import { recordAudit } from "./audit";
import type { Actor } from "./users";

export interface CashMovementSummary {
  cashReceived: number;
  /** Cash handed back to customers (refunds and reversals), as a positive number. */
  cashRefunds: number;
  cashExpenses: number;
  cashSupplierPayments: number;
}

/** Cash in and out of the drawer for one business day, from the ledgers (CASH method only). */
export async function getCashMovements(db: DbClient, businessDate: string): Promise<CashMovementSummary> {
  const { start, end } = dayRange(businessDate);
  const result = await db.execute<{ received: number; refunds: number; expenses: number; supplier: number }>(sql`
    SELECT
      (SELECT coalesce(sum(amount) FILTER (WHERE amount > 0), 0) FROM payments WHERE method = 'CASH' AND received_at >= ${start} AND received_at < ${end})::bigint AS received,
      (SELECT coalesce(-sum(amount) FILTER (WHERE amount < 0), 0) FROM payments WHERE method = 'CASH' AND received_at >= ${start} AND received_at < ${end})::bigint AS refunds,
      (SELECT coalesce(sum(amount), 0) FROM expenses WHERE payment_method = 'CASH' AND expense_date = ${businessDate}::date)::bigint AS expenses,
      (SELECT coalesce(sum(amount), 0) FROM supplier_payments WHERE method = 'CASH' AND paid_at >= ${start} AND paid_at < ${end})::bigint AS supplier`);
  const r = result.rows[0];
  return { cashReceived: r.received, cashRefunds: r.refunds, cashExpenses: r.expenses, cashSupplierPayments: r.supplier };
}

export function expectedClosing(opening: number, m: CashMovementSummary): number {
  return opening + m.cashReceived - m.cashRefunds - m.cashExpenses - m.cashSupplierPayments;
}

export async function getCashSession(db: DbClient, businessDate: string) {
  const [session] = await db
    .select({ session: cashSessions, openedByName: users.fullName })
    .from(cashSessions)
    .leftJoin(users, eq(users.id, cashSessions.openedBy))
    .where(eq(cashSessions.businessDate, businessDate));
  return session ? { ...session.session, openedByName: session.openedByName } : null;
}

/** Suggested opening float: the counted cash at the most recent earlier close. */
export async function suggestedOpening(db: DbClient, businessDate: string): Promise<number> {
  const [prev] = await db
    .select({ actual: cashSessions.actualClosing })
    .from(cashSessions)
    .where(lt(cashSessions.businessDate, businessDate))
    .orderBy(desc(cashSessions.businessDate))
    .limit(1);
  return prev?.actual ?? 0;
}

export async function openCashSession(tx: Tx, actor: Actor, input: { businessDate: string; openingBalance: number; notes: string | null }) {
  if (!Number.isInteger(input.openingBalance) || input.openingBalance < 0) throw new AppError("VALIDATION", "Opening balance cannot be negative");
  const existing = await getCashSession(tx, input.businessDate);
  if (existing) throw new AppError("CONFLICT", "The cash drawer for this day is already open");
  const [row] = await tx
    .insert(cashSessions)
    .values({ businessDate: input.businessDate, openingBalance: input.openingBalance, openingNotes: input.notes, openedBy: actor.id })
    .returning({ id: cashSessions.id });
  await recordAudit(tx, { userId: actor.id, action: "cash.opened", entityType: "cash_session", entityId: row.id, reference: input.businessDate, after: { openingBalance: input.openingBalance } });
  return row;
}

/** Counts the drawer and freezes the day's figures. A non-zero difference needs an explanation. */
export async function closeCashSession(tx: Tx, actor: Actor, input: { sessionId: string; actualClosing: number; explanation: string | null }) {
  const [session] = await tx.select().from(cashSessions).where(eq(cashSessions.id, input.sessionId)).for("update");
  if (!session) throw notFound("Cash session");
  if (session.status === "CLOSED") throw new AppError("CONFLICT", "This day is already closed");
  if (!Number.isInteger(input.actualClosing) || input.actualClosing < 0) throw new AppError("VALIDATION", "Counted cash cannot be negative");
  const movements = await getCashMovements(tx, session.businessDate);
  const expected = expectedClosing(session.openingBalance, movements);
  const difference = input.actualClosing - expected;
  if (difference !== 0 && (!input.explanation || input.explanation.trim().length < 3)) {
    throw new AppError("VALIDATION", "Explain the shortage or excess before closing", { fieldErrors: { explanation: "Required when cash does not match" } });
  }
  await tx
    .update(cashSessions)
    .set({
      status: "CLOSED",
      ...movements,
      expectedClosing: expected,
      actualClosing: input.actualClosing,
      difference,
      explanation: input.explanation,
      closedBy: actor.id,
      closedAt: new Date(),
    })
    .where(eq(cashSessions.id, session.id));
  await recordAudit(tx, {
    userId: actor.id,
    action: "cash.closed",
    entityType: "cash_session",
    entityId: session.id,
    reference: session.businessDate,
    after: { expected, actual: input.actualClosing, difference },
    reason: input.explanation,
  });
  return { expected, difference };
}

export async function listCashSessions(db: DbClient, limit = 60) {
  const closedBy = sql<string | null>`(SELECT full_name FROM users u WHERE u.id = ${cashSessions.closedBy})`;
  return db
    .select({
      id: cashSessions.id,
      businessDate: cashSessions.businessDate,
      status: cashSessions.status,
      openingBalance: cashSessions.openingBalance,
      expectedClosing: cashSessions.expectedClosing,
      actualClosing: cashSessions.actualClosing,
      difference: cashSessions.difference,
      explanation: cashSessions.explanation,
      openedByName: users.fullName,
      closedByName: closedBy,
      closedAt: cashSessions.closedAt,
    })
    .from(cashSessions)
    .leftJoin(users, eq(users.id, cashSessions.openedBy))
    .orderBy(desc(cashSessions.businessDate))
    .limit(limit);
}
