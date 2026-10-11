import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { removeLibraryTrack, updateLibraryTrack } from "@/lib/catalog/library";
import { apiError, hasVenueAccess, requireStaffApi } from "../../_lib/auth";
import { audit, correlationId, readJson, toTrackInput, trackFieldsSchema } from "../_lib/schema";

/**
 * PATCH  /api/cockpit/library/[id] { venueId, ...song } — edit a song.
 * DELETE /api/cockpit/library/[id]?venueId — remove it (one guests already
 * bid on is blocked instead, so its bids and receipts keep their song).
 */
const idSchema = z.string().uuid();
const patchSchema = trackFieldsSchema.extend({ venueId: z.string().uuid() }).strict();

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireStaffApi();
  if (!auth.ok) return auth.response;
  const id = idSchema.safeParse((await params).id);
  const parsed = patchSchema.safeParse(await readJson(request));
  if (!id.success || !parsed.success) return apiError(400, "invalid_body");
  const { venueId, ...fields } = parsed.data;
  if (!hasVenueAccess(auth.ctx, venueId)) return apiError(403, "forbidden");

  try {
    const outcome = await withTransaction(async (client) => {
      const result = await updateLibraryTrack(client, venueId, id.data, toTrackInput(fields));
      if (result === "ok") await audit(client, auth.ctx.actor, "library.track_updated", venueId, { trackId: id.data });
      return result;
    });
    if (outcome === "not_found") return apiError(404, "not_found");
    if (outcome === "duplicate") return apiError(409, "duplicate");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const cid = correlationId();
    console.error(`[cockpit:library] ${cid}: ${error instanceof Error ? error.message : "unknown"}`);
    return apiError(500, "internal", cid);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireStaffApi();
  if (!auth.ok) return auth.response;
  const id = idSchema.safeParse((await params).id);
  const venueId = idSchema.safeParse(new URL(request.url).searchParams.get("venueId"));
  if (!id.success || !venueId.success) return apiError(400, "invalid_query");
  if (!hasVenueAccess(auth.ctx, venueId.data)) return apiError(403, "forbidden");

  try {
    const outcome = await withTransaction(async (client) => {
      const result = await removeLibraryTrack(client, venueId.data, id.data);
      if (result !== "not_found") {
        await audit(client, auth.ctx.actor, `library.track_${result}`, venueId.data, { trackId: id.data });
      }
      return result;
    });
    if (outcome === "not_found") return apiError(404, "not_found");
    return NextResponse.json({ ok: true, outcome });
  } catch (error) {
    const cid = correlationId();
    console.error(`[cockpit:library] ${cid}: ${error instanceof Error ? error.message : "unknown"}`);
    return apiError(500, "internal", cid);
  }
}
