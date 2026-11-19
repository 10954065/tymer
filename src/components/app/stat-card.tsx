import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: "default" | "positive" | "negative" | "warning";
  className?: string;
}

const toneRing: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "bg-accent text-accent-foreground",
  positive: "bg-success/12 text-success",
  negative: "bg-destructive/10 text-destructive",
  warning: "bg-warning/20 text-warning-foreground dark:text-warning",
};

export function StatCard({ label, value, hint, icon: Icon, tone = "default", className }: StatCardProps) {
  return (
    <div className={cn("surface-elevated rounded-xl border bg-card p-4 sm:p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.78rem] font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", toneRing[tone])}>
            <Icon className="size-4" aria-hidden />
          </span>
        )}
      </div>
      <div className="mt-2 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
