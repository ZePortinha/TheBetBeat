import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { getQuote } from "@/lib/domain/quotes";
import { upgradeTier } from "@/lib/domain/service";
import { isHigherTier, type RequestStatus, type Tier } from "@/lib/domain/types";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { apiError, clientIp, rateLimitedResponse } from "../../../_lib/http";
import { getGuestIdentity } from "../../../_lib/auth";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });

interface OwnRequestRow {
  id: string;
  guest_id: string;
  session_id: string;
  zone_id: string | null;
  tier: Tier;
  status: RequestStatus;
  amount_cents: number;
  library_track_id: string | null;
  track_id: string | null;
}

async function loadOwnRequest(id: string, guestId: string): Promise<OwnRequestRow | null> {
  const res = await getPool().query<OwnRequestRow>(
    `select id, guest_id, session_id, zone_id, tier, status, amount_cents,
            library_track_id, track_id
       from public.requests
      where id = $1 and guest_id = $2`,
    [id, guestId],
  );
  return res.rows[0] ?? null;
}

/**
 * GET — upgrade preview (B4.1 "Subir de nível"): fresh quote for the
 * request's track; the guest pays only the difference to the CURRENT
 * price of the stronger tier. Informative only — the POST re-quotes.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);

  const limit = rateLimit(
    `upgrade-preview:${identity.guestId}`,
    LIMITS.quote.limit,
    LIMITS.quote.windowMs,
  );
  if (!limit.ok) return rateLimitedResponse();

  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return apiError("invalid_request", 400);

  const row = await loadOwnRequest(parsed.data.id, identity.guestId);
  if (!row) return apiError("not_found", 404);

  if (
    (row.status !== "paid" && row.status !== "accepted") ||
    row.tier === "NEXT"
  ) {
    return NextResponse.json({ upgradable: false, options: [] });
  }

  const trackRef =
    row.library_track_id !== null
      ? ({ source: "library", trackId: row.library_track_id } as const)
      : ({ source: "catalog", trackId: row.track_id ?? "" } as const);
  const quote = await getQuote(
    row.session_id,
    row.zone_id,
    identity.guestId,
    trackRef,
    Date.now(),
  );
  if (!quote.ok) return NextResponse.json({ upgradable: false, options: [] });

  const options = quote.result.tiers
    .filter((t) => isHigherTier(t.tier, row.tier))
    .map((t) => ({
      tier: t.tier,
      available: t.available,
      ...(t.reason ? { reason: t.reason } : {}),
      priceCents: t.priceCents,
      diffCents: Math.max(0, t.priceCents - row.amount_cents),
      etaDisplayMin: t.etaDisplayMin,
    }));

  return NextResponse.json({ upgradable: options.some((o) => o.available), options });
}

const postSchema = z
  .object({
    toTier: z.enum(["SOON", "NEXT"]),
    turnstileToken: z.string().min(1).max(4096),
  })
  .strict();

/** POST — executes the upgrade (service re-quotes + charges the diff). */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);

  const limit = rateLimit(
    `payment:${identity.guestId}`,
    LIMITS.payment.limit,
    LIMITS.payment.windowMs,
  );
  if (!limit.ok) return rateLimitedResponse();

  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return apiError("invalid_request", 400);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError("invalid_request", 400);
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) return apiError("invalid_request", 400);

  const human = await verifyTurnstile(parsed.data.turnstileToken, clientIp(request));
  if (!human) return apiError("bot_check_failed", 403);

  const outcome = await upgradeTier(
    params.data.id,
    parsed.data.toTier,
    identity.guestId,
    Date.now(),
  );
  if (!outcome.ok) {
    const code =
      outcome.error === "request_not_found" || outcome.error === "not_request_owner"
        ? "not_found"
        : outcome.error;
    return apiError(code, code === "not_found" ? 404 : 409);
  }

  return NextResponse.json({
    requestId: outcome.requestId,
    toTier: outcome.toTier,
    chargedCents: outcome.chargedCents,
    state: outcome.state,
    payment: outcome.payment
      ? { expiresAt: outcome.payment.expiresAt }
      : null,
  });
}
