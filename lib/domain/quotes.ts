import "server-only";

/**
 * Quote service (BRIEF B5 "Serviço de cotações", B4.3 "Validação da
 * cotação").
 *
 * `computeQuote` (lib/pricing) stays pure; THIS module does the I/O:
 * it loads the pricing context in a handful of parameterized queries,
 * persists every quote (conversion measurement + audit), stamps
 * `expiresAt = now + 120 s`, and publishes the smoothing factors back
 * onto the session (B5.6 stability).
 *
 * The client NEVER sends prices: it sends a quoteId and the server
 * re-validates everything here (`validateQuoteForPayment`).
 */

import type { PoolClient } from "pg";
import { getPool } from "@/lib/db";
import {
  computeQuote,
  type QuoteInput,
  type QuoteResult,
  type TierQuote,
} from "@/lib/pricing";
import { parseSessionConfig } from "./config";
import type { QuotedTierPrices } from "./machine";
import type { SessionConfig, Tier } from "./types";

/** Quotes are valid for 120 seconds (B4.3). */
export const QUOTE_TTL_MS = 120_000;

/** Anything with pg's query method: a Pool or a PoolClient. */
export type Queryable = Pick<PoolClient, "query">;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type TrackRef =
  | { source: "library"; trackId: string }
  | { source: "catalog"; trackId: string };

export type GetQuoteError =
  | "session_not_found"
  | "session_not_live"
  | "requests_closed"
  | "track_not_found"
  | "track_blocked";

export interface GetQuoteSuccess {
  ok: true;
  quoteId: string;
  /** ISO UTC. */
  expiresAt: string;
  result: QuoteResult;
}

export type GetQuoteOutcome = GetQuoteSuccess | { ok: false; error: GetQuoteError };

export type QuoteValidationError =
  | "quote_not_found"
  | "quote_wrong_guest"
  | "quote_expired"
  | "session_not_live"
  | "tier_unavailable"
  | "invalid_amount"
  | "amount_below_price"
  | "amount_above_limit";

/** Everything the request-creation flow needs from a validated quote. */
export interface ValidatedQuote {
  ok: true;
  quoteId: string;
  sessionId: string;
  venueId: string;
  zoneId: string | null;
  guestId: string;
  libraryTrackId: string | null;
  trackId: string | null;
  trackTitle: string;
  trackArtist: string;
  trackGenre: string | null;
  fitScore: number | null;
  fitLabel: string | null;
  tiers: TierQuote[];
  tierQuote: TierQuote;
  quotedPrices: QuotedTierPrices;
  config: SessionConfig;
  venueShareBps: number;
}

export type QuoteValidationOutcome =
  | ValidatedQuote
  | { ok: false; error: QuoteValidationError };

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested without a database)                       */
/* ------------------------------------------------------------------ */

/** The original quote's tier prices, as the state machine needs them. */
export function quotedPricesFromTiers(
  tiers: ReadonlyArray<Pick<TierQuote, "tier" | "priceCents">>,
): QuotedTierPrices {
  const price = (tier: Tier): number =>
    tiers.find((t) => t.tier === tier)?.priceCents ?? 0;
  return {
    queueCents: price("QUEUE"),
    soonCents: price("SOON"),
    nextCents: price("NEXT"),
  };
}

export interface QuoteChoiceInput {
  tiers: readonly TierQuote[];
  tier: Tier;
  /** What the guest wants to pay, integer cents. */
  amountCents: number;
  /** Max for the chosen tier (session config, B5.6). */
  tierMaxCents: number;
  /** Quote expiry, epoch ms. */
  expiresAtMs: number;
  now: number;
}

/**
 * Pure validation of a guest's (tier, amount) choice against a quote:
 * expiry, tier availability, and the free-extra-value rule (B4.1 —
 * paying MORE than the tier price is allowed, up to the tier's max;
 * paying less never is).
 */
