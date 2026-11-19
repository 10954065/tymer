import { getDeviceId, posDb, type CachedProduct, type OutboxSale } from "./db";

const BATCH_SIZE = 20;
let flushing: Promise<FlushResult> | null = null;

export interface FlushResult {
  synced: number;
  conflicts: number;
  remaining: number;
  networkError: boolean;
}

export async function cacheCatalog(products: CachedProduct[], settings: Record<string, unknown>): Promise<void> {
  const db = posDb();
  await db.transaction("rw", db.products, db.meta, async () => {
    await db.products.clear();
    await db.products.bulkPut(products);
    await db.meta.put({ key: "settings", value: settings });
    await db.meta.put({ key: "catalogSavedAt", value: Date.now() });
  });
}

export async function loadCachedCatalog(): Promise<CachedProduct[]> {
  return posDb().products.orderBy("id").toArray();
}

/** Stores a sale made offline. Local stock is reduced so the till does not keep offering sold-out items. */
export async function queueSale(payload: OutboxSale["payload"], total: number): Promise<void> {
  const db = posDb();
  const now = Date.now();
  await db.transaction("rw", db.outbox, db.products, async () => {
    await db.outbox.put({ idempotencyKey: payload.idempotencyKey, payload, total, status: "pending", attempts: 0, lastError: null, saleNumber: null, createdAt: now, updatedAt: now });
    for (const item of payload.items) {
      const product = await db.products.get(item.productId);
      if (product) await db.products.update(item.productId, { quantity: product.quantity - item.quantity });
    }
  });
  await requestBackgroundSync();
}

async function requestBackgroundSync(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.ready;
    const sync = (registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } } | undefined)?.sync;
    await sync?.register("slb-sync-sales");
  } catch {
    // Background Sync is not available everywhere (e.g. iOS); the app also syncs on reconnect and on load.
  }
}

interface ServerOutcome {
  idempotencyKey: string;
  status: "synced" | "conflict" | "retry";
  saleNumber?: string;
  message?: string;
}

async function doFlush(): Promise<FlushResult> {
  const db = posDb();
  const result: FlushResult = { synced: 0, conflicts: 0, remaining: 0, networkError: false };
  const pending = await db.outbox.where("status").anyOf(["pending", "error", "syncing"]).sortBy("createdAt");
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    await db.outbox.bulkUpdate(batch.map((s) => ({ key: s.idempotencyKey, changes: { status: "syncing" as const, updatedAt: Date.now() } })));
    let outcomes: ServerOutcome[];
    try {
      const response = await fetch("/api/sync/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: getDeviceId(), deviceLabel: navigator.userAgent.slice(0, 120), sales: batch.map((s) => s.payload) }),
      });
      if (response.status === 401) throw new Error("Sign in again to sync offline sales");
      if (!response.ok) throw new Error(`Server responded ${response.status}`);
      outcomes = ((await response.json()) as { results: ServerOutcome[] }).results;
    } catch (error) {
      // Network or server failure: keep every sale and retry later. Nothing is ever discarded.
      await db.outbox.bulkUpdate(batch.map((s) => ({ key: s.idempotencyKey, changes: { status: "error" as const, attempts: s.attempts + 1, lastError: error instanceof Error ? error.message : "Sync failed", updatedAt: Date.now() } })));
      result.networkError = true;
      break;
    }
    for (const outcome of outcomes) {
      const sale = batch.find((s) => s.idempotencyKey === outcome.idempotencyKey);
      if (!sale) continue;
      const status = outcome.status === "synced" ? "synced" : outcome.status === "conflict" ? "conflict" : "error";
      if (status === "synced") result.synced += 1;
      if (status === "conflict") result.conflicts += 1;
      await db.outbox.update(sale.idempotencyKey, { status, attempts: sale.attempts + 1, lastError: outcome.message ?? null, saleNumber: outcome.saleNumber ?? null, updatedAt: Date.now() });
    }
  }
  result.remaining = await db.outbox.where("status").anyOf(["pending", "error", "syncing"]).count();
  // Synced sales are kept for a week so staff can still see them, then removed from the device (the server has them).
  await db.outbox.where("status").equals("synced").and((s) => s.updatedAt < Date.now() - 7 * 86_400_000).delete();
  return result;
}

/** Sends queued sales to the server. Concurrent calls share one run. */
export function flushOutbox(): Promise<FlushResult> {
  flushing ??= doFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}
