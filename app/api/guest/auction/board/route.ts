import { NextResponse } from "next/server";
import { z } from "zod";
import { cachedPublicAuctionState } from "@/lib/auction/public-cache";
import { createMicroCache } from "@/lib/cache/micro";
import { rateLimit } from "@/lib/security/rate-limit";
import { apiError, clientIp, rateLimitedResponse } from "../../_lib/http";
import { resolveGuestContext, type ResolveResult } from "../../_lib/context";

export const dynamic = "force-dynamic";

/**
 * GET /api/guest/auction/board?token= — the PUBLIC half of the auction
 * screen only: open auctions and their top amount, what is next, winners,
 * ranking. The same for every phone in the room, so it needs no identity,
 * reads from the shared micro-cache and may be cached for a second by a
 * CDN in front of the app.
 *
 * The phones read it on every public realtime hint (someone bid). Before
 * this route each hint made every phone reload its personal state as well:
 * load test 2026-11-05, 1 000 guests and 50 bids a minute meant ~1 000
 * requests per second. Personal state still comes from /api/guest/auction
 * on the slow poll and on the guest's own private events (outbid, won).
 */
const contexts = createMicroCache<ResolveResult>(5_000);

const querySchema = z.object({ token: z.string().min(1).max(1024) }).strict();

/** As generous as session-state: a club shares one address. */
const PER_IP = { limit: 15_000, windowMs: 60_000 };

export async function GET(request: Request) {
  if (!rateLimit(`auction-board:${clientIp(request)}`, PER_IP.limit, PER_IP.windowMs).ok) {
    return rateLimitedResponse();
  }
  const parsed = querySchema.safeParse({ token: new URL(request.url).searchParams.get("token") ?? "" });
  if (!parsed.success) return apiError("invalid_token", 404);
  const { token } = parsed.data;
  const now = Date.now();
  const resolved = await contexts(token, () => resolveGuestContext(token), now);
  if (!resolved.ok) return apiError(resolved.error, 404);
  const board = await cachedPublicAuctionState(resolved.ctx.sessionId, now);
  if (!board) return apiError("session_not_live", 409);
  return NextResponse.json(board, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=1, stale-while-revalidate=1" },
  });
}
