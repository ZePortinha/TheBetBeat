import { NextResponse } from "next/server";
import { myAuctionState, publicAuctionState } from "@/lib/auction/service";
import { availablePaymentMethods } from "@/lib/payments";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { apiError, rateLimitedResponse } from "../_lib/http";
import { getGuestIdentity } from "../_lib/auth";
import { resolveGuestContext } from "../_lib/context";

export const dynamic = "force-dynamic";

/**
 * GET /api/guest/auction?token= — tonight's slot auctions (public: open
 * auctions with the top amount, next slot, "A seguir", recent winners,
 * ranking by money spent) plus, for a signed-in guest, their wallet and
 * bids. `serverNow` lets the app count down on the server clock.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const resolved = await resolveGuestContext(token);
  if (!resolved.ok) return apiError(resolved.error, 404);
  const { sessionId, venueId } = resolved.ctx;

  const identity = await getGuestIdentity(request);
  if (identity && !rateLimit(`auction:${identity.guestId}`, LIMITS.search.limit * 2, LIMITS.search.windowMs).ok) {
    return rateLimitedResponse();
  }
  const now = Date.now();
  const [pub, me] = await Promise.all([
    publicAuctionState(sessionId, now),
    identity ? myAuctionState(sessionId, venueId, identity.guestId) : Promise.resolve(null),
  ]);
  if (!pub) return apiError("session_not_live", 409);
  return NextResponse.json({ ...pub, me, paymentMethods: await availablePaymentMethods() });
}
