import "server-only";
import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/server/cache";
import { getDb } from "@/server/db/client";
import { getDashboardData } from "@/server/services/reports/dashboard";

/**
 * Dashboard figures are cached (keyed by business date) and invalidated immediately by every sale, payment,
 * expense, order and stock change. The 5-minute fallback bounds staleness if an invalidation is ever missed.
 */
export const getCachedDashboard = unstable_cache(
  async (businessDate: string) => getDashboardData(getDb(), businessDate),
  ["dashboard-v1"],
  { tags: [CACHE_TAGS.dashboard], revalidate: 300 },
);
