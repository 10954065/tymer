"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PeriodKey } from "@/lib/dates";
import { cn } from "@/lib/utils";

const OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
  { value: "custom", label: "Custom" },
];

interface PeriodPickerProps {
  basePath?: string;
  period?: PeriodKey;
  from: string;
  to: string;
  extra?: Record<string, string | undefined>;
}

/** Daily / weekly / monthly / yearly / custom range selector stored in the URL. */
export function PeriodPicker({ basePath, period, from, to, extra = {} }: PeriodPickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [custom, setCustom] = useState({ from, to });
  const go = (params: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...extra, ...params })) if (v) search.set(k, v);
    router.push(`${basePath ?? pathname}?${search.toString()}`);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Period">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={period === o.value}
            onClick={() => (o.value === "custom" ? go({ period: "custom", from: custom.from, to: custom.to }) : go({ period: o.value }))}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground", period === o.value && "bg-card text-foreground shadow-sm")}
          >
            {o.label}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            go({ period: "custom", from: custom.from, to: custom.to });
          }}
        >
          <Input type="date" aria-label="From" className="h-8 w-36" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          <span className="text-muted-foreground">–</span>
          <Input type="date" aria-label="To" className="h-8 w-36" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          <Button size="sm" type="submit">Apply</Button>
        </form>
      )}
    </div>
  );
}
