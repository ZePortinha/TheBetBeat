import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { checkHandle } from "@/lib/guests/phone-handle";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { apiError, rateLimitedResponse } from "../_lib/http";
import { getGuestIdentity } from "../_lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/guest/handle?h=rita.m — can this guest take that @ right now?
 * (2026-10-11) Lets the @ field say "available" or "taken" while the guest
 * types. Answers only ok / taken / not_allowed, never whose it is. The
 * real check happens again when the @ is saved.
 */
const querySchema = z.object({
  h: z
    .string()
    .min(2)
    .max(24)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i),
});

export async function GET(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);
  if (!rateLimit(`handle-check:${identity.guestId}`, LIMITS.search.limit, LIMITS.search.windowMs).ok) {
    return rateLimitedResponse();
  }
  const parsed = querySchema.safeParse({ h: new URL(request.url).searchParams.get("h") ?? "" });
  if (!parsed.success) return apiError("invalid_request", 400);

  const me = await getPool().query<{ phone_hash: string | null; phone_verified_at: Date | null }>(
    `select phone_hash, phone_verified_at from public.guests where id = $1`,
    [identity.guestId],
  );
  const provenHash = me.rows[0]?.phone_verified_at ? me.rows[0].phone_hash : null;
  const result = await checkHandle(getPool(), parsed.data.h, identity.guestId, provenHash);
  return NextResponse.json({ status: result }, { headers: { "cache-control": "no-store" } });
}
