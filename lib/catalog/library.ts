import "server-only";

/**
 * The DJ's own library (2026-10-11): the club's songs, built by hand, from
 * the catalog (one song or a whole album) or from a rekordbox/CSV import,
 * and browsed by artist, album and style. Rows live in
 * public.library_tracks, scoped to the venue; every write is audited by
 * the caller's route. Guests bid on these songs first.
 */
import type { PoolClient } from "pg";
import { getPool } from "@/lib/db";
import { parseCamelot } from "./camelot";

export interface LibraryTrackInput {
  title: string;
  artist: string;
  album: string | null;
  genre: string;
  bpm: number | null;
  camelotKey: string | null;
  year: number | null;
  durationSec: number | null;
  coverUrl?: string | null;
  catalogTrackId?: string | null;
}

export interface LibraryTrackDto {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  genre: string;
  bpm: number | null;
  camelotKey: string | null;
  year: number | null;
  durationSec: number | null;
  coverUrl: string | null;
  blocked: boolean;
}

export type LibraryView = "tracks" | "artists" | "albums" | "styles";

export interface LibraryFilter {
  q?: string;
  artist?: string;
  album?: string;
  genre?: string;
}

export interface LibraryGroupDto {
  /** Artist, album or style name. */
  name: string;
  /** The album's artist (albums view only). */
  artist?: string;
  tracks: number;
  /** Albums (artists view) or artists (styles view). */
  secondary: number;
  year?: number | null;
  coverUrl?: string | null;
  /** Every song of the style is blocked (styles view). */
  blocked?: boolean;
}

const PAGE = 200;

/** `where` for the filters, from parameter $1 = venue (parameterized only). */
function filterSql(filter: LibraryFilter): { where: string; params: unknown[] } {
  const parts = ["venue_id = $1"];
  const params: unknown[] = [];
  const add = (sql: (n: string) => string, value: string) => {
    params.push(value);
    parts.push(sql(`$${params.length + 1}`));
  };
  if (filter.q) {
    add((n) => `(title || ' ' || artist || ' ' || coalesce(album, '') || ' ' || genre) ilike '%' || ${n} || '%'`, filter.q);
  }
  if (filter.artist) add((n) => `lower(artist) = lower(${n})`, filter.artist);
  if (filter.album) add((n) => `lower(album) = lower(${n})`, filter.album);
  if (filter.genre) add((n) => `lower(genre) = lower(${n})`, filter.genre);
  return { where: parts.join(" and "), params };
}

const num = (v: string | number | null) => (v === null ? null : Number(v));

export async function listLibraryTracks(venueId: string, filter: LibraryFilter): Promise<LibraryTrackDto[]> {
  const { where, params } = filterSql(filter);
  const res = await getPool().query<{
    id: string;
    title: string;
    artist: string;
    album: string | null;
    genre: string;
    bpm: string | null;
    camelot_key: string | null;
    year: number | null;
    duration_sec: number | null;
    cover_url: string | null;
    blocked: boolean;
  }>(
    `select id, title, artist, album, genre, bpm, camelot_key, year, duration_sec, cover_url, blocked
       from public.library_tracks
      where ${where}
      order by lower(artist), lower(coalesce(album, '')), lower(title)
      limit ${PAGE}`,
    [venueId, ...params],
  );
  return res.rows.map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    album: r.album,
    genre: r.genre,
    bpm: num(r.bpm),
    camelotKey: r.camelot_key,
    year: r.year,
    durationSec: r.duration_sec,
    coverUrl: r.cover_url,
    blocked: r.blocked,
  }));
}

/** Artists, albums or styles of the library, with song counts. */
export async function listLibraryGroups(
  venueId: string,
  view: Exclude<LibraryView, "tracks">,
  filter: LibraryFilter,
): Promise<LibraryGroupDto[]> {
  const { where, params } = filterSql(filter);
  const pool = getPool();
  if (view === "artists") {
    const res = await pool.query<{ name: string; tracks: string; albums: string }>(
      `select min(artist) as name, count(*) as tracks, count(distinct lower(album)) as albums
         from public.library_tracks where ${where}
        group by lower(artist) order by lower(min(artist)) limit ${PAGE}`,
      [venueId, ...params],
    );
    return res.rows.map((r) => ({ name: r.name, tracks: Number(r.tracks), secondary: Number(r.albums) }));
  }
  if (view === "albums") {
    const res = await pool.query<{ name: string; artist: string; tracks: string; year: number | null; cover_url: string | null }>(
      `select min(album) as name, min(artist) as artist, count(*) as tracks, max(year) as year, max(cover_url) as cover_url
         from public.library_tracks where ${where} and album is not null
        group by lower(album), lower(artist) order by lower(min(album)) limit ${PAGE}`,
      [venueId, ...params],
    );
    return res.rows.map((r) => ({
      name: r.name,
      artist: r.artist,
      tracks: Number(r.tracks),
      secondary: 1,
      year: r.year,
      coverUrl: r.cover_url,
    }));
  }
  const res = await pool.query<{ name: string; tracks: string; artists: string; blocked: boolean }>(
    `select min(genre) as name, count(*) as tracks, count(distinct lower(artist)) as artists, bool_and(blocked) as blocked
       from public.library_tracks where ${where}
      group by lower(genre) order by lower(min(genre)) limit ${PAGE}`,
    [venueId, ...params],
  );
  return res.rows.map((r) => ({ name: r.name, tracks: Number(r.tracks), secondary: Number(r.artists), blocked: r.blocked }));
}

