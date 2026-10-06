import { z } from "zod";
import { getPool } from "@/lib/db";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { apiError, rateLimitedResponse } from "../../../_lib/http";
import { getGuestIdentity } from "../../../_lib/auth";
import { shareCardResponse } from "../../../_lib/share-card";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({ format: z.enum(["story", "square"]).default("story") });

/**
 * GET /api/guest/requests/[id]/card?format=story|square — the shareable
 * "A minha música tocou" visual (B6.6), rasterized server-side from the
 * server-renderable ShareCard (literal colors; Satori-safe markup).
 * Fonts: Satori's bundled default — the display face falls back
 * gracefully, keeping the route dependency-free offline.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);

  const limit = rateLimit(
    `card:${identity.guestId}`,
    LIMITS.search.limit,
    LIMITS.search.windowMs,
  );
  if (!limit.ok) return rateLimitedResponse();

  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return apiError("invalid_request", 400);

  const url = new URL(request.url);
  const query = querySchema.safeParse({
    format: url.searchParams.get("format") ?? "story",
  });
  if (!query.success) return apiError("invalid_request", 400);

  const res = await getPool().query<{
    track_title: string;
    track_artist: string;
    cover_url: string | null;
    venue_name: string;
    played_at: Date | null;
    locale: string;
  }>(
    `select r.track_title, r.track_artist, r.cover_url,
            v.name as venue_name, r.played_at, g.locale
       from public.requests r
       join public.venues v on v.id = r.venue_id
       join public.guests g on g.id = r.guest_id
      where r.id = $1 and r.guest_id = $2 and r.status = 'played'`,
    [params.data.id, identity.guestId],
  );
  const row = res.rows[0];
  if (!row) return apiError("not_found", 404);

  const locale = row.locale === "en" ? "en" : "pt-PT";
  const headline = locale === "en" ? "My song played" : "A minha música tocou";

  return shareCardResponse({
    format: query.data.format,
    headline,
    trackTitle: row.track_title,
    trackArtist: row.track_artist,
    coverUrl: row.cover_url,
    venueName: row.venue_name,
    at: row.played_at ?? new Date(),
    locale,
  });
}
