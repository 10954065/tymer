import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createProductSchema } from "@/lib/validation/products";
import { closeDb, getDb } from "@/server/db/client";
import { auditLogs, productPriceChanges } from "@/server/db/schema";
import { createCategory, listCategories, updateCategory } from "@/server/services/categories";
import { createProduct, getPriceHistory, getProduct, listProducts, updateProduct } from "@/server/services/products";
import { actor, createTestUser } from "../support/factories";
import { resetDatabase } from "../support/db";

const db = () => getDb();

const base = {
  barcode: null,
  categoryId: null,
  supplierId: null,
  description: null,
  costPrice: 1000,
  sellingPrice: 2000,
  reorderThreshold: 3,
  imageKey: null,
};

describe("products and categories", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("validates product form input and converts prices to pesewas", () => {
    const parsed = createProductSchema.parse({
      name: "Throw pillow",
      sku: "",
      barcode: "",
      categoryId: "",
      supplierId: "",
      costPrice: "45.50",
      sellingPrice: "80",
      reorderThreshold: "4",
      initialStock: "12",
    });
    expect(parsed).toMatchObject({ sku: null, barcode: null, categoryId: null, costPrice: 4550, sellingPrice: 8000, initialStock: 12 });
    expect(createProductSchema.safeParse({ ...parsed, costPrice: "12.345" }).success).toBe(false);
  });

  it("generates a SKU when none is given and enforces uniqueness", async () => {
    const owner = await createTestUser();
    const created = await db().transaction((tx) => createProduct(tx, actor(owner), { ...base, name: "Rattan basket", sku: null, initialStock: 0 }));
    expect(created.sku).toMatch(/^RAT-\d+$/);
    await expect(
      db().transaction((tx) => createProduct(tx, actor(owner), { ...base, name: "Other", sku: created.sku.toLowerCase(), initialStock: 0 })),
    ).rejects.toThrow(/already used/);
  });

  it("records price changes in history and audit, leaving stock untouched", async () => {
    const owner = await createTestUser();
    const { id } = await db().transaction((tx) => createProduct(tx, actor(owner), { ...base, name: "Lamp", sku: "LMP-1", initialStock: 4 }));
    await db().transaction((tx) =>
      updateProduct(tx, actor(owner), id, { ...base, name: "Brass lamp", sku: "LMP-1", sellingPrice: 2500, priceChangeReason: "Supplier increase" }),
    );
    const product = await getProduct(db(), id);
    expect(product).toMatchObject({ name: "Brass lamp", sellingPrice: 2500, quantity: 4 });
    const history = await getPriceHistory(db(), id);
    expect(history[0]).toMatchObject({ oldSellingPrice: 2000, newSellingPrice: 2500, reason: "Supplier increase" });
    const [audit] = await db().select().from(auditLogs).where(eq(auditLogs.action, "product.updated"));
    expect(audit.after).toEqual({ name: "Brass lamp", sellingPrice: 2500 });
  });

  it("does nothing when an update has no changes", async () => {
    const owner = await createTestUser();
    const { id } = await db().transaction((tx) => createProduct(tx, actor(owner), { ...base, name: "Lamp", sku: "LMP-2", initialStock: 1 }));
    await db().transaction((tx) => updateProduct(tx, actor(owner), id, { ...base, name: "Lamp", sku: "LMP-2" }));
    expect(await db().select().from(productPriceChanges)).toHaveLength(0);
  });

  it("lists, searches and filters products with pagination", async () => {
    const owner = await createTestUser();
    await db().transaction(async (tx) => {
      await createProduct(tx, actor(owner), { ...base, name: "Velvet cushion", sku: "CUS-1", initialStock: 10 });
      await createProduct(tx, actor(owner), { ...base, name: "Linen cushion", sku: "CUS-2", initialStock: 2 });
      await createProduct(tx, actor(owner), { ...base, name: "Wall art", sku: "ART-1", initialStock: 0 });
    });
    expect((await listProducts(db(), { search: "cushion" })).total).toBe(2);
    expect((await listProducts(db(), { search: "art-1" })).items[0].name).toBe("Wall art");
    expect((await listProducts(db(), { filter: "low" })).items.map((p) => p.sku)).toEqual(["CUS-2"]);
    expect((await listProducts(db(), { filter: "archived" })).items.map((p) => p.sku)).toEqual(["ART-1"]);
    const paged = await listProducts(db(), { pageSize: 5, page: 1 });
    expect(paged.total).toBe(3);
  });

  it("manages categories with case-insensitive unique names", async () => {
    const owner = await createTestUser();
    const { id } = await db().transaction((tx) => createCategory(tx, actor(owner), { name: "Vases", description: null }));
    await expect(db().transaction((tx) => createCategory(tx, actor(owner), { name: "vases", description: null }))).rejects.toThrow(
      /already exists/,
    );
    await db().transaction((tx) => createProduct(tx, actor(owner), { ...base, name: "Tall vase", sku: "V-1", categoryId: id, initialStock: 1 }));
    await db().transaction((tx) => updateCategory(tx, actor(owner), { id, name: "Vases & urns", description: "Ceramics", isActive: true }));
    const [row] = await listCategories(db());
    expect(row).toMatchObject({ name: "Vases & urns", productCount: 1, activeProductCount: 1 });
  });
});
