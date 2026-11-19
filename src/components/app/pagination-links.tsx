import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface PaginationLinksProps {
  page: number;
  pageSize: number;
  total: number;
  /** Builds the href for a page while preserving current filters. */
  hrefFor: (page: number) => string;
}

export function PaginationLinks({ page, pageSize, total, hrefFor }: PaginationLinksProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 px-1 py-3 text-sm text-muted-foreground">
      <span className="tabular-nums">
        {from}–{to} of {total.toLocaleString("en-GH")}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefFor(page - 1)} aria-label="Previous page">
              <ChevronLeft aria-hidden /> Previous
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeft aria-hidden /> Previous
          </Button>
        )}
        {page < pages ? (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefFor(page + 1)} aria-label="Next page">
              Next <ChevronRight aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next <ChevronRight aria-hidden />
          </Button>
        )}
      </div>
    </nav>
  );
}

/** Builds a URL with updated query parameters, dropping empty values. */
export function buildHref(pathname: string, params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}
