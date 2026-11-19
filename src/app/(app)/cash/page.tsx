import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, todayBusinessDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { expectedClosing, getCashMovements, getCashSession, listCashSessions, suggestedOpening } from "@/server/services/cash";
import { CloseCashForm, OpenCashForm } from "./cash-forms";

export const metadata: Metadata = { title: "Cash reconciliation" };

export default async function CashPage() {
  const session = await requirePagePermission("cash:view");
  const today = todayBusinessDate();
  const db = getDb();
  const [current, movements, history, suggested] = await Promise.all([getCashSession(db, today), getCashMovements(db, today), listCashSessions(db), suggestedOpening(db, today)]);
  const canManage = can(session.user.role, "cash:manage");
  const expected = current ? expectedClosing(current.openingBalance, movements) : null;

  return (
    <>
      <PageHeader eyebrow="Money" title="Cash reconciliation" description={`Daily cash drawer for ${formatDate(today)}. Only cash movements count; mobile money, card and bank go straight to their accounts.`} />
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card className="surface-elevated">
          <CardHeader>
            <CardTitle>Today&apos;s drawer {current && <Badge variant="outline" className="ml-2">{current.status === "OPEN" ? "Open" : "Closed"}</Badge>}</CardTitle>
            <CardDescription>{current ? `Opened by ${current.openedByName} at ${formatDateTime(current.openedAt)}` : "Count the float and open the drawer to start the day."}</CardDescription>
          </CardHeader>
          <CardContent>
            {!current && (canManage ? <OpenCashForm businessDate={today} suggested={suggested} /> : <p className="text-sm text-muted-foreground">Not opened yet.</p>)}
            {current && (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Opening balance</dt><dd><Money value={current.openingBalance} /></dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">+ Cash received</dt><dd><Money value={current.cashReceived ?? movements.cashReceived} /></dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">− Cash refunds</dt><dd><Money value={current.cashRefunds ?? movements.cashRefunds} /></dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">− Cash expenses</dt><dd><Money value={current.cashExpenses ?? movements.cashExpenses} /></dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">− Cash paid to suppliers</dt><dd><Money value={current.cashSupplierPayments ?? movements.cashSupplierPayments} /></dd></div>
                <div className="flex justify-between border-t pt-2 font-semibold"><dt>Expected in drawer</dt><dd><Money value={current.expectedClosing ?? expected ?? 0} /></dd></div>
                {current.status === "CLOSED" && (
                  <>
                    <div className="flex justify-between"><dt>Counted</dt><dd><Money value={current.actualClosing ?? 0} /></dd></div>
                    <div className="flex justify-between font-semibold"><dt>Difference</dt><dd><Money value={current.difference ?? 0} signed /></dd></div>
                    {current.explanation && <p className="text-muted-foreground">“{current.explanation}”</p>}
                  </>
                )}
              </dl>
            )}
          </CardContent>
        </Card>
        {current?.status === "OPEN" && canManage && expected !== null && (
          <Card className="surface-elevated">
            <CardHeader><CardTitle>Close the day</CardTitle><CardDescription>Count the notes and coins, then record the total. Shortages and excesses need an explanation.</CardDescription></CardHeader>
            <CardContent><CloseCashForm sessionId={current.id} expected={expected} /></CardContent>
          </Card>
        )}
      </div>
      <h2 className="mb-3 text-lg font-semibold">History</h2>
      <Card className="surface-elevated overflow-hidden py-0">
        {history.length === 0 ? <EmptyState icon={Wallet} title="No reconciliations yet" className="m-4 border-none" /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="pl-5">Day</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                  <TableHead className="hidden pr-5 md:table-cell">Staff / note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="pl-5">{formatDate(h.businessDate)} {h.status === "OPEN" && <Badge variant="outline">Open</Badge>}</TableCell>
                    <TableCell className="text-right"><Money value={h.openingBalance} /></TableCell>
                    <TableCell className="text-right">{h.expectedClosing === null ? "—" : <Money value={h.expectedClosing} />}</TableCell>
                    <TableCell className="text-right">{h.actualClosing === null ? "—" : <Money value={h.actualClosing} />}</TableCell>
                    <TableCell className="text-right">{h.difference === null ? "—" : <Money value={h.difference} signed />}</TableCell>
                    <TableCell className="hidden max-w-64 truncate pr-5 text-sm text-muted-foreground md:table-cell">{h.closedByName ?? h.openedByName}{h.explanation ? ` · ${h.explanation}` : ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
