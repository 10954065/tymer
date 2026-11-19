import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { resetDatabase } from "../support/db";

const db = () => getDb();

async function seedBasics() {
  const user = await db().execute<{ id: string }>(
    sql`INSERT INTO users (full_name, username, password_hash, role) VALUES ('Owner', 'owner', 'x', 'OWNER') RETURNING id`,
  );
  const product = await db().execute<{ id: string }>(
    sql`INSERT INTO products (name, sku, selling_price, cost_price, quantity) VALUES ('Vase', 'VAS-1', 5000, 3000, 10) RETURNING id`,
  );
  return { userId: user.rows[0].id, productId: product.rows[0].id };
}

/** Postgres error text lives on the driver error, which Drizzle wraps as `cause`. */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected the statement to be rejected").not.toBeNull();
  const err = error as Error & { cause?: Error & { constraint?: string } };
  expect(`${err.message} ${err.cause?.message ?? ""} ${err.cause?.constraint ?? ""}`).toMatch(pattern);
}

describe("database integrity guards", () => {
  beforeEach(resetDatabase);
  afterAll(closeDb);

  it("seeds reference data through migrations", async () => {
    const settings = await db().execute(sql`SELECT business_name FROM business_settings WHERE id = 1`);
    expect(settings.rows[0]).toMatchObject({ business_name: "SMARTLIVING BUYNFRY VENTURES" });
    const categories = await db().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM expense_categories`);
    expect(categories.rows[0].n).toBeGreaterThanOrEqual(12);
  });

  it("makes inventory movements append-only", async () => {
    const { productId, userId } = await seedBasics();
    await db().execute(sql`INSERT INTO inventory_movements (product_id, type, quantity_change, previous_quantity, new_quantity, user_id)
      VALUES (${productId}, 'INITIAL_STOCK', 10, 0, 10, ${userId})`);
    await expectDbError(db().execute(sql`UPDATE inventory_movements SET reason = 'x'`), /append-only/);
    await expectDbError(db().execute(sql`DELETE FROM inventory_movements`), /append-only/);
  });

  it("rejects movements whose balance does not add up", async () => {
    const { productId } = await seedBasics();
    await expectDbError(
      db().execute(sql`INSERT INTO inventory_movements (product_id, type, quantity_change, previous_quantity, new_quantity)
        VALUES (${productId}, 'PURCHASE', 5, 10, 14)`),
      /movements_balance_ck/,
    );
  });

  it("never allows products to be deleted", async () => {
    const { productId } = await seedBasics();
    await expectDbError(db().execute(sql`DELETE FROM products WHERE id = ${productId}`), /cannot be deleted/);
  });

  it("enforces unique SKUs case-insensitively", async () => {
    await seedBasics();
    await expectDbError(
      db().execute(sql`INSERT INTO products (name, sku, selling_price) VALUES ('Other', 'vas-1', 100)`),
      /products_sku_upper_uq/,
    );
  });

  it("enforces payment sign and target rules", async () => {
    const { userId } = await seedBasics();
    const sale = await db().execute<{ id: string }>(sql`INSERT INTO sales (idempotency_key, subtotal, total, cost_total, created_by)
      VALUES ('k1', 1000, 1000, 600, ${userId}) RETURNING id`);
    const saleId = sale.rows[0].id;
    await expectDbError(
      db().execute(sql`INSERT INTO payments (kind, method, amount, sale_id, received_by) VALUES ('RECEIPT', 'CASH', -100, ${saleId}, ${userId})`),
      /payments_sign_ck/,
    );
    await expectDbError(
      db().execute(sql`INSERT INTO payments (kind, method, amount, received_by) VALUES ('RECEIPT', 'CASH', 100, ${userId})`),
      /payments_target_ck/,
    );
  });

  it("freezes sale amounts and blocks reinstating voided sales", async () => {
    const { userId } = await seedBasics();
    await db().execute(sql`INSERT INTO sales (idempotency_key, subtotal, total, cost_total, created_by) VALUES ('k2', 1000, 1000, 600, ${userId})`);
    await expectDbError(db().execute(sql`UPDATE sales SET total = 1, subtotal = 1`), /immutable/);
    await db().execute(sql`UPDATE sales SET status = 'VOIDED', voided_at = now(), void_reason = 'test'`);
    await expectDbError(db().execute(sql`UPDATE sales SET status = 'COMPLETED', voided_at = null`), /cannot be reinstated/);
  });

  it("rejects sales whose totals are inconsistent", async () => {
    const { userId } = await seedBasics();
    await expectDbError(
      db().execute(sql`INSERT INTO sales (idempotency_key, subtotal, discount_total, total, cost_total, created_by) VALUES ('k3', 1000, 100, 1000, 0, ${userId})`),
      /sales_total_ck/,
    );
  });

  it("generates sequential human-readable document numbers", async () => {
    const { userId } = await seedBasics();
    const rows = await db().execute<{ sale_number: string }>(sql`INSERT INTO sales (idempotency_key, subtotal, total, cost_total, created_by)
      VALUES ('a', 0, 0, 0, ${userId}), ('b', 0, 0, 0, ${userId}) RETURNING sale_number`);
    const numbers = rows.rows.map((r) => r.sale_number);
    expect(numbers.every((n) => /^SAL-\d{6}$/.test(n))).toBe(true);
    expect(new Set(numbers).size).toBe(2);
  });

  it("makes expense amounts immutable while allowing note corrections", async () => {
    const { userId } = await seedBasics();
    const cat = await db().execute<{ id: string }>(sql`SELECT id FROM expense_categories LIMIT 1`);
    await db().execute(sql`INSERT INTO expenses (description, amount, category_id, expense_date, payment_method, created_by)
      VALUES ('Rent', 50000, ${cat.rows[0].id}, '2026-11-01', 'CASH', ${userId})`);
    await db().execute(sql`UPDATE expenses SET notes = 'allowed'`);
    await expectDbError(db().execute(sql`UPDATE expenses SET amount = 1`), /immutable/);
  });
});
