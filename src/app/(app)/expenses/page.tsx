import type { Metadata } from "next";
import { Paperclip, Receipt } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { buildHref, PaginationLinks } from "@/components/app/pagination-links";
import { PeriodPicker } from "@/components/app/period-picker";
import { StatCard } from "@/components/app/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, resolvePeriod, todayBusinessDate, type PeriodKey } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { pageParam, PAYMENT_METHOD_LABELS } from "@/lib/validation/common";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listExpenseCategories, listExpenses } from "@/server/services/expenses";
import { listOrders } from "@/server/services/orders";
import { CorrectExpenseButton, NewExpenseDialog } from "./expense-dialogs";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  const session = await requirePagePermission("expenses:view");
  const params = await searchParams;
  const period = (["today", "week", "month", "year", "custom"].find((p) => p === params.period) ?? "month") as PeriodKey;
  const range = resolvePeriod(period, params.from as string | undefined, params.to as string | undefined);
  const page = pageParam.parse(params.page);
  const db = getDb();
  const canManage = can(session.user.role, "expenses:manage");
  const [result, categories, openOrders] = await Promise.all([
    listExpenses(db, { range, page }),
    listExpenseCategories(db),
    canManage ? listOrders(db, { status: "OPEN", pageSize: 100 }) : Promise.resolve({ items: [] }),
  ]);

  return (
    <>
      <PageHeader eyebrow="Money" title="Expenses" description="Running costs of the shop. Corrections are made with reversals so the history is never lost."
        actions={canManage && <NewExpenseDialog categories={categories} orders={openOrders.items.map((o) => ({ id: o.id, label: `${o.orderNumber} · ${o.title}` }))} today={todayBusinessDate()} />} />
      <div className="mb-4"><PeriodPicker basePath="/expenses" period={period} from={range.from} to={range.to} /></div>
      <div className="mb-6 grid gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))_1.4fr]">
        <StatCard label="Operating expenses" value={<Money value={result.operating} />} icon={Receipt} hint={`${formatDate(range.from)} – ${formatDate(range.to)}`} />
        <StatCard label="Direct order costs" value={<Money value={result.direct} />} hint="Counted in order profitability (COGS)" />
        <Card className="gap-2 py-4">
          <CardHeader><CardTitle className="text-sm">By category</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {result.byCategory.length === 0 ? <p className="text-muted-foreground">Nothing yet.</p> : result.byCategory.slice(0, 6).map((c) => (
              <div key={c.name} className="flex justify-between"><span>{c.name}</span><Money value={c.amount} /></div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card className="surface-elevated overflow-hidden py-0">
        {result.items.length === 0 ? <EmptyState icon={Receipt} title="No expenses in this period" className="m-4 border-none" /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="pl-5">Expense</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="hidden md:table-cell">Paid with</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="pr-5 text-right"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((e) => (
                  <TableRow key={e.id} className={e.isCorrected || e.reversalOfId ? "text-muted-foreground" : undefined}>
                    <TableCell className="pl-5">
                      <span className="font-medium">{e.description}</span>
                      {e.attachmentKey && <Link href={`/api/files/${e.attachmentKey}`} target="_blank" className="ml-1 inline-flex align-middle" aria-label="View receipt"><Paperclip className="size-3.5" /></Link>}
                      {e.isCorrected && <Badge variant="outline" className="ml-2">Reversed</Badge>}
                      <span className="block text-xs text-muted-foreground">{e.expenseNumber} · {formatDate(e.expenseDate)} · {e.createdByName}{e.orderNumber ? ` · ${e.orderNumber}` : ""}</span>
                    </TableCell>
                    <TableCell className="text-sm">{e.categoryName}</TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{PAYMENT_METHOD_LABELS[e.paymentMethod]}</TableCell>
                    <TableCell className="text-right"><Money value={e.amount} /></TableCell>
                    <TableCell className="pr-5 text-right">{canManage && !e.isCorrected && !e.reversalOfId && <CorrectExpenseButton expenseId={e.id} />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      <PaginationLinks page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={(n) => buildHref("/expenses", { period, from: range.from, to: range.to, page: n })} />
    </>
  );
}
