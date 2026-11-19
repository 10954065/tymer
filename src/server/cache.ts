import "server-only";
import { revalidateTag } from "next/cache";

/**
 * Cache tags for server-side cached reads. Every business transaction invalidates the tags it affects
 * with `expire: 0`, so financial figures are never served stale after a change.
 */
export const CACHE_TAGS = {
  settings: "settings",
  catalog: "catalog",
  dashboard: "dashboard",
  reports: "reports",
  categories: "categories",
  suppliers: "suppliers",
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

export function invalidate(...tags: CacheTag[]): void {
  for (const tag of new Set(tags)) {
    revalidateTag(tag, { expire: 0 });
  }
}

/** Tags affected by anything that changes money or stock. */
export const FINANCIAL_TAGS: CacheTag[] = [CACHE_TAGS.dashboard, CACHE_TAGS.reports];
