import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { loadNight } from "@/lib/auction/service";
import { albumTracks, type CatalogAlbumHit } from "@/lib/catalog/service";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { apiError, rateLimitedResponse } from "../../_lib/http";
import { ensureGuestRow, getGuestIdentity } from "../../_lib/auth";
import { resolveGuestContext } from "../../_lib/context";
import { fromHit, loadSetContext, measureLater, toDto, type SearchTrackDto } from "../../_lib/track-dto";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  token: z.string().min(1).max(1024),
  albumId: z.string().regex(/^\d{1,20}$/),
});

export interface AlbumResponse {
  album: CatalogAlbumHit;
  tracks: SearchTrackDto[];
}

/** GET /api/guest/catalog/album?token=…&albumId=… — an album and every song on it. */
export async function GET(request: Request) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);
  if (!rateLimit(`search:${identity.guestId}`, LIMITS.search.limit, LIMITS.search.windowMs).ok) {
    return rateLimitedResponse();
  }
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    token: url.searchParams.get("token") ?? "",
    albumId: url.searchParams.get("albumId") ?? "",
  });
  if (!parsed.success) return apiError("invalid_request", 400);
  const resolved = await resolveGuestContext(parsed.data.token);
  if (!resolved.ok) return apiError("invalid_token", 404);
  const ctx = resolved.ctx;

  await ensureGuestRow(identity.guestId);
  const [set, night] = await Promise.all([loadSetContext(ctx), loadNight(getPool(), ctx.sessionId)]);
  if (!night) return apiError("session_not_live", 409);
  if (!night.catalogOpen) return apiError("not_found", 404);

  const found = await albumTracks(parsed.data.albumId).catch(() => null);
  if (!found) return apiError("not_found", 404);
  // Someone opened the album: measure every song's BPM in the background.
  measureLater(found.hits, 40);
  const response: AlbumResponse = {
    album: found.album,
    tracks: found.hits.map((h) => toDto(fromHit(h), "catalog", ctx, set, night.config.transition)),
  };
  return NextResponse.json(response);
}
