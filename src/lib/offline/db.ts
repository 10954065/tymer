import Dexie, { type EntityTable } from "dexie";

export interface CachedProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  sellingPrice: number;
  quantity: number;
  categoryId: string | null;
  imageKey: string | null;
}

export type OutboxStatus = "pending" | "syncing" | "synced" | "conflict" | "error";

export interface OutboxSale {
  /** Idempotency key: the same key is sent on every retry, so the server records the sale at most once. */
  idempotencyKey: string;
  payload: {
    idempotencyKey: string;
    customerId: string | null;
    items: { productId: string; quantity: number; discount: number; unitPrice: number; name: string }[];
    cartDiscount: number;
    payments: { method: string; amount: number; externalReference: string | null }[];
    notes: string | null;
    clientCreatedAt: string;
  };
  total: number;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  saleNumber: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

/** Local database on each till: cached catalogue and the queue of sales waiting to sync. */
export class PosDatabase extends Dexie {
  products!: EntityTable<CachedProduct, "id">;
  outbox!: EntityTable<OutboxSale, "idempotencyKey">;
  meta!: EntityTable<MetaEntry, "key">;

  constructor() {
    super("smartliving-pos");
    this.version(1).stores({
      products: "id, sku, barcode, categoryId",
      outbox: "idempotencyKey, status, createdAt",
      meta: "key",
    });
  }
}

let instance: PosDatabase | null = null;
export function posDb(): PosDatabase {
  instance ??= new PosDatabase();
  return instance;
}

export function getDeviceId(): string {
  const key = "slb-device-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}
