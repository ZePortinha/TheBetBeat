import { z } from "zod";
import { getPool } from "@/lib/db";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { apiError, rateLimitedResponse } from "../../../_lib/http";
import { getGuestIdentity } from "../../../_lib/auth";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ slotId: z.string().uuid() });

/** Only the catalog's own CDN: this is never a general-purpose fetcher (SSRF). */
const COVER_HOSTS = new Set(["cdn-images.dzcdn.net", "e-cdns-images.dzcdn.net"]);
const MAX_BYTES = 2_000_000;

/**
 * GET /api/guest/auction/[slotId]/cover — the winning song's album art,
 * served from our origin so the winner video (drawn on a canvas in the
 * guest's browser) can be exported. Only for whoever owns or backed the
 * winning bid, like the share card.
 */
export async function GET(request: Request, context: { params: Promise<{ slotId: string }> }) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);
  if (!rateLimit(`cover:${identity.guestId}`, LIMITS.search.limit, LIMITS.search.windowMs).ok) return rateLimitedResponse();

  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return apiError("invalid_request", 400);

  const res = await getPool().query<{ cover_url: string | null }>(
    `select coalesce(ct.cover_url,
                     (select t.cover_url from public.tracks t
                       where lower(t.title) = lower(b.track_title) and lower(t.artist) = lower(b.track_artist)
                         and t.cover_url is not null
                       limit 1)) as cover_url
       from public.auction_slots s
       join public.auction_bids b on b.id = s.winning_bid_id
       left join public.tracks ct on ct.id = b.catalog_track_id
      where s.id = $1
        and (b.owner_guest_id = $2
             or exists (select 1 from public.auction_contributions c where c.bid_id = b.id and c.guest_id = $2))`,
    [params.data.slotId, identity.guestId],
  );
  const raw = res.rows[0]?.cover_url;
  if (!raw) return apiError("not_found", 404);

  let url: URL;
  try {
    url = new URL(raw.replace(/\/\d+x\d+-/, "/500x500-"));
  } catch {
    return apiError("not_found", 404);
  }
  if (url.protocol !== "https:" || !COVER_HOSTS.has(url.hostname)) return apiError("not_found", 404);

  const upstream = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) }).catch(() => null);
  const type = upstream?.headers.get("content-type") ?? "";
  if (!upstream?.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return apiError("not_found", 404);
  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return apiError("not_found", 404);

  return new Response(body, {
    headers: { "content-type": type, "cache-control": "private, max-age=3600" },
  });
}
