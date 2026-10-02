import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { computeFit } from "@/lib/pricing";
import { roundPriceCents } from "@/lib/pricing/compute";
import type { FitLabel, SessionConfig } from "@/lib/domain/types";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { apiError, rateLimitedResponse } from "../_lib/http";
import { ensureGuestRow, getGuestIdentity } from "../_lib/auth";
import { resolveGuestContext, type GuestSessionContext } from "../_lib/context";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  token: z.string().min(1).max(1024),
  q: z.string().max(80).optional(),
});

type UnavailableReason = "blocked" | "recently_played" | "already_requested";

export interface SearchTrackDto {
  id: string;
  title: string;
  artist: string;
  genre: string | null;
  bpm: number | null;
  camelotKey: string | null;
  fitLabel: FitLabel;
  /** QUEUE-price approximation for list rows ("desde X €") — see below. */
  fromPriceCents: number;
  available: boolean;
  reason?: UnavailableReason;
}

export interface SearchResponse {
  sections: Array<{ key: "results" | "fits" | "popular" | "recent"; tracks: SearchTrackDto[] }>;
}

interface LibRow {
  id: string;
  title: string;
  artist: string;
  genre: string | null;
  bpm: string | null;
  camelot_key: string | null;
  blocked: boolean;
}

interface SetContext {
  recentBpms: number[];
  recentGenres: string[];
  currentKey: string | null;
  recentTitleArtists: Set<string>;
  requestedLibraryIds: Set<string>;
  requestedTitleArtists: Set<string>;
  lastDemandFactor: number;
  genreMultipliers: Record<string, number>;
}

function keyOf(title: string, artist: string): string {
  return `${title.toLowerCase()}::${artist.toLowerCase()}`;
}

/**
 * "desde X €" for LIST rows is a documented approximation (BRIEF prompt /
 * B5): base × M_g × fitFactor × lastPublishedDemandFactor, clamped to the
 * QUEUE tier limits and rounded like the engine. The REAL price for the
 * selected track comes from a persisted quote (POST /api/guest/quotes) —
 * the approximation is never used for charging.
 */
function approxQueuePriceCents(
  config: SessionConfig,
  genreMultiplier: number,
  fitScore: number,
  lastDemandFactor: number,
): number {
  const fitFactor = 1 + 0.5 * (1 - fitScore);
  const raw = config.basePriceCents * genreMultiplier * fitFactor * lastDemandFactor;
  const limits = config.tierLimits.QUEUE;
  const clamped = Math.min(limits.maxCents, Math.max(limits.minCents, raw));
  return roundPriceCents(clamped);
}

async function loadSetContext(ctx: GuestSessionContext): Promise<SetContext> {
  const pool = getPool();
  const [setRes, activeRes, sessionRes, multRes] = await Promise.all([
    pool.query<{
      genre: string | null;
      bpm: string | null;
      camelot_key: string | null;
      title: string;
      artist: string;
      started_at: Date;
    }>(
      `select genre, bpm, camelot_key, title, artist, started_at
         from public.session_tracks
        where session_id = $1
        order by started_at desc
        limit 20`,
      [ctx.sessionId],
    ),
    pool.query<{
      library_track_id: string | null;
      track_title: string;
      track_artist: string;
    }>(
      `select library_track_id, track_title, track_artist
         from public.requests
        where session_id = $1
          and status in ('pending_payment', 'paid', 'accepted', 'playing')`,
      [ctx.sessionId],
    ),
    pool.query<{ last_demand_factor: string | null }>(
      `select last_demand_factor from public.sessions where id = $1`,
      [ctx.sessionId],
    ),
    pool.query<{ genre: string; multiplier: string }>(
      `select genre, multiplier from public.genre_multipliers where venue_id = $1`,
      [ctx.venueId],
    ),
  ]);

  const now = Date.now();
  const windowStart = now - ctx.config.noRepeatWindowMin * 60_000;
  const recentTitleArtists = new Set<string>();
  for (const row of setRes.rows) {
    if (row.started_at.getTime() > windowStart) {
      recentTitleArtists.add(keyOf(row.title, row.artist));
    }
  }
  const lastFive = setRes.rows.slice(0, 5).reverse();

  const requestedLibraryIds = new Set<string>();
  const requestedTitleArtists = new Set<string>();
  for (const row of activeRes.rows) {
    if (row.library_track_id) requestedLibraryIds.add(row.library_track_id);
    requestedTitleArtists.add(keyOf(row.track_title, row.track_artist));
  }

  const genreMultipliers: Record<string, number> = {};
  for (const row of multRes.rows) {
    const value = Number(row.multiplier);
    if (Number.isFinite(value) && value > 0) genreMultipliers[row.genre] = value;
  }

  const lastDemandRaw = Number(sessionRes.rows[0]?.last_demand_factor ?? NaN);

  return {
    recentBpms: lastFive
      .map((r) => (r.bpm !== null ? Number(r.bpm) : null))
      .filter((b): b is number => b !== null && Number.isFinite(b)),
    recentGenres: lastFive
      .map((r) => r.genre)
      .filter((g): g is string => g !== null && g !== ""),
    currentKey: setRes.rows[0]?.camelot_key ?? null,
    recentTitleArtists,
    requestedLibraryIds,
    requestedTitleArtists,
    lastDemandFactor: Number.isFinite(lastDemandRaw) ? lastDemandRaw : 1,
    genreMultipliers,
  };
}

