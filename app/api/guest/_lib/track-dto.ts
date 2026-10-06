import "server-only";

/**
 * One way to show a track to a guest (search, catalog albums): BPM, style
 * fit, the transition out of what is playing now, and whether it can be
 * picked right now (blocked by the DJ / played a moment ago).
 */
import { getPool } from "@/lib/db";
import { computeFit } from "@/lib/pricing";
import type { FitLabel } from "@/lib/domain/types";
import { assessTransition, type TransitionLevel } from "@/lib/auction/transition";
import type { AuctionConfig } from "@/lib/auction/config";
import { wantBpm, type CatalogHit } from "@/lib/catalog/service";
import type { GuestSessionContext } from "./context";

type UnavailableReason = "blocked" | "recently_played";

export interface SearchTrackDto {
  id: string;
  title: string;
  artist: string;
  genre: string | null;
  bpm: number | null;
  camelotKey: string | null;
  coverUrl: string | null;
  /** The club's own library, or the full catalog (Deezer). */
  source: "library" | "catalog";
  fitLabel: FitLabel;
  /** Transition out of what is playing now (lib/auction/transition). */
  transition: TransitionLevel;
  available: boolean;
  reason?: UnavailableReason;
}


export interface TrackRow {
  id: string;
  title: string;
  artist: string;
  genre: string | null;
  bpm: string | number | null;
  camelot_key: string | null;
  cover_url?: string | null;
  blocked?: boolean;
}

export interface SetContext {
  recentBpms: number[];
  recentGenres: string[];
  current: { bpm: number | null; camelotKey: string | null } | null;
  recentTitleArtists: Set<string>;
}

export const keyOf = (title: string, artist: string) => `${title.toLowerCase()}::${artist.toLowerCase()}`;
const num = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

export async function loadSetContext(ctx: GuestSessionContext): Promise<SetContext> {
  const res = await getPool().query<{
    genre: string | null;
    bpm: string | null;
    camelot_key: string | null;
    title: string;
    artist: string;
    started_at: Date;
  }>(
    `select genre, bpm, camelot_key, title, artist, started_at
       from public.session_tracks where session_id = $1
      order by started_at desc limit 20`,
    [ctx.sessionId],
  );
  const windowStart = Date.now() - ctx.config.noRepeatWindowMin * 60_000;
  const lastFive = res.rows.slice(0, 5).reverse();
  const first = res.rows[0];
  return {
    recentBpms: lastFive.map((r) => num(r.bpm)).filter((b): b is number => b !== null && Number.isFinite(b)),
    recentGenres: lastFive.map((r) => r.genre).filter((g): g is string => Boolean(g)),
    current: first ? { bpm: num(first.bpm), camelotKey: first.camelot_key } : null,
    recentTitleArtists: new Set(
      res.rows.filter((r) => r.started_at.getTime() > windowStart).map((r) => keyOf(r.title, r.artist)),
    ),
  };
}

export function toDto(
  row: TrackRow,
  source: SearchTrackDto["source"],
  ctx: GuestSessionContext,
  set: SetContext,
  rules: AuctionConfig["transition"],
): SearchTrackDto {
  const bpm = num(row.bpm);
  const fit = computeFit(
    { genre: row.genre ?? "", bpm, camelotKey: row.camelot_key },
    { recentBpms: set.recentBpms, recentGenres: set.recentGenres, currentKey: set.current?.camelotKey ?? null },
    ctx.genres,
  );
  const reason: UnavailableReason | undefined = row.blocked
    ? "blocked"
    : set.recentTitleArtists.has(keyOf(row.title, row.artist))
      ? "recently_played"
      : undefined;
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    genre: row.genre,
    bpm,
    camelotKey: row.camelot_key,
    coverUrl: row.cover_url ?? null,
    source,
    fitLabel: fit.label,
    transition: assessTransition({ bpm, camelotKey: row.camelot_key }, set.current, rules).level,
    available: reason === undefined,
    ...(reason ? { reason } : {}),
  };
}

export const fromHit = (h: CatalogHit): TrackRow => ({
  id: h.id,
  title: h.title,
  artist: h.artist,
  genre: null,
  bpm: h.bpm,
  camelot_key: h.camelotKey,
  cover_url: h.coverUrl,
});

/** The first catalog hits without a BPM: the worker measures them (next search shows it). */
export function measureLater(hits: CatalogHit[], max = 8): void {
  void wantBpm(hits.filter((h) => h.bpm === null).slice(0, max).map((h) => h.id)).catch(() => undefined);
}
