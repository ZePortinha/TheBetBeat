import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withTransaction } from "@/lib/db";
import {
  insertLibraryTracks,
  librarySummary,
  listLibraryGroups,
  listLibraryTracks,
} from "@/lib/catalog/library";
import { apiError, hasVenueAccess, requireStaffApi } from "../_lib/auth";
import { audit, correlationId, readJson, toTrackInput, trackFieldsSchema } from "./_lib/schema";

export const dynamic = "force-dynamic";

/**
 * The DJ's own library (2026-10-11).
 *   GET  ?venueId&view=tracks|artists|albums|styles&q&artist&album&genre
 *        songs (or artists / albums / styles with counts) + totals
 *   POST { venueId, ...song } add one song by hand (409 when it is already there)
 * Venue-scoped to the caller's cockpit roles; every write audited.
 */
const querySchema = z
  .object({
    venueId: z.string().uuid(),
    view: z.enum(["tracks", "artists", "albums", "styles"]).default("tracks"),
    q: z.string().trim().max(80).optional(),
    artist: z.string().trim().max(160).optional(),
    album: z.string().trim().max(120).optional(),
    genre: z.string().trim().max(64).optional(),
  })
  .strict();

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStaffApi();
  if (!auth.ok) return auth.response;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return apiError(400, "invalid_query");
  const { venueId, view, ...rest } = parsed.data;
  if (!hasVenueAccess(auth.ctx, venueId)) return apiError(403, "forbidden");
  const filter = Object.fromEntries(Object.entries(rest).filter(([, v]) => v)) as typeof rest;

  try {
    const [summary, items] = await Promise.all([
      librarySummary(venueId),
      view === "tracks" ? listLibraryTracks(venueId, filter) : listLibraryGroups(venueId, view, filter),
    ]);
    return NextResponse.json(view === "tracks" ? { summary, tracks: items } : { summary, groups: items });
  } catch (error) {
    const id = correlationId();
    console.error(`[cockpit:library] ${id}: ${error instanceof Error ? error.message : "unknown"}`);
    return apiError(500, "internal", id);
  }
}

const postSchema = trackFieldsSchema.extend({ venueId: z.string().uuid() }).strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStaffApi();
  if (!auth.ok) return auth.response;
  const parsed = postSchema.safeParse(await readJson(request));
  if (!parsed.success) return apiError(400, "invalid_body");
  const { venueId, ...fields } = parsed.data;
  if (!hasVenueAccess(auth.ctx, venueId)) return apiError(403, "forbidden");

  try {
    const added = await withTransaction(async (client) => {
      const count = await insertLibraryTracks(client, venueId, [toTrackInput(fields)]);
      if (count > 0) {
        await audit(client, auth.ctx.actor, "library.track_added", venueId, { title: fields.title, artist: fields.artist });
      }
      return count;
    });
    if (added === 0) return apiError(409, "duplicate");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const id = correlationId();
    console.error(`[cockpit:library] ${id}: ${error instanceof Error ? error.message : "unknown"}`);
    return apiError(500, "internal", id);
  }
}
