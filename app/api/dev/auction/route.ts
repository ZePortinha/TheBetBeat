import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { openExtraSlot, tickAuctions } from "@/lib/auction/service";

export const dynamic = "force-dynamic";

/**
 * DEV-ONLY auction driver (404 in production), for E2E tests and manual
 * checks without waiting for the night's schedule or running the worker:
 *
 *   { action: "open", sessionId, closesInSec }  a live night + an open
 *       auction closing in N seconds (any other open auction is cancelled)
 *   { action: "close", slotId }                 that auction ends now (+ tick)
 *   { action: "tick" }                          one worker tick, right now
 *   { action: "forget-mic", sessionId }         earlier mic announcements
 *       leave the rolling hour (the cap would otherwise turn the next big
 *       win into "screen only" when the suite runs twice within an hour)
 */
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), sessionId: z.string().uuid(), closesInSec: z.number().int().min(5).max(7200) }).strict(),
  z.object({ action: z.literal("close"), slotId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("tick") }).strict(),
  z.object({ action: z.literal("forget-mic"), sessionId: z.string().uuid() }).strict(),
]);

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: { code: "not_found", id: "dev" } }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "invalid_request", id: "dev" } }, { status: 400 });
  const body = parsed.data;
  const now = Date.now();

  if (body.action === "tick") return NextResponse.json(await tickAuctions(now));
  if (body.action === "forget-mic") {
    const res = await getPool().query(
      `update public.auction_slots set closed_at = closed_at - interval '1 hour'
        where session_id = $1 and announce and closed_at > to_timestamp($2 / 1000.0) - interval '1 hour'`,
      [body.sessionId, now],
    );
    return NextResponse.json({ forgotten: res.rowCount ?? 0 });
  }
  if (body.action === "close") {
    await getPool().query(
      `update public.auction_slots set closes_at = to_timestamp($2 / 1000.0) where id = $1 and status = 'open'`,
      [body.slotId, now],
    );
    return NextResponse.json(await tickAuctions(now));
  }

  const pool = getPool();
  // A live night with its plan already made (so the tick adds no slots).
  await pool.query(
    `update public.sessions
        set status = 'live', ended_at = null,
            starts_at = least(starts_at, now() - interval '1 hour'),
            ends_at = greatest(ends_at, now() + interval '3 hours'),
            auction_config = coalesce(auction_config, '{}'::jsonb)
      where id = $1`,
    [body.sessionId],
  );
  // Earlier auctions end now (the tick settles them: winner or no winner),
  // so the new one is the only one open.
  await pool.query(
    `update public.auction_slots set closes_at = to_timestamp($2 / 1000.0) where session_id = $1 and status = 'open'`,
    [body.sessionId, now],
  );
  await pool.query(
    `update public.auction_slots set status = 'cancelled' where session_id = $1 and status in ('scheduled', 'paused')`,
    [body.sessionId],
  );
  await tickAuctions(now);
  const slotId = await openExtraSlot(body.sessionId, "system:dev", now);
  if (!slotId) return NextResponse.json({ error: { code: "session_not_live", id: "dev" } }, { status: 409 });
  await pool.query(
    `update public.auction_slots
        set scheduled_close_at = to_timestamp($2 / 1000.0), closes_at = to_timestamp($2 / 1000.0)
      where id = $1`,
    [slotId, now + body.closesInSec * 1000],
  );
  return NextResponse.json({ slotId });
}
