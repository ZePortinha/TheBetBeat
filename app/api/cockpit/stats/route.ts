import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { parseSessionConfig } from "@/lib/domain/config";
import { computeSplit } from "@/lib/ledger/split";
import { sessionStatement, type LedgerEntryRow } from "@/lib/ledger/balances";
import { apiError, authorizeSession, requireStaffApi } from "../_lib/auth";

const querySchema = z.object({ sessionId: z.string().uuid() }).strict();

/**
 * GET /api/cockpit/stats?sessionId= — Sessão & Receita read model (B7):
 * revenue per hour, acceptance rate, refunds by reason, top tracks and
 * payout status, from tonight's slot auctions (2026-10-05). Only THIS
 * session's numbers ever leave the server (B12.2 "o DJ … não as finanças
 * da casa").
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

  const pool = getPool();
  try {
    const [hourly, acceptance, refunds, topTracks, pending, payouts, ledger, cfg] =
      await Promise.all([
        // Winners that played (or are playing), by the hour they played.
        pool.query<{ hour: Date; total: string; n: string }>(
          `select date_trunc('hour', coalesce(s.played_at, s.playing_at)) as hour,
                  sum(w.total_cents)::bigint as total, count(*)::bigint as n
             from public.auction_slots s
             join public.auction_bids w on w.id = s.winning_bid_id
            where s.session_id = $1 and s.play_status in ('playing', 'played')
            group by 1 order by 1`,
          [scope.sessionId],
        ),
        // Winners the DJ took vs turned down or let expire.
        pool.query<{ accepted: string; declined: string }>(
          `select count(*) filter (where s.play_status in ('accepted', 'playing', 'played'))::bigint as accepted,
                  count(*) filter (where s.refund_reason in ('rejected_by_dj', 'not_played'))::bigint as declined
             from public.auction_slots s
            where s.session_id = $1`,
          [scope.sessionId],
        ),
        // Money that went back to guests tonight, by reason.
        pool.query<{ reason: string; n: string; total: string }>(
          `select split_part(rf.reason, ':', 1) as reason, count(*)::bigint as n,
                  sum(rf.amount_cents)::bigint as total
             from public.refunds rf
             join public.payments p on p.id = rf.payment_id
             left join public.requests r on r.id = rf.request_id
            where coalesce(p.session_id, r.session_id) = $1
            group by 1 order by total desc`,
          [scope.sessionId],
        ),
        pool.query<{ title: string; artist: string; n: string; total: string }>(
          `select w.track_title as title, w.track_artist as artist,
                  count(*)::bigint as n, sum(w.total_cents)::bigint as total
             from public.auction_slots s
             join public.auction_bids w on w.id = s.winning_bid_id
            where s.session_id = $1 and s.play_status in ('locked', 'accepted', 'playing', 'played')
            group by 1, 2 order by total desc limit 5`,
          [scope.sessionId],
        ),
        // Winners still to play: the DJ share they will add once played.
        pool.query<{ total: string }>(
          `select coalesce(sum(w.total_cents), 0)::bigint as total
             from public.auction_slots s
             join public.auction_bids w on w.id = s.winning_bid_id
            where s.session_id = $1 and s.play_status in ('locked', 'accepted', 'playing')`,
          [scope.sessionId],
        ),
        pool.query<{ recipient_type: string; amount_cents: string; status: string }>(
          `select recipient_type, amount_cents::bigint as amount_cents, status
             from public.payouts where session_id = $1`,
          [scope.sessionId],
        ),
        pool.query<LedgerEntryRow>(
          `select account, amount_cents from public.ledger_entries
            where session_id = $1`,
          [scope.sessionId],
        ),
        pool.query<{ config: unknown; venue_share_bps: number }>(
          `select coalesce(ss.config, '{}'::jsonb) as config,
                  coalesce(ss.venue_share_bps, 5000) as venue_share_bps
             from public.sessions s
             left join public.session_settings ss on ss.session_id = s.id
            where s.id = $1`,
          [scope.sessionId],
        ),
      ]);

    const config = parseSessionConfig(cfg.rows[0]?.config ?? {});
    const venueShareBps = cfg.rows[0]?.venue_share_bps ?? 5000;
    const statement = sessionStatement(ledger.rows);
    const accepted = Number(acceptance.rows[0]?.accepted ?? 0);
    const declined = Number(acceptance.rows[0]?.declined ?? 0);
    const decided = accepted + declined;

    return NextResponse.json({
      revenuePerHour: hourly.rows
        .filter((r) => r.hour !== null)
        .map((r) => ({
          hour: r.hour.toISOString(),
          totalCents: Number(r.total),
          count: Number(r.n),
        })),
      acceptance: {
        accepted,
        decided,
        rate: decided > 0 ? accepted / decided : null,
      },
      refundsByReason: refunds.rows.map((r) => ({
        reason: r.reason,
        count: Number(r.n),
        totalCents: Number(r.total),
      })),
      topTracks: topTracks.rows.map((r) => ({
        title: r.title,
        artist: r.artist,
        count: Number(r.n),
        totalCents: Number(r.total),
      })),
      payouts: payouts.rows.map((r) => ({
        recipient: r.recipient_type,
        amountCents: Number(r.amount_cents),
        status: r.status,
      })),
      statement: {
        gmv: statement.gmv,
        refunds: statement.refunds,
        djNet: statement.djNet,
      },
      // DJ share already earned plus the share of winners still to play
      // (money sitting in guest wallets is not the DJ's until it is spent).
      djShareProjection:
        statement.djNet +
        computeSplit(Number(pending.rows[0]?.total ?? 0), config.betbeatFeeBps, venueShareBps).djCents,
    });
  } catch (error) {
    const correlationId = Math.random().toString(16).slice(2, 10);
    console.error(
      `[cockpit:stats] ${correlationId}: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return apiError(500, "internal", correlationId);
  }
}
