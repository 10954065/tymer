import type { Metadata } from "next";
import Link from "next/link";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { PeriodPicker } from "@/components/app/period-picker";
import { StatCard } from "@/components/app/stat-card";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { resolvePeriod, type PeriodKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { requirePagePermission } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { formatCell } from "@/server/services/reports/export";
import { getDailyTrend, getFinancialSummary } from "@/server/services/reports/financials";
import { buildReportTable, REPORTS, type ReportKey, type ReportRow } from "@/server/services/reports/tables";
import { TrendChart } from "../dashboard/trend-chart";
import { ExportButtons } from "./export-buttons";

export const metadata: Metadata = { title: "Financial reports" };

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  await requirePagePermission("reports:view");
  const params = await searchParams;
  const report = ((params.report as string) in REPORTS ? params.report : "profit-loss") as ReportKey;
  const period = (["today", "week", "month", "year", "custom"].find((p) => p === params.period) ?? "month") as PeriodKey;
  const range = resolvePeriod(period, params.from as string | undefined, params.to as string | undefined);
  const bucket = (["day", "week", "month"].find((b) => b === params.bucket) ?? "day") as "day" | "week" | "month";
  const db = getDb();
  const [table, summary, trend] = await Promise.all([
    buildReportTable(db, report, range, bucket),
    getFinancialSummary(db, range),
    report === "sales" || report === "profit-loss" ? getDailyTrend(db, range) : Promise.resolve([]),
  ]);
  const qs = (o: Record<string, string>) => new URLSearchParams({ report, period, from: range.from, to: range.to, bucket, ...o }).toString();
  const exportQuery = `/api/exports/${report}?${new URLSearchParams({ period, from: range.from, to: range.to, bucket }).toString()}`;
  const isMoney = (key: string) => table.columns.find((c) => c.key === key)?.type === "money";
  const rowClass = (row: ReportRow) => (report === "profit-loss" && ["Net revenue", "Gross profit", "Net operating profit"].includes(String(row.line)) ? "bg-muted/40 font-semibold" : undefined);

  return (
    <>
      <PageHeader eyebrow="Money" title="Financial reports" description="All figures come from recorded sales, returns, orders, payments and expenses. Stock purchases are not expenses; cost of goods is recognised when goods are sold." actions={<ExportButtons query={exportQuery} />} />
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <PeriodPicker basePath="/reports" period={period} from={range.from} to={range.to} extra={{ report, bucket }} />
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Net revenue" value={<Money value={summary.netRevenue} />} hint={`${summary.salesCount} sales · ${summary.ordersCompleted} orders`} />
        <StatCard label="Cost of goods sold" value={<Money value={summary.cogs} />} />
        <StatCard label="Gross profit" value={<Money value={summary.grossProfit} signed />} hint={`${(summary.grossMarginBps / 100).toFixed(1)}% margin`} />
        <StatCard label="Operating expenses" value={<Money value={summary.operatingExpenses} />} />
        <StatCard label="Net operating profit" value={<Money value={summary.netOperatingProfit} signed />} tone={summary.netOperatingProfit < 0 ? "negative" : "positive"} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Reports" className="no-print flex gap-1 overflow-x-auto lg:flex-col">
          {(Object.keys(REPORTS) as ReportKey[]).map((key) => (
            <Link key={key} href={`/reports?${qs({ report: key })}`} aria-current={key === report ? "page" : undefined}
              className={cn("shrink-0 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground", key === report && "bg-accent font-medium text-accent-foreground")}>
              {REPORTS[key]}
            </Link>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div><h2 className="text-xl font-semibold">{table.title}</h2><p className="text-sm text-muted-foreground">{table.subtitle}</p></div>
            {report === "sales" && (
              <div className="no-print flex gap-1 rounded-lg bg-muted p-1 text-sm">
                {(["day", "week", "month"] as const).map((b) => (
                  <Link key={b} href={`/reports?${qs({ bucket: b })}`} className={cn("rounded-md px-3 py-1 text-muted-foreground", bucket === b && "bg-card text-foreground shadow-sm")}>{b === "day" ? "Daily" : b === "week" ? "Weekly" : "Monthly"}</Link>
                ))}
              </div>
            )}
          </div>
          {trend.length > 1 && <Card className="surface-elevated p-4"><TrendChart data={trend} /></Card>}
          <Card className="surface-elevated overflow-hidden py-0">
            {table.rows.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No data for this period.</p> : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      {table.columns.map((c) => <TableHead key={c.key} className={cn("first:pl-5 last:pr-5", c.type !== "text" && c.type !== "date" && "text-right")}>{c.label}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {table.rows.map((row, i) => (
                      <TableRow key={i} className={rowClass(row)}>
                        {table.columns.map((c) => (
                          <TableCell key={c.key} className={cn("tabular-nums first:pl-5 last:pr-5", c.type !== "text" && c.type !== "date" && "text-right", isMoney(c.key) && Number(row[c.key]) < 0 && "text-destructive")}>
                            {formatCell(c, row[c.key]) || "—"}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                  {table.totals && (
                    <TableFooter>
                      <TableRow>
                        {table.columns.map((c, i) => (
                          <TableCell key={c.key} className={cn("font-semibold tabular-nums first:pl-5 last:pr-5", c.type !== "text" && c.type !== "date" && "text-right")}>
                            {i === 0 ? "Total" : formatCell(c, table.totals?.[c.key])}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