function toDto(row: LibRow, ctx: GuestSessionContext, set: SetContext): SearchTrackDto {
  const bpm = row.bpm !== null ? Number(row.bpm) : null;
  const fit = computeFit(
    { genre: row.genre ?? "", bpm, camelotKey: row.camelot_key },
    { recentBpms: set.recentBpms, recentGenres: set.recentGenres, currentKey: set.currentKey },
    ctx.genres,
  );
  const genreKey = row.genre ?? "";
  const multiplier = set.genreMultipliers[genreKey] ?? 1;

  let reason: UnavailableReason | undefined;
  if (row.blocked) reason = "blocked";
  else if (set.recentTitleArtists.has(keyOf(row.title, row.artist))) {
    reason = "recently_played";
  } else if (
    set.requestedLibraryIds.has(row.id) ||
    set.requestedTitleArtists.has(keyOf(row.title, row.artist))
  ) {
    reason = "already_requested";
  }

  const dto: SearchTrackDto = {
    id: row.id,
    title: row.title,
    artist: row.artist,
    genre: row.genre,
    bpm,
    camelotKey: row.camelot_key,
    fitLabel: fit.label,
    fromPriceCents: approxQueuePriceCents(
      ctx.config,
      multiplier,
      fit.score,
      set.lastDemandFactor,
    ),
    available: reason === undefined,
  };
  if (reason) dto.reason = reason;
  return dto;
}

/** GET /api/guest/search?token=…&q=… — explicit DTOs, never select * (B12.4). */
export async function GET(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);

  const limit = rateLimit(
    `search:${identity.guestId}`,
    LIMITS.search.limit,
    LIMITS.search.windowMs,
  );
  if (!limit.ok) return rateLimitedResponse();

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    token: url.searchParams.get("token") ?? "",
    q: url.searchParams.get("q") ?? undefined,
  });
  if (!parsed.success) return apiError("invalid_request", 400);

  const resolved = await resolveGuestContext(parsed.data.token);
  if (!resolved.ok) return apiError("invalid_token", 404);
  const ctx = resolved.ctx;

  await ensureGuestRow(identity.guestId);
  const set = await loadSetContext(ctx);
  const pool = getPool();
  const q = parsed.data.q?.trim() ?? "";

  if (q.length > 0) {
    const res = await pool.query<LibRow>(
      `select id, title, artist, genre, bpm, camelot_key, blocked
         from public.library_tracks
        where venue_id = $1
          and (title || ' ' || artist) ilike '%' || $2 || '%'
        order by similarity(title || ' ' || artist, $2) desc, title
        limit 20`,
      [ctx.venueId, q],
    );
    const response: SearchResponse = {
      sections: [{ key: "results", tracks: res.rows.map((r) => toDto(r, ctx, set)) }],
    };
    return NextResponse.json(response);
  }

  // Empty query → curated sections (B6.2).
  const [allRes, popularRes, recentRes] = await Promise.all([
    pool.query<LibRow>(
      `select id, title, artist, genre, bpm, camelot_key, blocked
         from public.library_tracks
        where venue_id = $1 and blocked = false
        limit 400`,
      [ctx.venueId],
    ),
    pool.query<LibRow & { n: string }>(
      `select lt.id, lt.title, lt.artist, lt.genre, lt.bpm, lt.camelot_key, lt.blocked,
              count(r.id)::bigint as n
         from public.requests r
         join public.library_tracks lt on lt.id = r.library_track_id
        where r.session_id = $1 and r.created_at > now() - interval '24 hours'
        group by lt.id
        order by n desc
        limit 6`,
      [ctx.sessionId],
    ),
    pool.query<LibRow>(
      `select id, title, artist, genre, bpm, camelot_key, blocked
         from public.library_tracks
        where venue_id = $1 and blocked = false
        order by created_at desc
        limit 6`,
      [ctx.venueId],
    ),
  ]);

  const fits = allRes.rows
    .map((row) => ({ row, dto: toDto(row, ctx, set) }))
    .filter((x) => x.dto.fitLabel === "fits" && x.dto.available)
    .sort((a, b) => a.dto.fromPriceCents - b.dto.fromPriceCents)
    .slice(0, 8)
    .map((x) => x.dto);

  const response: SearchResponse = {
    sections: [
      { key: "fits", tracks: fits },
      { key: "popular", tracks: popularRes.rows.map((r) => toDto(r, ctx, set)) },
      { key: "recent", tracks: recentRes.rows.map((r) => toDto(r, ctx, set)) },
    ].filter((s) => s.tracks.length > 0) as SearchResponse["sections"],
  };
  return NextResponse.json(response);
}
