import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

interface MoneyProps {
  value: number;
  className?: string;
  /** Colour positive values green and negative values red (for profit/loss figures). */
  signed?: boolean;
}

export function Money({ value, className, signed = false }: MoneyProps) {
  return (
    <span
      className={cn(
        "tabular-nums",
        signed && value > 0 && "text-success",
        signed && value < 0 && "text-destructive",
        !signed && value < 0 && "text-destructive",
        className,
      )}
    >
      {formatMoney(value)}
    </span>
  );
}
