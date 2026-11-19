import type { DbClient } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";

export interface AuditEntry {
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  reference?: string | null;
}

export async function recordAudit(db: DbClient, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    userId: entry.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId == null ? null : String(entry.entityId),
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    reference: entry.reference ?? null,
  });
}

/**
 * Returns only the fields that changed, keeping audit rows small.
 * Values are compared after JSON normalisation (dates, numbers, strings).
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const next = after[key];
    if (next === undefined) continue;
    const prev = before[key];
    if (JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null)) {
      changedBefore[key] = prev ?? null;
      changedAfter[key] = next ?? null;
    }
  }
  return Object.keys(changedAfter).length ? { before: changedBefore, after: changedAfter } : null;
}
