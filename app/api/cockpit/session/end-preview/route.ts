import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { apiError, authorizeSession, requireStaffApi } from "../../_lib/auth";

const querySchema = z.object({ sessionId: z.string().uuid() }).strict();

/**
 * GET /api/cockpit/session/end-preview?sessionId= — what "Terminar set"
 * gives back (B7 Definições): every guest of tonight with money in open
 * bids, in winners not played yet or in runner-up money waiting for an
 * auction (a winner already playing counts as played), plus any older
 * tier request still active. It goes back to their balance, which they
 * withdraw within 7 days (balances are no longer refunded at the end of
 * the night, 2026-10-10).
 * `count` = people who get money back, `refundCents` = how much.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStaffApi();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    sessionId: url.searchParams.get("sessionId") ?? undefined,
  });
  if (!parsed.success) return apiError(400, "invalid_query");

  const scope = await authorizeSession(auth.ctx, parsed.data.sessionId);
  if (!scope) return apiError(403, "forbidden");

  try {
    const res = await getPool().query<{ n: string; total: string }>(
      `with held as (
         select c.guest_id, sum(c.amount_cents) as cents
           from public.auction_contributions c
           join public.auction_slots s on s.id = c.slot_id
          where s.session_id = $1 and c.returned_at is null and c.spent_at is null
            and s.play_status is distinct from 'playing'
          group by c.guest_id
       ),
       rolling as (
         select sh.guest_id, sum(sh.amount_cents) as cents
           from public.auction_rollover_shares sh
           join public.auction_rollovers r on r.id = sh.rollover_id
          where r.session_id = $1 and r.status = 'held'
          group by sh.guest_id
       ),
       per_guest as (
         select guest_id, sum(cents) as cents
           from (select * from held union all select * from rolling) x
          group by guest_id
       ),
       legacy as (
         select count(*) as n, coalesce(sum(amount_cents), 0) as total
           from public.requests
          where session_id = $1 and status in ('pending_payment', 'paid', 'accepted', 'playing')
       )
       select ((select count(*) from per_guest where cents > 0) + (select n from legacy))::bigint as n,
              ((select coalesce(sum(cents), 0) from per_guest where cents > 0) + (select total from legacy))::bigint as total`,
      [scope.sessionId],
    );
    const row = res.rows[0];
    return NextResponse.json({
      count: Number(row?.n ?? 0),
      refundCents: Number(row?.total ?? 0),
    });
  } catch (error) {
    const correlationId = Math.random().toString(16).slice(2, 10);
    console.error(
      `[cockpit:end-preview] ${correlationId}: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return apiError(500, "internal", correlationId);
  }
}
