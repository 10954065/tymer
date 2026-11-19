import type { Metadata } from "next";
import { ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { buildHref, PaginationLinks } from "@/components/app/pagination-links";
import { PeriodPicker } from "@/components/app/period-picker";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, resolvePeriod, type PeriodKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { pageParam, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/validation/common";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listPayments } from "@/server/services/payments";
import { getPaymentMethodTotals } from "@/server/services/reports/financials";

export const metadata: Metadata = { title: "Payments" };

const KIND: Record<string, string> = { RECEIPT: "Received", REFUND: "Refund", REVERSAL: "Reversal" };

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  await requirePagePermission("payments:view");
  const params = await searchParams;
  const period = (["today", "week", "month", "year", "custom"].find((p) => p === params.period) ?? "today") as PeriodKey;
  const range = resolvePeriod(period, params.from as string | undefined, params.to as string | undefined);
  const method = PAYMENT_METHODS.find((m) => m === params.method) as PaymentMethod | undefined;
  const page = pageParam.parse(params.page);
  const db = getDb();
  const [result, byMethod] = await Promise.all([listPayments(db, { range, method, page }), getPaymentMethodTotals(db, range)]);
  const href = (o: Record<string, string | number | undefined>) => buildHref("/payments", { period, from: range.from, to: range.to, method, ...o });

  return (
    <>
      <PageHeader eyebrow="Money" title="Payments ledger" description="Every cedi received or refunded. Entries are never edited — mistakes are corrected with reversals." />
      <div className="mb-4"><PeriodPicker basePath="/payments" period={period} from={range.from} to={range.to} extra={{ method }} /></div>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {byMethod.length === 0 && <p className="text-sm text-muted-foreground">No payments in this period.</p>}
        {byMethod.map((m) => (
          <Link key={m.method} href={href({ method: m.method === method ? undefined : m.method, page: undefined })}
            className={cn("rounded-xl border bg-card p-4 transition-colors hover:border-primary/40", m.method === method && "border-primary ring-1 ring-primary")}>
            <p className="text-xs text-muted-foreground">{PAYMENT_METHOD_LABELS[m.method as PaymentMethod]}</p>
            <p className="mt-1 text-lg font-semibold"><Money value={m.net} /></p>
            <p className="text-xs text-muted-foreground">{m.count} entries{m.refunded ? ` · ${(m.refunded / 100).toFixed(2)} refunded` : ""}</p>
          </Link>
        ))}
      </div>
      <Card className="surface-elevated overflow-hidden py-0">
        {result.items.length === 0 ? <EmptyState icon={ArrowLeftRight} title="No payments" className="m-4 border-none" /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="pl-5">Payment</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="hidden md:table-cell">By</TableHead>
                  <TableHead className="pr-5 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="pl-5"><span className="font-medium">{p.paymentNumber}</span> {p.kind !== "RECEIPT" && <Badge variant="outline">{KIND[p.kind]}</Badge>}<span className="block text-xs text-muted-foreground tabular-nums">{formatDateTime(p.receivedAt)}</span></TableCell>
                    <TableCell>
                      {p.saleId ? <Link href={`/sales/${p.saleId}`} className="hover:underline">{p.saleNumber}</Link> : <Link href={`/orders/${p.orderId}`} className="hover:underline">{p.orderNumber}</Link>}
                      <span className="block text-xs text-muted-foreground">{p.customerName ?? "Walk-in"}</span>
                    </TableCell>
                    <TableCell className="text-sm">{PAYMENT_METHOD_LABELS[p.method]}{p.externalReference && <span className="block text-xs text-muted-foreground">{p.externalReference}</span>}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{p.receivedByName}</TableCell>
                    <TableCell className="pr-5 text-right"><Money value={p.amount} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Net for filter: <Money value={result.sum} className="font-semibold text-foreground" /></p>
        <PaginationLinks page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={(n) => href({ page: n })} />
      </div>
    </>
  );
}
