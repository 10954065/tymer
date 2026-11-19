import "server-only";
import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/server/cache";
import { getDb } from "@/server/db/client";
import { listCategoryOptions } from "@/server/services/categories";
import { getPosCatalog } from "@/server/services/products";

/** POS catalogue: one cached query shared by every till; invalidated by any stock or price change. */
export const getCachedCatalog = unstable_cache(async () => getPosCatalog(getDb()), ["pos-catalog-v1"], {
  tags: [CACHE_TAGS.catalog],
  revalidate: 600,
});

export const getCachedCategories = unstable_cache(async () => listCategoryOptions(getDb()), ["category-options-v1"], {
  tags: [CACHE_TAGS.categories],
  revalidate: 3600,
});