export function validateQuoteChoice(
  input: QuoteChoiceInput,
): { ok: true; tierQuote: TierQuote } | { ok: false; error: QuoteValidationError } {
  if (input.now >= input.expiresAtMs) {
    return { ok: false, error: "quote_expired" };
  }
  const tierQuote = input.tiers.find((t) => t.tier === input.tier);
  if (!tierQuote || !tierQuote.available) {
    return { ok: false, error: "tier_unavailable" };
  }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: "invalid_amount" };
  }
  if (input.amountCents < tierQuote.priceCents) {
    return { ok: false, error: "amount_below_price" };
  }
  if (input.amountCents > input.tierMaxCents) {
    return { ok: false, error: "amount_above_limit" };
  }
  return { ok: true, tierQuote };
}

/* ------------------------------------------------------------------ */
/* getQuote                                                            */
/* ------------------------------------------------------------------ */

interface SessionContextRow {
  id: string;
  venue_id: string;
  status: string;
  requests_open: boolean;
  genres: string[];
  ends_at: Date;
  last_demand_factor: string | null;
  last_occupancy_factor: string | null;
  last_published_at: Date | null;
  config: unknown;
}

interface TrackRowDb {
  id: string;
  title: string;
  artist: string;
  genre: string | null;
  bpm: string | null;
  camelot_key: string | null;
  duration_sec: number | null;
  cover_url?: string | null;
  blocked?: boolean;
}

function numOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Computes, persists and returns a quote for (session, zone, guest,
 * track) at `now` (epoch ms, always injected).
 */
