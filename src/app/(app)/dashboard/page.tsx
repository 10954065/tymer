import type { Metadata } from "next";
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  HandCoins,
  Landmark,
  Receipt,
  ShoppingBag,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatTime, todayBusinessDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requirePagePermission } from "@/server/auth/current-user";
import { getCachedDashboard } from "@/server/queries/dashboard";
import type { DashboardData } from "@/server/services/reports/dashboard";
import { TrendChart } from "./trend-chart";

export const metadata: Metadata = { title: "Dashboard" };

function percent(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

function TodayHero({ today }: { today: DashboardData["today"] }) {
  return (
    <div className="texture-grain relative overflow-hidden rounded-2xl bg-[oklch(0.32_0.065_163)] p-6 text-[oklch(0.97_0.015_160)] shadow-lg sm:p-7 dark:bg-[oklch(0.28_0.05_163)]">
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-[oklch(0.45_0.09_163)] opacity-50 blur-3xl" />
      <p className="relative text-xs font-semibold tracking-[0.16em] uppercase opacity-75">Today&apos;s revenue</p>
      <p className="relative mt-2 font-heading text-4xl font-semibold tabular-nums sm:text-5xl">{formatMoney(today.netRevenue)}</p>
      <dl className="relative mt-6 grid grid-cols-3 gap-4 border-t border-white/15 pt-5 text-sm">
        <div>
          <dt className="opacity-70">Collected</dt>
          <dd className="mt-1 font-semibold tabular-nums">{formatMoney(today.cashCollected)}</dd>
        </div>
        <div>
          <dt className="opacity-70">Gross profit</dt>
          <dd className="mt-1 font-semibold tabular-nums">{formatMoney(today.grossProfit)}</dd>
        </div>
        <div>
          <dt className="opacity-70">Sales</dt>
          <dd className="mt-1 font-semibold tabular-nums">{today.salesCount}</dd>
        </div>
      </dl>
    </div>
  );
}

function LowStockCard({ items }: { items: DashboardData["lowStock"] }) {
  return (
    <Card className="surface-elevated">
      <CardHeader>
        <CardTitle className="text-base">Low stock</CardTitle>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href="/inventory?filter=low">View all</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Everything is above its reorder level.</p>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link href={`/products/${item.id}`} className="min-w-0 truncate hover:underline">
                  {item.name} <span className="text-xs text-muted-foreground">{item.sku}</span>
                </Link>
                <Badge variant={item.quantity <= 0 ? "destructive" : "outline"} className="tabular-nums">
                  {item.quantity} left
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecentSalesCard({ sales }: { sales: DashboardData["recentSales"] }) {
  return (
    <Card className="surface-elevated">
      <CardHeader>
        <CardTitle className="text-base">Recent sales</CardTitle>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href="/sales">History</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {sales.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sales yet. Your first sale will appear here.</p>
        ) : (
          <ul className="divide-y">
            {sales.map((sale) => (
              <li key={sale.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link href={`/sales/${sale.id}`} className="min-w-0 hover:underline">
                  <span className="font-medium">{sale.saleNumber}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {formatDate(sale.createdAt)} {formatTime(sale.createdAt)} · {sale.customerName ?? "Walk-in"}
                  </span>
                </Link>
                <span className={sale.status === "VOIDED" ? "text-muted-foreground line-through" : "font-medium"}>
                  <Money value={sale.total} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const session = await requirePagePermission("dashboard:view");
  const data = await getCachedDashboard(todayBusinessDate());
  const { today, month, receivables, inventory } = data;
  const firstName = session.user.fullName.split(" ")[0];

  return (
    <>
      <PageHeader
        eyebrow={formatDate(data.businessDate)}
        title={`Welcome back, ${firstName}`}
        description="Live figures from today's sales, payments, orders and expenses."
        actions={
          <Button asChild>
            <Link href="/pos">
              <ShoppingBag aria-hidden /> New sale
            </Link>
          </Button>
        }
      />

      <section aria-label="Today" className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <TodayHero today={today} />
        <div className="grid grid-cols-2 gap-4">
          <StatCard label="Outstanding receivables" value={<Money value={receivables.total} />} icon={HandCoins}
            hint={`${receivables.salesCount + receivables.completedOrdersCount} unpaid balance(s)`}
            tone={receivables.total > 0 ? "warning" : "default"} />
          <StatCard label="Inventory value (cost)" value={<Money value={inventory.value} />} icon={Boxes}
            hint={`${inventory.units.toLocaleString("en-GH")} units in stock`} />
          <StatCard label="Sales this month" value={month.salesCount.toLocaleString("en-GH")} icon={Receipt}
            hint={`${month.ordersCompleted} order(s) completed`} />
          <StatCard label="Low-stock products" value={data.lowStockCount} icon={AlertTriangle}
            tone={data.lowStockCount > 0 ? "warning" : "default"} hint="At or below reorder level" />
        </div>
      </section>

      <section aria-label="This month" className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">This month</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Revenue" value={<Money value={month.netRevenue} />} icon={TrendingUp}
            hint={month.returns > 0 ? `After ${formatMoney(month.returns)} in returns` : "Sales and completed orders"} />
          <StatCard label="Gross profit" value={<Money value={month.grossProfit} signed />} icon={Landmark}
            hint={`${percent(month.grossMarginBps)} gross margin`} tone={month.grossProfit < 0 ? "negative" : "positive"} />
          <StatCard label="Operating expenses" value={<Money value={month.operatingExpenses} />} icon={Wallet}
            hint="Stock purchases are not expenses" />
          <StatCard label="Net operating profit" value={<Money value={month.netOperatingProfit} signed />} icon={ArrowUpRight}
            tone={month.netOperatingProfit < 0 ? "negative" : "positive"} hint="Gross profit − operating expenses" />
        </div>
      </section>

      <section className="mt-8 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card className="surface-elevated">
          <CardHeader>
            <CardTitle className="text-base">Last 30 days</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart data={data.trend} />
          </CardContent>
        </Card>
        <div className="grid gap-4">
          <LowStockCard items={data.lowStock} />
          <RecentSalesCard sales={data.recentSales} />
        </div>
      </section>
    </>
  );
}
