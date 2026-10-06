import "server-only";

/**
 * Sliding-window in-memory rate limiter (B4.7 / B12.4).
 * Good for a single-node deployment and local dev; the interface allows a
 * Redis/Upstash adapter later without touching call sites.
 */
type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  // Opportunistic sweep so the map doesn't grow unbounded.
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, b] of buckets) {
      if (b.timestamps.length === 0 || now - b.timestamps[b.timestamps.length - 1]! > windowMs) {
        buckets.delete(k);
      }
    }
  }

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }
  const cutoff = now - windowMs;
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0]!;
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.ceil((oldest + windowMs - now) / 1000),
    };
  }
  bucket.timestamps.push(now);
  return { ok: true, remaining: limit - bucket.timestamps.length, retryAfterSec: 0 };
}

/** Standard limits for public endpoints. */
export const LIMITS = {
  anonSession: { limit: 20, windowMs: 60 * 60_000 }, // per IP
  search: { limit: 60, windowMs: 60_000 }, // per guest
  quote: { limit: 30, windowMs: 60_000 }, // per guest
  payment: { limit: 10, windowMs: 60_000 }, // per guest
  login: { limit: 10, windowMs: 10 * 60_000 }, // per IP
  smsCode: { limit: 3, windowMs: 10 * 60_000 }, // per guest and per number
  smsVerify: { limit: 10, windowMs: 10 * 60_000 }, // per guest
} as const;
