import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { loadNight } from "@/lib/auction/service";
import { searchAlbums, searchCatalog, trendingCatalog, type CatalogAlbumHit, type CatalogHit } from "@/lib/catalog/service";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { apiError, rateLimitedResponse } from "../_lib/http";
import { ensureGuestRow, getGuestIdentity } from "../_lib/auth";
import { resolveGuestContext } from "../_lib/context";
import {
  fromHit,
  keyOf,
  loadSetContext,
  measureLater,
  toDto,
  type SearchTrackDto,
  type TrackRow,
} from "../_lib/track-dto";

export type { SearchTrackDto } from "../_lib/track-dto";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  token: z.string().min(1).max(1024),
  q: z.string().max(80).optional(),
  /** Catalog page (0 = first): "Mostrar mais" loads the next one. */
  page: z.coerce.number().int().min(0).max(40).default(0),
});

const PAGE_SIZE = 25;

export interface SearchResponse {
  sections: Array<{
    key: "results" | "catalog" | "trending" | "fits" | "popular" | "recent";
    tracks: SearchTrackDto[];
  }>;
  /** The catalog has more results for this query (next `page`). */
  hasMore?: boolean;
  /** Albums matching the query (open one to see all its songs). */
  albums?: CatalogAlbumHit[];
}

/** GET /api/guest/search?token=…&q=… — explicit DTOs, never select * (B12.4). */
export async function GET(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);
  if (!rateLimit(`search:${identity.guestId}`, LIMITS.search.limit, LIMITS.search.windowMs).ok) {
    return rateLimitedResponse();
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    token: url.searchParams.get("token") ?? "",
    q: url.searchParams.get("q") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
  });
  if (!parsed.success) return apiError("invalid_request", 400);

  const resolved = await resolveGuestContext(parsed.data.token);
  if (!resolved.ok) return apiError("invalid_token", 404);
  const ctx = resolved.ctx;

  await ensureGuestRow(identity.guestId);
  const pool = getPool();
  const [set, night] = await Promise.all([loadSetContext(ctx), loadNight(pool, ctx.sessionId)]);
  if (!night) return apiError("session_not_live", 409);
  const rules = night.config.transition;
  const dto = (row: TrackRow, source: SearchTrackDto["source"]) => toDto(row, source, ctx, set, rules);
  const q = parsed.data.q?.trim() ?? "";

  const page = parsed.data.page;
  if (q.length > 0 && page > 0) {
    // "Mostrar mais": the next page of the full catalog only.
    const more = night.catalogOpen ? await searchCatalog(q, PAGE_SIZE, page * PAGE_SIZE).catch(() => []) : [];
    measureLater(more);
    const response: SearchResponse = {
      sections: [{ key: "catalog", tracks: more.map((h) => dto(fromHit(h), "catalog")) }],
      hasMore: more.length === PAGE_SIZE,
    };
    return NextResponse.json(response);
  }

  if (q.length > 0) {
    const [lib, catalog, albums] = await Promise.all([
      pool.query<TrackRow>(
        `select id, title, artist, genre, bpm, camelot_key, blocked
           from public.library_tracks
          where venue_id = $1 and (title || ' ' || artist) ilike '%' || $2 || '%'
          order by similarity(title || ' ' || artist, $2) desc, title
          limit 20`,
        [ctx.venueId, q],
      ),
      // The full catalog when the DJ opened it tonight; a provider outage
      // (or its quota) just leaves the club's library.
      night.catalogOpen ? searchCatalog(q, PAGE_SIZE).catch(() => [] as CatalogHit[]) : Promise.resolve([] as CatalogHit[]),
      night.catalogOpen ? searchAlbums(q, 4).catch(() => [] as CatalogAlbumHit[]) : Promise.resolve([] as CatalogAlbumHit[]),
    ]);
    const inLibrary = new Set(lib.rows.map((r) => keyOf(r.title, r.artist)));
    const catalogHits = catalog.filter((h) => !inLibrary.has(keyOf(h.title, h.artist)));
    measureLater(catalogHits);
    const response: SearchResponse = {
      sections: [
        { key: "results" as const, tracks: lib.rows.map((r) => dto(r, "library")) },
        { key: "catalog" as const, tracks: catalogHits.map((h) => dto(fromHit(h), "catalog")) },
      ].filter((s) => s.tracks.length > 0),
      hasMore: catalog.length === PAGE_SIZE,
      albums,
    };
    return NextResponse.json(response);
  }

  // Empty query → curated sections (B6.2): trending, what fits, tonight's bids, new in the library.
  const [trending, allRes, popularRes, recentRes] = await Promise.all([
    night.catalogOpen ? trendingCatalog(20).catch(() => [] as CatalogHit[]) : Promise.resolve([] as CatalogHit[]),
    pool.query<TrackRow>(
      `select id, title, artist, genre, bpm, camelot_key, blocked
         from public.library_tracks where venue_id = $1 and blocked = false limit 400`,
      [ctx.venueId],
    ),
    pool.query<TrackRow & { source: SearchTrackDto["source"] }>(
      `select coalesce(lt.id, t.id) as id, coalesce(lt.title, t.title) as title, coalesce(lt.artist, t.artist) as artist,
              coalesce(lt.genre, t.genre) as genre, coalesce(lt.bpm, t.bpm) as bpm,
              coalesce(lt.camelot_key, t.camelot_key) as camelot_key, t.cover_url,
              case when lt.id is null then 'catalog' else 'library' end as source,
              coalesce(lt.blocked, false) as blocked
         from public.auction_bids b
         left join public.library_tracks lt on lt.id = b.library_track_id
         left join public.tracks t on t.id = b.catalog_track_id
        -- Catalog songs only while the DJ keeps the catalog open: a bid on one
        -- with the catalog closed would be refused (track_not_found).
        where b.session_id = $1 and (lt.id is not null or (t.id is not null and $2))
        group by 1, 2, 3, 4, 5, 6, 7, 8, 9
        order by count(distinct b.owner_guest_id) desc
        limit 6`,
      [ctx.sessionId, night.catalogOpen],
    ),
    pool.query<TrackRow>(
      `select id, title, artist, genre, bpm, camelot_key, blocked
         from public.library_tracks where venue_id = $1 and blocked = false
        order by created_at desc limit 6`,
      [ctx.venueId],
    ),
  ]);
  measureLater(trending);

  const easiest = { easy: 0, medium: 1, unknown: 2, hard: 3 } as const;
  const fits = allRes.rows
    .map((row) => dto(row, "library"))
    .filter((d) => d.fitLabel === "fits" && d.available)
    .sort((a, b) => easiest[a.transition] - easiest[b.transition])
    .slice(0, 8);

  const response: SearchResponse = {
    sections: [
      { key: "trending" as const, tracks: trending.map((h) => dto(fromHit(h), "catalog")) },
      { key: "fits" as const, tracks: fits },
      { key: "popular" as const, tracks: popularRes.rows.map((r) => dto(r, r.source)) },
      { key: "recent" as const, tracks: recentRes.rows.map((r) => dto(r, "library")) },
    ].filter((s) => s.tracks.length > 0),
  };
  return NextResponse.json(response);
}
