import { Badge } from "@/components/ui/badge";

const STYLES: Record<string, { label: string; className: string }> = {
  NEW: { label: "New", className: "" },
  DEPOSIT_PAID: { label: "Deposit paid", className: "border-chart-3/50 text-chart-3" },
  IN_PROGRESS: { label: "In progress", className: "border-warning/60" },
  READY: { label: "Ready", className: "border-primary/50 text-primary" },
  COMPLETED: { label: "Completed", className: "border-success/40 text-success" },
  CANCELLED: { label: "Cancelled", className: "text-muted-foreground" },
};

export function OrderStatusBadge({ status }: { status: string }) {
  const s = STYLES[status] ?? { label: status, className: "" };
  return <Badge variant="outline" className={s.className}>{s.label}</Badge>;
}
