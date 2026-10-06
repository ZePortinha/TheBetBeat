import { z } from "zod";
import { getPool } from "@/lib/db";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { apiError, rateLimitedResponse } from "../../../_lib/http";
import { getGuestIdentity } from "../../../_lib/auth";
import { shareCardResponse } from "../../../_lib/share-card";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ slotId: z.string().uuid() });
const querySchema = z.object({ format: z.enum(["story", "square"]).default("story") });

/**
 * GET /api/guest/auction/[slotId]/card?format=story|square — the
 * "Vencedor do leilão" image for Instagram Stories. Only for whoever owns
 * or backed the winning bid.
 */
export async function GET(request: Request, context: { params: Promise<{ slotId: string }> }) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);
  if (!rateLimit(`card:${identity.guestId}`, LIMITS.search.limit, LIMITS.search.windowMs).ok) return rateLimitedResponse();

  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return apiError("invalid_request", 400);
  const query = querySchema.safeParse({ format: new URL(request.url).searchParams.get("format") ?? "story" });
  if (!query.success) return apiError("invalid_request", 400);

  const res = await getPool().query<{
    track_title: string;
    track_artist: string;
    cover_url: string | null;
    venue_name: string;
    closed_at: Date | null;
    locale: string | null;
  }>(
    `select b.track_title, b.track_artist, v.name as venue_name, s.closed_at,
            (select g.locale from public.guests g where g.id = $2) as locale,
            coalesce(ct.cover_url,
                     (select t.cover_url from public.tracks t
                       where lower(t.title) = lower(b.track_title) and lower(t.artist) = lower(b.track_artist)
                         and t.cover_url is not null
                       limit 1)) as cover_url
       from public.auction_slots s
       join public.auction_bids b on b.id = s.winning_bid_id
       join public.venues v on v.id = s.venue_id
       left join public.tracks ct on ct.id = b.catalog_track_id
      where s.id = $1
        and (b.owner_guest_id = $2
             or exists (select 1 from public.auction_contributions c where c.bid_id = b.id and c.guest_id = $2))`,
    [params.data.slotId, identity.guestId],
  );
  const row = res.rows[0];
  if (!row) return apiError("not_found", 404);

  const locale = row.locale === "en" ? "en" : "pt-PT";
  return shareCardResponse({
    format: query.data.format,
    headline: locale === "en" ? "Auction winner" : "Vencedor do leilão",
    trackTitle: row.track_title,
    trackArtist: row.track_artist,
    coverUrl: row.cover_url,
    venueName: row.venue_name,
    at: row.closed_at ?? new Date(),
    locale,
  });
}
