import { and, asc, eq, ne, sql } from "drizzle-orm";
import { AppError, notFound } from "@/lib/errors";
import type { DbClient, Tx } from "@/server/db/client";
import { categories, products } from "@/server/db/schema";
import { diffFields, recordAudit } from "./audit";
import type { Actor } from "./users";

export interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  productCount: number;
  activeProductCount: number;
}

export async function listCategories(db: DbClient): Promise<CategoryRow[]> {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      description: categories.description,
      isActive: categories.isActive,
      productCount: sql<number>`count(${products.id})::int`,
      activeProductCount: sql<number>`count(${products.id}) FILTER (WHERE ${products.status} = 'ACTIVE')::int`,
    })
    .from(categories)
    .leftJoin(products, eq(products.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.name));
}

export async function listCategoryOptions(db: DbClient) {
  return db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.name));
}

async function assertUniqueName(db: DbClient, name: string, exceptId?: string) {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(sql`lower(${categories.name})`, name.toLowerCase()), exceptId ? ne(categories.id, exceptId) : undefined))
    .limit(1);
  if (row) throw new AppError("CONFLICT", `A category called "${name}" already exists`, { fieldErrors: { name: "Already exists" } });
}

export async function createCategory(tx: Tx, actor: Actor, input: { name: string; description: string | null }) {
  await assertUniqueName(tx, input.name);
  const [created] = await tx.insert(categories).values(input).returning({ id: categories.id });
  await recordAudit(tx, { userId: actor.id, action: "category.created", entityType: "category", entityId: created.id, after: input });
  return created;
}

export async function updateCategory(
  tx: Tx,
  actor: Actor,
  input: { id: string; name: string; description: string | null; isActive: boolean },
) {
  const [current] = await tx.select().from(categories).where(eq(categories.id, input.id)).limit(1);
  if (!current) throw notFound("Category");
  await assertUniqueName(tx, input.name, input.id);
  const next = { name: input.name, description: input.description, isActive: input.isActive };
  const changes = diffFields(current as unknown as Record<string, unknown>, next);
  if (!changes) return;
  await tx.update(categories).set(next).where(eq(categories.id, input.id));
  await recordAudit(tx, { userId: actor.id, action: "category.updated", entityType: "category", entityId: input.id, ...changes });
}
