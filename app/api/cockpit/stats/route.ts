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
 * payout status. Only THIS session's numbers ever leave the server
 * (B12.2 "o DJ … não as finanças da casa").
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
    const [hourly, acceptance, refunds, topTracks, payouts, ledger, cfg] =
      await Promise.all([
        pool.query<{ hour: Date; total: string; n: string }>(
          `select date_trunc('hour', coalesce(played_at, playing_at)) as hour,
                  sum(amount_cents)::bigint as total, count(*)::bigint as n
             from public.requests
            where session_id = $1 and status in ('playing', 'played')
            group by 1 order by 1`,
          [scope.sessionId],
        ),
        pool.query<{ accepted: string; declined: string }>(
          `select count(*) filter (where accepted_at is not null)::bigint as accepted,
                  count(*) filter (where status = 'refunded'
                    and close_reason in ('rejected_by_dj', 'dj_timeout'))::bigint as declined
             from public.requests
            where session_id = $1`,
          [scope.sessionId],
        ),
        pool.query<{ reason: string | null; n: string; total: string }>(
          `select close_reason as reason, count(*)::bigint as n,
                  sum(refunded_cents)::bigint as total
             from public.requests
            where session_id = $1 and refunded_cents > 0
            group by close_reason order by total desc`,
          [scope.sessionId],
        ),
        pool.query<{ title: string; artist: string; n: string; total: string }>(
          `select track_title as title, track_artist as artist,
                  count(*)::bigint as n, sum(amount_cents)::bigint as total
             from public.requests
            where session_id = $1 and status in ('accepted', 'playing', 'played')
            group by 1, 2 order by total desc limit 5`,
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
        // Partial SLA refunds leave close_reason null — label them.
        reason: r.reason ?? "sla_missed",
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
      // Live projection of the DJ share for value not yet recognized.
      djShareProjection: computeSplit(
        statement.gmv - statement.refunds >= 0 ? statement.gmv - statement.refunds : 0,
        config.betbeatFeeBps,
        venueShareBps,
      ).djCents,
    });
  } catch (error) {
    const correlationId = Math.random().toString(16).slice(2, 10);
    console.error(
      `[cockpit:stats] ${correlationId}: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return apiError(500, "internal", correlationId);
  }
}