export async function getQuote(
  sessionId: string,
  zoneId: string | null,
  guestId: string,
  trackRef: TrackRef,
  now: number,
  db: Queryable = getPool(),
): Promise<GetQuoteOutcome> {
  // 1. Session + settings (single joined query).
  const sessionRes = await db.query<SessionContextRow>(
    `select s.id, s.venue_id, s.status, s.requests_open, s.genres, s.ends_at,
            s.last_demand_factor, s.last_occupancy_factor, s.last_published_at,
            coalesce(ss.config, '{}'::jsonb) as config
       from public.sessions s
       left join public.session_settings ss on ss.session_id = s.id
      where s.id = $1`,
    [sessionId],
  );
  const session = sessionRes.rows[0];
  if (!session) return { ok: false, error: "session_not_found" };
  if (session.status !== "live") return { ok: false, error: "session_not_live" };
  if (!session.requests_open) return { ok: false, error: "requests_closed" };

  const config = parseSessionConfig(session.config);

  // 2. The track (library or global-catalog cache), snapshot fields.
  const track =
    trackRef.source === "library"
      ? (
          await db.query<TrackRowDb>(
            `select id, title, artist, genre, bpm, camelot_key, duration_sec, blocked
               from public.library_tracks
              where id = $1 and venue_id = $2`,
            [trackRef.trackId, session.venue_id],
          )
        ).rows[0]
      : (
          await db.query<TrackRowDb>(
            `select id, title, artist, genre, bpm, camelot_key, duration_sec, cover_url
               from public.tracks
              where id = $1`,
            [trackRef.trackId],
          )
        ).rows[0];
  if (!track) return { ok: false, error: "track_not_found" };
  if (track.blocked === true) return { ok: false, error: "track_blocked" };

  // 3. Active queue (paid and not yet played — B5.1) in one query.
  const queueRes = await db.query<{
    tier: Tier;
    amount_cents: number;
    paid_at: Date | null;
    track_duration_sec: number | null;
  }>(
    `select tier, amount_cents, paid_at, track_duration_sec
       from public.requests
      where session_id = $1 and status in ('paid', 'accepted', 'playing')`,
    [sessionId],
  );

  // 4. Set context: last 5 played tracks (+ current-track remaining).
  const setRes = await db.query<{
    genre: string | null;
    bpm: string | null;
    camelot_key: string | null;
    duration_sec: number | null;
    started_at: Date;
    title: string;
    artist: string;
  }>(
    `select genre, bpm, camelot_key, duration_sec, started_at, title, artist
       from public.session_tracks
      where session_id = $1
      order by started_at desc
      limit 5`,
    [sessionId],
  );
  const recent = setRes.rows.slice().reverse(); // oldest → newest
  const latest = setRes.rows[0];
  let currentTrackRemainingSec: number | null = null;
  if (latest && latest.duration_sec !== null) {
    const remaining = (latest.started_at.getTime() + latest.duration_sec * 1000 - now) / 1000;
    currentTrackRemainingSec = remaining > 0 ? Math.round(remaining) : null;
  }

  // 5. No-repeat window (B4.6): same title+artist played recently?
  const windowStartMs = now - config.noRepeatWindowMin * 60_000;
  const repeatRes = await db.query(
    `select 1
       from public.session_tracks
      where session_id = $1
        and started_at > to_timestamp($2 / 1000.0)
        and lower(title) = lower($3) and lower(artist) = lower($4)
      limit 1`,
    [sessionId, windowStartMs, track.title, track.artist],
  );
  const recentlyPlayed = (repeatRes.rowCount ?? 0) > 0;

  // 6. Venue genre multipliers (B5.4).
  const multRes = await db.query<{ genre: string; multiplier: string }>(
    `select genre, multiplier from public.genre_multipliers where venue_id = $1`,
    [session.venue_id],
  );
  const genreMultipliers: Record<string, number> = {};
  for (const row of multRes.rows) {
    const value = Number(row.multiplier);
    if (Number.isFinite(value) && value > 0) genreMultipliers[row.genre] = value;
  }

  // 7. Assemble QuoteInput and run the pure engine.
  const lastDemand = numOrNull(session.last_demand_factor);
  const lastOccupancy = numOrNull(session.last_occupancy_factor);
  const lastPublished =
    session.last_published_at !== null && lastDemand !== null && lastOccupancy !== null
      ? {
          atMs: session.last_published_at.getTime(),
          demandFactor: lastDemand,
          occupancyFactor: lastOccupancy,
        }
      : null;

  const input: QuoteInput = {
    session: {
      basePriceCents: config.basePriceCents,
      acceptanceRatePerHour: config.acceptanceRatePerHour,
      endsAtMs: session.ends_at.getTime(),
      tierLimits: config.tierLimits,
      genres: session.genres,
      soonDeadlineMin: config.soonDeadlineMin,
      lastPublished,
      minFitScore: config.minFitScore,
    },
    queue: {
      active: queueRes.rows.map((r) => ({
        tier: r.tier,
        amountCents: r.amount_cents,
        paidAtMs: (r.paid_at ?? new Date(now)).getTime(),
        trackDurationSec: r.track_duration_sec,
      })),
      currentTrackRemainingSec,
    },
    track: {
      genre: track.genre ?? "",
      bpm: numOrNull(track.bpm),
      camelotKey: track.camelot_key,
      recentlyPlayed,
    },
    set: {
      recentBpms: recent
        .map((r) => numOrNull(r.bpm))
        .filter((b): b is number => b !== null),
      recentGenres: recent
        .map((r) => r.genre)
        .filter((g): g is string => g !== null && g !== ""),
      currentKey: latest?.camelot_key ?? null,
    },
    venue: { genreMultipliers },
  };

  const result = computeQuote(input, now);
  const expiresAtMs = now + QUOTE_TTL_MS;

  // 8. Persist the quote (conversion measurement + audit, B5.7).
  const insertRes = await db.query<{ id: string }>(
    `insert into public.quotes
       (session_id, zone_id, guest_id, library_track_id, track_id,
        track_title, track_artist, track_genre,
        fit_score, fit_label, demand_rho, tiers, breakdown, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             to_timestamp($14 / 1000.0))
     returning id`,
    [
      sessionId,
      zoneId,
      guestId,
      trackRef.source === "library" ? track.id : null,
      trackRef.source === "catalog" ? track.id : null,
      track.title,
      track.artist,
      track.genre,
      result.fit.score,
      result.fit.label,
      result.demand.rho,
      JSON.stringify(result.tiers),
      JSON.stringify({ ...result.breakdown, published: result.published }),
      expiresAtMs,
    ],
  );
  const quoteId = insertRes.rows[0]?.id;
  if (!quoteId) throw new Error("quote insert returned no id");

  // 9. Publish smoothing factors back onto the session (B5.6).
  await db.query(
    `update public.sessions
        set last_demand_factor = $1,
            last_occupancy_factor = $2,
            last_published_at = to_timestamp($3 / 1000.0)
      where id = $4`,
    [result.published.demandFactor, result.published.occupancyFactor, now, sessionId],
  );

  return {
    ok: true,
    quoteId,
    expiresAt: new Date(expiresAtMs).toISOString(),
    result,
  };
}

