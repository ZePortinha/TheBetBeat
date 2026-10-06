import "server-only";

/**
 * Global catalog cache (2026-10-06): every catalog track a guest sees is
 * kept in public.tracks with a stable id, so bids, the DJ and the venue
 * screen work the same as for the club's own library.
 *
 *   searchCatalog   provider search → upsert → hits with our ids
 *   ensureTrackBpm  provider BPM, else measured from the preview; cached,
 *                   and a track without a clear pulse is retried once a day
 */
import { getPool } from "@/lib/db";
import { getCatalogProvider } from "./index";
import type { CatalogAlbum, CatalogTrack } from "./types";

export type CatalogAlbumHit = CatalogAlbum;

export interface CatalogHit {
  id: string;
  title: string;
  artist: string;
  bpm: number | null;
  camelotKey: string | null;
  coverUrl: string | null;
  durationSec: number | null;
}

const RETRY_AFTER_MS = 24 * 60 * 60_000;

export async function searchCatalog(query: string, limit = 20, offset = 0): Promise<CatalogHit[]> {
  const provider = await getCatalogProvider();
  return cacheTracks(provider.name, await provider.search(query, limit, offset));
}

/** Ask the worker to find these tracks' BPM (cheap; never blocks a search). */
export async function wantBpm(trackIds: string[], now = Date.now()): Promise<void> {
  if (trackIds.length === 0) return;
  await getPool().query(
    `update public.tracks set bpm_wanted_at = to_timestamp($2 / 1000.0)
      where id = any($1::uuid[]) and bpm is null and bpm_checked_at is null and bpm_wanted_at is null`,
    [trackIds, now],
  );
}

/** Worker: measures a few wanted BPMs per call, newest wishes first. */
export async function measureWantedBpms(limit = 3, now = Date.now()): Promise<number> {
  const res = await getPool().query<{ id: string }>(
    `select id from public.tracks
      where bpm is null and bpm_checked_at is null and bpm_wanted_at is not null
      order by bpm_wanted_at desc limit $1`,
    [limit],
  );
  let found = 0;
  for (const { id } of res.rows) {
    if ((await ensureTrackBpm(id, now).catch(() => null)) !== null) found += 1;
  }
  return found;
}

/** Albums by name (empty when the provider has no album search). */
export async function searchAlbums(query: string, limit = 4): Promise<CatalogAlbumHit[]> {
  const provider = await getCatalogProvider();
  return provider.searchAlbums ? provider.searchAlbums(query, limit) : [];
}

/** An album with every song, each cached as a catalog track (our ids). */
export async function albumTracks(providerAlbumId: string): Promise<{ album: CatalogAlbumHit; hits: CatalogHit[] } | null> {
  const provider = await getCatalogProvider();
  const found = provider.album ? await provider.album(providerAlbumId) : null;
  if (!found) return null;
  return { album: found.album, hits: await cacheTracks(provider.name, found.tracks) };
}

/** The provider's charts (empty when it has none). */
export async function trendingCatalog(limit = 20): Promise<CatalogHit[]> {
  const provider = await getCatalogProvider();
  return provider.trending ? cacheTracks(provider.name, await provider.trending(limit)) : [];
}

async function cacheTracks(providerName: string, found: CatalogTrack[]): Promise<CatalogHit[]> {
  if (found.length === 0) return [];
  const res = await getPool().query<{
    id: string;
    provider_track_id: string;
    title: string;
    artist: string;
    bpm: string | null;
    camelot_key: string | null;
    cover_url: string | null;
    duration_sec: number | null;
  }>(
    `insert into public.tracks (provider, provider_track_id, title, artist, bpm, bpm_source, duration_sec, cover_url, preview_url)
     select $1, t.pid, t.title, t.artist, t.bpm, case when t.bpm is null then null else 'catalog' end, t.dur, t.cover, t.preview
       from unnest($2::text[], $3::text[], $4::text[], $5::numeric[], $6::int[], $7::text[], $8::text[])
            as t(pid, title, artist, bpm, dur, cover, preview)
     on conflict (provider, provider_track_id) do update
        set title = excluded.title, artist = excluded.artist, cover_url = excluded.cover_url,
            preview_url = excluded.preview_url, duration_sec = excluded.duration_sec,
            bpm = coalesce(public.tracks.bpm, excluded.bpm),
            bpm_source = coalesce(public.tracks.bpm_source, excluded.bpm_source)
     returning id, provider_track_id, title, artist, bpm, camelot_key, cover_url, duration_sec`,
    [
      providerName,
      found.map((t) => t.providerTrackId),
      found.map((t) => t.title),
      found.map((t) => t.artist),
      found.map((t) => t.bpm),
      found.map((t) => t.durationSec),
      found.map((t) => t.coverUrl),
      found.map((t) => t.previewUrl),
    ],
  );
  const byPid = new Map(res.rows.map((r) => [r.provider_track_id, r]));
  // Keep the provider's relevance order.
  return found
    .map((t) => byPid.get(t.providerTrackId))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      bpm: r.bpm === null ? null : Number(r.bpm),
      camelotKey: r.camelot_key,
      coverUrl: r.cover_url,
      durationSec: r.duration_sec,
    }));
}

/** The track's BPM, finding it once if needed (provider first, then the preview's audio). */
export async function ensureTrackBpm(trackId: string, now = Date.now()): Promise<number | null> {
  const pool = getPool();
  const row = (
    await pool.query<{ provider_track_id: string; bpm: string | null; bpm_checked_at: Date | null; preview_url: string | null }>(
      `select provider_track_id, bpm, bpm_checked_at, preview_url from public.tracks where id = $1`,
      [trackId],
    )
  ).rows[0];
  if (!row) return null;
  if (row.bpm !== null) return Number(row.bpm);
  if (row.bpm_checked_at && now - row.bpm_checked_at.getTime() < RETRY_AFTER_MS) return null;

  const provider = await getCatalogProvider();
  const meta = await provider.getTrack(row.provider_track_id);
  let bpm = meta?.bpm ?? null;
  let source: "catalog" | "audio" | null = bpm !== null ? "catalog" : null;
  if (bpm === null) {
    // Preview links are signed and expire: prefer the fresh one.
    const url = meta?.previewUrl ?? row.preview_url;
    const { measurePreviewBpm } = await import("./preview-bpm");
    bpm = url ? await measurePreviewBpm(url).catch(() => null) : null;
    source = bpm !== null ? "audio" : null;
  }
  await pool.query(
    `update public.tracks set bpm = coalesce(bpm, $2), bpm_source = coalesce(bpm_source, $3),
            bpm_checked_at = to_timestamp($4 / 1000.0)
      where id = $1`,
    [trackId, bpm, source, now],
  );
  return bpm;
}
