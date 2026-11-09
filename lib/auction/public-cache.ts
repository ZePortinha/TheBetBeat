import "server-only";
import { createMicroCache } from "@/lib/cache/micro";
import { publicAuctionState, type PublicAuctionState } from "./service";

/**
 * The public half of the guest auction screen, shared by every phone in
 * the room (load test 2026-11-05: 1 000 guests polling every 3 s is ~330
 * reads/s; uncached, one process topped out near 140/s). Half a second of
 * sharing turns that into ~2 database reads per second per night. Writes in
 * this process (bids, DJ decisions) drop the entry at once; other
 * processes (the worker closing an auction) are at most 500 ms behind, and
 * the realtime hint that follows makes every phone read again.
 * `serverNow` is always fresh, so countdowns never drift.
 */
const cache = createMicroCache<PublicAuctionState | null>(500);

export async function cachedPublicAuctionState(sessionId: string, now: number): Promise<PublicAuctionState | null> {
  const state = await cache(sessionId, () => publicAuctionState(sessionId, now), now);
  return state ? { ...state, serverNow: new Date(now).toISOString() } : null;
}

export function invalidatePublicAuctionState(sessionId: string): void {
  cache.invalidate(sessionId);
}
