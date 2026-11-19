"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate } from "@/lib/dates";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import type { DailyPoint } from "@/server/services/reports/financials";

interface TooltipPayload {
  dataKey: string;
  value: number;
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload?.length || !label) return null;
  const revenue = payload.find((p) => p.dataKey === "revenue")?.value ?? 0;
  const profit = payload.find((p) => p.dataKey === "grossProfit")?.value ?? 0;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{formatDate(label)}</p>
      <p className="tabular-nums"><span className="mr-2 inline-block size-2 rounded-full bg-chart-1" />Revenue {formatMoney(revenue)}</p>
      <p className="tabular-nums"><span className="mr-2 inline-block size-2 rounded-full bg-chart-2" />Gross profit {formatMoney(profit)}</p>
    </div>
  );
}

export function TrendChart({ data }: { data: DailyPoint[] }) {
  const hasData = data.some((d) => d.revenue !== 0 || d.grossProfit !== 0);
  if (!hasData) {
    return (
      <div className="grid h-64 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">
        Revenue and profit will chart here once sales are recorded.
      </div>
    );
  }
  return (
    <div className="h-64 w-full" role="img" aria-label="Daily revenue and gross profit for the last 30 days">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="fillProfit" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={(value: string) => formatDate(value).slice(0, 5)}
            fontSize={11}
            stroke="var(--muted-foreground)"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(value: number) => formatMoneyCompact(value)}
            fontSize={11}
            stroke="var(--muted-foreground)"
          />
          <Tooltip content={<ChartTooltip />} />
          <Area type="monotone" dataKey="revenue" stroke="var(--chart-1)" strokeWidth={2} fill="url(#fillRevenue)" />
          <Area type="monotone" dataKey="grossProfit" stroke="var(--chart-2)" strokeWidth={2} fill="url(#fillProfit)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
