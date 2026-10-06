import { NextResponse } from "next/server";
import { z } from "zod";
import { refundWallet } from "@/lib/auction/service";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { apiError, rateLimitedResponse } from "../../_lib/http";
import { getGuestIdentity } from "../../_lib/auth";
import { resolveGuestContext } from "../../_lib/context";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ token: z.string().min(1).max(1024) }).strict();

/** POST /api/guest/wallet/refund — "Devolver saldo": the whole balance back to the payment method. */
export async function POST(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);
  if (!rateLimit(`wallet-refund:${identity.guestId}`, 3, LIMITS.payment.windowMs).ok) return rateLimitedResponse();
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError("invalid_request", 400);
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return apiError("invalid_request", 400);
  const resolved = await resolveGuestContext(parsed.data.token);
  if (!resolved.ok) return apiError("invalid_token", 404);
  const refundedCents = await refundWallet(identity.guestId, resolved.ctx.venueId, resolved.ctx.sessionId, Date.now());
  return NextResponse.json({ refundedCents });
}
