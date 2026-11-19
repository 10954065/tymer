/**
 * Small in-memory fixed-window rate limiter (per server instance).
 * Brute-force protection is primarily the per-account lockout stored in PostgreSQL;
 * this limiter adds cheap per-IP throttling without extra database writes.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5_000;

export function checkRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) pruneExpired(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (bucket.count >= limit) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }
  buckets.set(key, { count: bucket.count + 1, resetAt: bucket.resetAt });
  return { allowed: true, retryAfterMs: 0 };
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

function pruneExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
