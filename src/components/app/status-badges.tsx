import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const PRODUCT_STATUS: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: "Active", className: "border-success/40 text-success" },
  OUT_OF_STOCK: { label: "Out of stock", className: "border-destructive/40 text-destructive" },
  ARCHIVED: { label: "Archived", className: "border-border text-muted-foreground" },
  DISCONTINUED: { label: "Discontinued", className: "border-border text-muted-foreground line-through" },
};

export function ProductStatusBadge({ status }: { status: string }) {
  const meta = PRODUCT_STATUS[status] ?? { label: status, className: "" };
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  );
}

export const MOVEMENT_LABELS: Record<string, string> = {
  INITIAL_STOCK: "Opening stock",
  PURCHASE: "Purchase / restock",
  SALE: "Sale",
  CUSTOMER_RETURN: "Customer return",
  DAMAGE: "Damage",
  LOSS: "Loss",
  MANUAL_ADJUSTMENT: "Manual adjustment",
  REVERSAL: "Reversal",
};

export function MovementBadge({ type }: { type: string }) {
  const tone =
    type === "SALE" || type === "DAMAGE" || type === "LOSS"
      ? "bg-destructive/8 text-destructive"
      : type === "PURCHASE" || type === "INITIAL_STOCK" || type === "CUSTOMER_RETURN"
        ? "bg-success/10 text-success"
        : "bg-muted text-muted-foreground";
  return <span className={cn("inline-flex rounded-md px-2 py-0.5 text-xs font-medium", tone)}>{MOVEMENT_LABELS[type] ?? type}</span>;
}

export function QuantityChange({ value }: { value: number }) {
  return (
    <span className={cn("font-medium tabular-nums", value > 0 ? "text-success" : "text-destructive")}>
      {value > 0 ? `+${value}` : value}
    </span>
  );
}
