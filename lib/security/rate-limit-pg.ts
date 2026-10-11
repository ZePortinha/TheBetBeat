import "server-only";
import { query } from "@/lib/db";
import type { RateLimitResult } from "./rate-limit";

/**
 * Durable fixed-window rate limit (migration 0015), shared by every app
 * instance. One upsert per call; for sign-in and other guess-guarding
 * limits, not for hot read paths. A database error lets the request
 * through: the in-memory limiter still applies and Auth has its own.
 */
export async function rateLimitDurable(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<RateLimitResult> {
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  try {
    const res = await query<{ hits: number }>(
      `insert into public.rate_limits (key, window_start, hits) values ($1, $2, 1)
       on conflict (key) do update
         set hits = case when public.rate_limits.window_start = excluded.window_start
                         then public.rate_limits.hits + 1 else 1 end,
             window_start = excluded.window_start
       returning hits`,
      [key, windowStart],
    );
    // Old windows are dead weight; trim now and then.
    if (Math.random() < 0.01) {
      await query(`delete from public.rate_limits where window_start < $1`, [
        new Date(now - 24 * 60 * 60_000),
      ]);
    }
    const hits = res.rows[0]?.hits ?? 1;
    const retryAfterSec = Math.ceil((windowStart.getTime() + windowMs - now) / 1000);
    return hits > limit
      ? { ok: false, remaining: 0, retryAfterSec }
      : { ok: true, remaining: limit - hits, retryAfterSec: 0 };
  } catch {
    return { ok: true, remaining: limit, retryAfterSec: 0 };
  }
}