/* ------------------------------------------------------------------ */
/* validateQuoteForPayment                                             */
/* ------------------------------------------------------------------ */

interface QuoteJoinRow {
  id: string;
  session_id: string;
  zone_id: string | null;
  guest_id: string;
  library_track_id: string | null;
  track_id: string | null;
  track_title: string;
  track_artist: string;
  track_genre: string | null;
  fit_score: string | null;
  fit_label: string | null;
  tiers: TierQuote[];
  expires_at: Date;
  venue_id: string;
  session_status: string;
  requests_open: boolean;
  config: unknown;
  venue_share_bps: number;
}

/**
 * Server-side re-validation before any money moves (B4.3): the quote
 * exists, belongs to this guest, has not expired, the tier is
 * available, and the amount respects price ≤ amount ≤ tier max
 * (free extra value, B4.1). Returns typed errors — the route maps them
 * to generic client messages.
 *
 * Pass the transaction's client so the validation reads the same
 * snapshot the reservation writes to.
 */
export async function validateQuoteForPayment(
  quoteId: string,
  tier: Tier,
  amountCents: number,
  guestId: string,
  now: number,
  db: Queryable = getPool(),
): Promise<QuoteValidationOutcome> {
  const res = await db.query<QuoteJoinRow>(
    `select q.id, q.session_id, q.zone_id, q.guest_id,
            q.library_track_id, q.track_id,
            q.track_title, q.track_artist, q.track_genre,
            q.fit_score, q.fit_label, q.tiers, q.expires_at,
            s.venue_id, s.status as session_status, s.requests_open,
            coalesce(ss.config, '{}'::jsonb) as config,
            coalesce(ss.venue_share_bps, 5000) as venue_share_bps
       from public.quotes q
       join public.sessions s on s.id = q.session_id
       left join public.session_settings ss on ss.session_id = s.id
      where q.id = $1`,
    [quoteId],
  );
  const row = res.rows[0];
  if (!row) return { ok: false, error: "quote_not_found" };
  if (row.guest_id !== guestId) return { ok: false, error: "quote_wrong_guest" };
  if (row.session_status !== "live" || !row.requests_open) {
    return { ok: false, error: "session_not_live" };
  }

  const config = parseSessionConfig(row.config);
  const choice = validateQuoteChoice({
    tiers: row.tiers,
    tier,
    amountCents,
    tierMaxCents: config.tierLimits[tier].maxCents,
    expiresAtMs: row.expires_at.getTime(),
    now,
  });
  if (!choice.ok) return choice;

  return {
    ok: true,
    quoteId: row.id,
    sessionId: row.session_id,
    venueId: row.venue_id,
    zoneId: row.zone_id,
    guestId: row.guest_id,
    libraryTrackId: row.library_track_id,
    trackId: row.track_id,
    trackTitle: row.track_title,
    trackArtist: row.track_artist,
    trackGenre: row.track_genre,
    fitScore: numOrNull(row.fit_score),
    fitLabel: row.fit_label,
    tiers: row.tiers,
    tierQuote: choice.tierQuote,
    quotedPrices: quotedPricesFromTiers(row.tiers),
    config,
    venueShareBps: row.venue_share_bps,
  };
}
