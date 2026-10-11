import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPool, withTransaction } from "@/lib/db";
import { albumTracks, searchAlbums, searchCatalog, type CatalogHit } from "@/lib/catalog/service";
import { insertLibraryTracks } from "@/lib/catalog/library";
import { apiError, hasVenueAccess, requireStaffApi } from "../../_lib/auth";
import { audit, correlationId, readJson } from "../_lib/schema";

export const dynamic = "force-dynamic";

/**
 * Building the library from the music catalog (Deezer):
 *   GET  ?venueId&q        songs and albums to add
 *   POST { venueId, genre, trackIds } add songs (ids from the GET)
 *   POST { venueId, genre, albumId }  add a whole album, its name kept
 * The style is the DJ's call (the catalog has none per song). Songs the
 * library already has are skipped.
 */
const querySchema = z.object({ venueId: z.string().uuid(), q: z.string().trim().min(1).max(80) }).strict();

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStaffApi();
  if (!auth.ok) return auth.response;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return apiError(400, "invalid_query");
  if (!hasVenueAccess(auth.ctx, parsed.data.venueId)) return apiError(403, "forbidden");

  const [tracks, albums] = await Promise.all([
    searchCatalog(parsed.data.q, 20).catch(() => [] as CatalogHit[]),
    searchAlbums(parsed.data.q, 6).catch(() => []),
  ]);
  return NextResponse.json({
    tracks: tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      genre: t.genre,
      bpm: t.bpm,
      coverUrl: t.coverUrl,
    })),
    albums,
  });
}

const postSchema = z.union([
  z
    .object({
      venueId: z.string().uuid(),
      genre: z.string().trim().min(1).max(64),
      trackIds: z.array(z.string().uuid()).min(1).max(50),
    })
    .strict(),
  z
    .object({
      venueId: z.string().uuid(),
      genre: z.string().trim().min(1).max(64),
      albumId: z.string().regex(/^[\w-]{1,40}$/),
    })
    .strict(),
]);

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStaffApi();
  if (!auth.ok) return auth.response;
  const parsed = postSchema.safeParse(await readJson(request));
  if (!parsed.success) return apiError(400, "invalid_body");
  const { venueId, genre } = parsed.data;
  if (!hasVenueAccess(auth.ctx, venueId)) return apiError(403, "forbidden");

  try {
    let album: { title: string; coverUrl: string | null } | null = null;
    let ids: string[];
    if ("albumId" in parsed.data) {
      const found = await albumTracks(parsed.data.albumId).catch(() => null);
      if (!found) return apiError(404, "not_found");
      album = { title: found.album.title, coverUrl: found.album.coverUrl };
      ids = found.hits.map((h) => h.id);
    } else {
      ids = parsed.data.trackIds;
    }
    // Song details come from the catalog cache, never from the client.
    const rows = (
      await getPool().query<{
        id: string;
        title: string;
        artist: string;
        genre: string | null;
        bpm: string | null;
        camelot_key: string | null;
        duration_sec: number | null;
        cover_url: string | null;
      }>(
        `select id, title, artist, genre, bpm, camelot_key, duration_sec, cover_url
           from public.tracks where id = any($1::uuid[])`,
        [ids],
      )
    ).rows;
    if (rows.length === 0) return apiError(404, "not_found");

    const added = await withTransaction(async (client) => {
      const count = await insertLibraryTracks(
        client,
        venueId,
        rows.map((r) => ({
          title: r.title.slice(0, 160),
          artist: r.artist.slice(0, 160),
          album: album ? album.title.slice(0, 120) : null,
          genre,
          bpm: r.bpm === null ? null : Number(r.bpm),
          camelotKey: r.camelot_key,
          year: null,
          durationSec: r.duration_sec,
          coverUrl: r.cover_url ?? album?.coverUrl ?? null,
          catalogTrackId: r.id,
        })),
      );
      await audit(client, auth.ctx.actor, "library.catalog_added", venueId, {
        added: count,
        album: album?.title ?? null,
        genre,
      });
      return count;
    });
    return NextResponse.json({ ok: true, added, skipped: rows.length - added });
  } catch (error) {
    const cid = correlationId();
    console.error(`[cockpit:library-catalog] ${cid}: ${error instanceof Error ? error.message : "unknown"}`);
    return apiError(500, "internal", cid);
  }
}
