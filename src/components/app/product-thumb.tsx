import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProductThumb({ imageKey, name, className }: { imageKey: string | null; name: string; className?: string }) {
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted/60", className)}>
      {imageKey ? (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated, pre-compressed file route
        <img src={`/api/files/${imageKey}`} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <Package className="size-4 text-muted-foreground" aria-hidden />
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}
