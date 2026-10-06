import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { djSlotAction } from "@/lib/auction/service";
import { apiError, hasVenueAccess, requireStaffApi } from "../../_lib/auth";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    action: z.enum(["accept", "reject", "playing", "played", "pause", "resume", "cancel", "announced"]),
  })
  .strict();

/** POST /api/cockpit/auction/[slotId] — every DJ decision on a slot (B1). */
export async function POST(request: NextRequest, props: { params: Promise<{ slotId: string }> }): Promise<NextResponse> {
  const auth = await requireStaffApi();
  if (!auth.ok) return auth.response;
  const { slotId } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(slotId)) return apiError(403, "forbidden");
  const res = await getPool().query<{ venue_id: string }>(`select venue_id from public.auction_slots where id = $1`, [slotId]);
  const venueId = res.rows[0]?.venue_id;
  if (!venueId || !hasVenueAccess(auth.ctx, venueId)) return apiError(403, "forbidden");

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError(400, "invalid_body");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return apiError(400, "invalid_body");

  const outcome = await djSlotAction(slotId, parsed.data.action, auth.ctx.actor, Date.now());
  if (!outcome.ok) return apiError(409, outcome.error);
  return NextResponse.json(outcome);
}