/** Library totals for the header. */
export async function librarySummary(venueId: string): Promise<{ tracks: number; artists: number; albums: number; styles: number }> {
  const res = await getPool().query<{ tracks: string; artists: string; albums: string; styles: string }>(
    `select count(*) as tracks, count(distinct lower(artist)) as artists,
            count(distinct lower(album)) as albums, count(distinct lower(genre)) as styles
       from public.library_tracks where venue_id = $1`,
    [venueId],
  );
  const r = res.rows[0];
  return {
    tracks: Number(r?.tracks ?? 0),
    artists: Number(r?.artists ?? 0),
    albums: Number(r?.albums ?? 0),
    styles: Number(r?.styles ?? 0),
  };
}

/**
 * Inserts songs, skipping any already in the library (same title + artist,
 * any case), 500 per statement. Returns how many went in.
 */
export async function insertLibraryTracks(
  client: PoolClient,
  venueId: string,
  tracks: readonly LibraryTrackInput[],
): Promise<number> {
  let count = 0;
  const BATCH = 500;
  for (let i = 0; i < tracks.length; i += BATCH) {
    const slice = tracks.slice(i, i + BATCH);
    const res = await client.query(
      `insert into public.library_tracks
         (venue_id, title, artist, album, genre, bpm, camelot_key, year, duration_sec, cover_url, catalog_track_id)
       select distinct on (lower(t.title), lower(t.artist))
              $1, t.title, t.artist, t.album, t.genre, t.bpm, t.camelot_key, t.year, t.duration_sec, t.cover_url, t.catalog_track_id
         from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::text[], $8::int[], $9::int[], $10::text[], $11::uuid[])
              with ordinality as t(title, artist, album, genre, bpm, camelot_key, year, duration_sec, cover_url, catalog_track_id, ord)
        where not exists (
          select 1 from public.library_tracks l
           where l.venue_id = $1 and lower(l.title) = lower(t.title) and lower(l.artist) = lower(t.artist))
        -- The first copy of a song in the file wins.
        order by lower(t.title), lower(t.artist), t.ord`,
      [
        venueId,
        slice.map((t) => t.title),
        slice.map((t) => t.artist),
        slice.map((t) => t.album),
        slice.map((t) => t.genre),
        slice.map((t) => t.bpm),
        slice.map((t) => parseCamelot(t.camelotKey)),
        slice.map((t) => t.year),
        slice.map((t) => t.durationSec),
        slice.map((t) => t.coverUrl ?? null),
        slice.map((t) => t.catalogTrackId ?? null),
      ],
    );
    count += res.rowCount ?? 0;
  }
  return count;
}

/** Edits one song's details. False when it is not in this venue's library. */
export async function updateLibraryTrack(
  client: PoolClient,
  venueId: string,
  id: string,
  input: LibraryTrackInput,
): Promise<"ok" | "not_found" | "duplicate"> {
  const dup = await client.query(
    `select 1 from public.library_tracks
      where venue_id = $1 and id <> $2 and lower(title) = lower($3) and lower(artist) = lower($4)`,
    [venueId, id, input.title, input.artist],
  );
  if ((dup.rowCount ?? 0) > 0) return "duplicate";
  const res = await client.query(
    `update public.library_tracks
        set title = $3, artist = $4, album = $5, genre = $6, bpm = $7, camelot_key = $8, year = $9, duration_sec = $10
      where venue_id = $1 and id = $2`,
    [venueId, id, input.title, input.artist, input.album, input.genre, input.bpm, parseCamelot(input.camelotKey), input.year, input.durationSec],
  );
  return (res.rowCount ?? 0) > 0 ? "ok" : "not_found";
}

/**
 * Removes a song. One that guests already bid on stays (bids and receipts
 * point to it) but is blocked, so nobody can pick it again.
 */
export async function removeLibraryTrack(
  client: PoolClient,
  venueId: string,
  id: string,
): Promise<"deleted" | "blocked" | "not_found"> {
  const used = await client.query(
    `select 1 from public.auction_bids where library_track_id = $1
     union all select 1 from public.auction_intents where library_track_id = $1
     union all select 1 from public.requests where library_track_id = $1
     union all select 1 from public.quotes where library_track_id = $1
     limit 1`,
    [id],
  );
  if ((used.rowCount ?? 0) > 0) {
    const res = await client.query(
      `update public.library_tracks set blocked = true where venue_id = $1 and id = $2`,
      [venueId, id],
    );
    return (res.rowCount ?? 0) > 0 ? "blocked" : "not_found";
  }
  const res = await client.query(`delete from public.library_tracks where venue_id = $1 and id = $2`, [venueId, id]);
  return (res.rowCount ?? 0) > 0 ? "deleted" : "not_found";
}
