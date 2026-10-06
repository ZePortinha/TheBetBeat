import { NextResponse } from "next/server";
import { z } from "zod";
import { setKeepBalance } from "@/lib/auction/service";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { apiError, rateLimitedResponse } from "../../_lib/http";
import { ensureGuestRow, getGuestIdentity } from "../../_lib/auth";
import { resolveGuestContext } from "../../_lib/context";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ token: z.string().min(1).max(1024), keep: z.boolean() }).strict();

/**
 * POST /api/guest/wallet/keep — the guest's end-of-night choice: keep the
 * balance for another night at this club, or have it refunded. Honoured
 * only while the club allows keeping (auction config keepBalanceAllowed).
 */
export async function POST(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);
  if (!rateLimit(`wallet-keep:${identity.guestId}`, 10, LIMITS.payment.windowMs).ok) return rateLimitedResponse();
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
  await ensureGuestRow(identity.guestId);
  await setKeepBalance(identity.guestId, resolved.ctx.venueId, parsed.data.keep);
  return NextResponse.json({ keep: parsed.data.keep });
}
