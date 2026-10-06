import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { apiError } from "../../../_lib/http";
import { getGuestIdentity } from "../../../_lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/guest/auction/intents/[id] — own bid waiting for its MB WAY money. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await getGuestIdentity(request);
  if (!identity) return apiError("unauthorized", 401);
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return apiError("not_found", 404);
  const res = await getPool().query<{ status: string; reason: string | null; expires_at: Date | null }>(
    `select i.status, i.reason, p.expires_at
       from public.auction_intents i
       left join public.payments p on p.intent_id = i.id
      where i.id = $1 and i.guest_id = $2`,
    [id, identity.guestId],
  );
  const row = res.rows[0];
  if (!row) return apiError("not_found", 404);
  return NextResponse.json({
    status: row.status,
    reason: row.reason,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
  });
}
