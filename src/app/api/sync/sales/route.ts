import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { can } from "@/lib/permissions";
import { PAYMENT_METHODS } from "@/lib/validation/common";
import { getCurrentSession } from "@/server/auth/current-user";
import { checkRateLimit } from "@/server/auth/rate-limit";
import { CACHE_TAGS, FINANCIAL_TAGS, invalidate } from "@/server/cache";
import { getDb } from "@/server/db/client";
import { syncOfflineSale, touchDevice, type SyncOutcome } from "@/server/services/sync";

const int = z.number().int().min(0).max(100_000_000_000);
const bodySchema = z.object({
  deviceId: z.string().min(8).max(64),
  deviceLabel: z.string().max(120).nullable().optional(),
  sales: z
    .array(
      z.object({
        idempotencyKey: z.string().min(8).max(100),
        customerId: z.uuid().nullable(),
        items: z.array(z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(100_000), discount: int, unitPrice: int, name: z.string().max(200).optional() })).min(1).max(200),
        cartDiscount: int,
        payments: z.array(z.object({ method: z.enum(PAYMENT_METHODS), amount: int, externalReference: z.string().max(100).nullable().optional() })).max(10),
        notes: z.string().max(500).nullable().optional(),
        clientCreatedAt: z.iso.datetime(),
      }),
    )
    .min(1)
    .max(25),
});

/** Receives sales recorded offline. Each sale is processed independently and reported back; nothing is dropped. */
export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!can(session.user.role, "pos:use")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (!checkRateLimit(`sync:${session.user.id}`, 120, 60_000).allowed) return NextResponse.json({ error: "Slow down" }, { status: 429 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid sync payload" }, { status: 400 });
  const { deviceId, deviceLabel, sales } = parsed.data;
  const db = getDb();
  const actor = { id: session.user.id, role: session.user.role, canOverrideDiscount: can(session.user.role, "sales:discount_override") };

  const results: SyncOutcome[] = [];
  for (const sale of sales) {
    results.push(await syncOfflineSale(db, actor, deviceId, sale));
  }
  await touchDevice(db, deviceId, session.user.id, deviceLabel ?? null);
  if (results.some((r) => r.status === "synced" && !r.duplicate)) invalidate(CACHE_TAGS.catalog, ...FINANCIAL_TAGS);
  return NextResponse.json({ results });
}
