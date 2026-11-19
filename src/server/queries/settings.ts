import "server-only";
import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/server/cache";
import { getDb } from "@/server/db/client";
import { getSettings } from "@/server/services/settings";

/** Settings change rarely; cache them so every page render does not hit the database. */
export const getCachedSettings = unstable_cache(async () => getSettings(getDb()), ["business-settings"], {
  tags: [CACHE_TAGS.settings],
  revalidate: 3600,
});
