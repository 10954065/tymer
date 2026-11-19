import type { Metadata } from "next";
import { AlertTriangle, ReceiptText } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { PeriodPicker } from "@/components/app/period-picker";
import { buildHref, PaginationLinks } from "@/components/app/pagination-links";
import { SearchBox } from "@/components/app/search-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, resolvePeriod, type PeriodKey } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { pageParam, searchParam } from "@/lib/validation/common";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listSales } from "@/server/services/sales";

export const metadata: Metadata = { title: "Sales history" };

const PERIODS: PeriodKey[] = ["today", "week", "month", "year", "custom"];

export default async function SalesPage({ searchParams }: PageProps<"/sales">) {
  const session = await requirePagePermission("sales:view");
  const params = await searchParams;
  const period = (PERIODS.find((p) => p === params.period) ?? "today") as PeriodKey;
  const from = typeof params.from === "string" ? params.from : undefined;
  const to = typeof params.to === "string" ? params.to : undefined;
  const range = resolvePeriod(period, from, to);
  const q = searchParam.parse(params.q);
  const page = pageParam.parse(params.page);
  const unpaid = params.unpaid === "1";
  const result = await listSales(getDb(), { search: q, range: unpaid ? undefined : range, onlyUnpaid: unpaid, page });
  const pageTotal = result.items.filter((s) => s.status === "COMPLETED").reduce((sum, s) => sum + s.total, 0);
  const href = (o: Record<string, string | number | undefined>) => buildHref("/sales", { period, from, to, q, unpaid: unpaid ? "1" : undefined, ...o });

  return (
    <>
      <PageHeader
        eyebrow="Selling"
        title="Sales history"
        description="Every sale with its payments, returns and receipt. Voided sales stay visible for the record."
        actions={
          <>
            {can(session.user.role, "sync:review") && (
              <Button asChild variant="outline"><Link href="/sales/sync-conflicts"><AlertTriangle aria-hidden /> Offline conflicts</Link></Button>
            )}
            <Button asChild><Link href="/pos">New sale</Link></Button>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker basePath="/sales" period={unpaid ? undefined : period} from={range.from} to={range.to} extra={{ q }} />
          <Button asChild variant={unpaid ? "default" : "outline"} size="sm">
            <Link href={unpaid ? buildHref("/sales", { q }) : buildHref("/sales", { q, unpaid: "1" })}>Unpaid balances</Link>
          </Button>
        </div>
        <SearchBox placeholder="Receipt number or customer" />
      </div>
      <Card className="surface-elevated overflow-hidden py-0">
        {result.items.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No sales found" description="Try another period or search." className="m-4 border-none" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="pl-5">Receipt</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden md:table-cell">Cashier</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="pr-5 text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((s) => (
                  <TableRow key={s.id} className={s.status === "VOIDED" ? "opacity-60" : undefined}>
                    <TableCell className="pl-5">
                      <Link href={`/sales/${s.id}`} className="font-medium hover:underline">{s.saleNumber}</Link>
                      {s.status === "VOIDED" && <Badge variant="outline" className="ml-2">Voided</Badge>}
                      {s.source === "OFFLINE" && <Badge variant="secondary" className="ml-2">Offline</Badge>}
                      {s.returned > 0 && <Badge variant="outline" className="ml-2">Returns</Badge>}
                      <span className="block text-xs text-muted-foreground tabular-nums">{formatDateTime(s.createdAt)}</span>
                    </TableCell>
                    <TableCell>{s.customerName ?? <span className="text-muted-foreground">Walk-in</span>}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{s.cashierName}</TableCell>
                    <TableCell className="text-right"><Money value={s.total} className={s.status === "VOIDED" ? "line-through" : undefined} /></TableCell>
                    <TableCell className="pr-5 text-right">{s.balance > 0 ? <Money value={s.balance} className="font-semibold text-warning-foreground dark:text-warning" /> : <span className="text-muted-foreground">Paid</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Sales on this page: <Money value={pageTotal} className="font-medium text-foreground" /></p>
        <PaginationLinks page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={(n) => href({ page: n })} />
      </div>
    </>
  );
}
