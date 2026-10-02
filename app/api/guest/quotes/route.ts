import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { getQuote } from "@/lib/domain/quotes";
import type { Tier } from "@/lib/domain/types";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { apiError, rateLimitedResponse } from "../_lib/http";
import { ensureGuestRow, getGuestIdentity } from "../_lib/auth";
import { resolveGuestContext } from "../_lib/context";

export const dynamic = "force-dynamic";

/** Strict allowlist (B12.2): the client NEVER sends prices. */
const bodySchema = z
  .object({
    token: z.string().min(1).max(1024),
    trackId: z.string().uuid(),
  })
  .strict();

export interface QuoteTierDto {
  tier: Tier;
  priceCents: number;
  etaDisplayMin: number;
  available: boolean;
  reason?: string;
  minCents: number;
  maxCents: number;
}

/** POST /api/guest/quotes — creates a persisted 120 s quote (B4.3/B5). */
export async function POST(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);

  const limit = rateLimit(
    `quote:${identity.guestId}`,
    LIMITS.quote.limit,
    LIMITS.quote.windowMs,
  );
  if (!limit.ok) return rateLimitedResponse();

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
  const ctx = resolved.ctx;

  await ensureGuestRow(identity.guestId);

  const outcome = await getQuote(
    ctx.sessionId,
    ctx.zoneId,
    identity.guestId,
    { source: "library", trackId: parsed.data.trackId },
    Date.now(),
  );
  if (!outcome.ok) {
    const status = outcome.error === "track_not_found" ? 404 : 409;
    return apiError(outcome.error, status);
  }

  // Track display snapshot for the tier screen (explicit DTO, B12.4).
  const trackRes = await getPool().query<{
    title: string;
    artist: string;
    genre: string | null;
    bpm: string | null;
    camelot_key: string | null;
    duration_sec: number | null;
  }>(
    `select title, artist, genre, bpm, camelot_key, duration_sec
       from public.library_tracks
      where id = $1 and venue_id = $2`,
    [parsed.data.trackId, ctx.venueId],
  );
  const track = trackRes.rows[0];
  if (!track) return apiError("track_not_found", 404);

  const tiers: QuoteTierDto[] = outcome.result.tiers.map((t) => ({
    tier: t.tier,
    priceCents: t.priceCents,
    etaDisplayMin: t.etaDisplayMin,
    available: t.available,
    ...(t.reason ? { reason: t.reason } : {}),
    minCents: ctx.config.tierLimits[t.tier].minCents,
    maxCents: ctx.config.tierLimits[t.tier].maxCents,
  }));

  return NextResponse.json({
    quoteId: outcome.quoteId,
    expiresAt: outcome.expiresAt,
    fit: outcome.result.fit,
    demand: { level: outcome.result.demand.level },
    tiers,
    track: {
      id: parsed.data.trackId,
      title: track.title,
      artist: track.artist,
      genre: track.genre,
      bpm: track.bpm !== null ? Number(track.bpm) : null,
      camelotKey: track.camelot_key,
      durationSec: track.duration_sec,
    },
  });
}
