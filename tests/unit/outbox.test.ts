// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { posDb } from "@/lib/offline/db";
import { cacheCatalog, flushOutbox, loadCachedCatalog, queueSale } from "@/lib/offline/outbox";

const store = new Map<string, string>();
const payload = (key: string) => ({
  idempotencyKey: key,
  customerId: null,
  items: [{ productId: "p1", quantity: 2, discount: 0, unitPrice: 1000, name: "Vase" }],
  cartDiscount: 0,
  payments: [{ method: "CASH", amount: 2000, externalReference: null }],
  notes: null,
  clientCreatedAt: new Date().toISOString(),
});

describe("offline outbox", () => {
  beforeEach(async () => {
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    vi.stubGlobal("navigator", { userAgent: "test", onLine: true });
    await posDb().outbox.clear();
    await cacheCatalog([{ id: "p1", name: "Vase", sku: "V-1", barcode: null, sellingPrice: 1000, quantity: 5, categoryId: null, imageKey: null }], {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("queues sales locally and lowers cached stock", async () => {
    await queueSale(payload("k-1"), 2000);
    expect(await posDb().outbox.count()).toBe(1);
    expect((await loadCachedCatalog())[0].quantity).toBe(3);
  });

  it("keeps sales when the network fails and retries them later with the same key", async () => {
    await queueSale(payload("k-2"), 2000);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const failed = await flushOutbox();
    expect(failed).toMatchObject({ networkError: true, remaining: 1 });
    expect((await posDb().outbox.get("k-2"))?.status).toBe("error");

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ idempotencyKey: "k-2", status: "synced", saleNumber: "SAL-000009" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ok = await flushOutbox();
    expect(ok).toMatchObject({ synced: 1, remaining: 0 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.sales[0].idempotencyKey).toBe("k-2");
    expect(await posDb().outbox.get("k-2")).toMatchObject({ status: "synced", saleNumber: "SAL-000009" });
  });

  it("marks conflicts and stops retrying them, without deleting them", async () => {
    await queueSale(payload("k-3"), 2000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ idempotencyKey: "k-3", status: "conflict", message: "Not enough stock" }] }), { status: 200 })));
    const result = await flushOutbox();
    expect(result).toMatchObject({ conflicts: 1, remaining: 0 });
    expect(await posDb().outbox.get("k-3")).toMatchObject({ status: "conflict", lastError: "Not enough stock" });
  });
});
