import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { openExtraSlot, publicAuctionState } from "@/lib/auction/service";
import { wantBpm } from "@/lib/catalog/service";
import { apiError, authorizeSession, requireStaffApi } from "../_lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/cockpit/auction?sessionId= — the DJ's auction panel: the public
 * state (open auction, "A seguir", winners) plus every slot of the night
 * with its status, and the winner alerts (mic ≥ 150 €, special ≥ 300 €).
 * `contenders`: the songs being bid on in each open auction with their
 * BPM and key, so the DJ can prepare the mix before it closes.
 * POST — "abrir leilão agora": an extra slot at the current price.
 */
const querySchema = z.object({ sessionId: z.string().uuid() }).strict();

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStaffApi();
  if (!auth.ok) return auth.response;
  const parsed = querySchema.safeParse({ sessionId: new URL(request.url).searchParams.get("sessionId") ?? undefined });
  if (!parsed.success) return apiError(400, "invalid_query");
  const scope = await authorizeSession(auth.ctx, parsed.data.sessionId);
  if (!scope) return apiError(403, "forbidden");

  const now = Date.now();
  const [pub, slots, contenders] = await Promise.all([
    publicAuctionState(scope.sessionId, now),
    getPool().query<{
      id: string;
      kind: string;
      phase: string;
      opens_at: Date;
      closes_at: Date;
      status: string;
      outcome: string | null;
      play_status: string | null;
      min_price_cents: number;
      has_bids: boolean;
      recognition: string | null;
      announce: boolean;
      announced_at: Date | null;
      closed_at: Date | null;
      track_title: string | null;
      track_artist: string | null;
      display_label: string | null;
      total_cents: number | null;
      track_bpm: string | null;
      transition: string | null;
    }>(
      `select s.id, s.kind, s.phase, s.opens_at, s.closes_at, s.status, s.outcome, s.play_status,
              s.min_price_cents, s.recognition, s.announce, s.announced_at, s.closed_at,
              exists (select 1 from public.auction_bids b where b.slot_id = s.id and b.status = 'leading') as has_bids,
              w.track_title, w.track_artist, w.display_label, w.total_cents, w.track_bpm, w.transition
         from public.auction_slots s
         left join public.auction_bids w on w.id = s.winning_bid_id
        where s.session_id = $1
        order by s.closes_at`,
      [scope.sessionId],
    ),
    // Every song still in the running per open auction, highest first. A
    // catalog song bid on before its BPM was known picks it up from the cache.
    getPool().query<{
      slot_id: string;
      bid_id: string;
      status: string;
      track_title: string;
      track_artist: string;
      track_genre: string | null;
      bpm: string | null;
      track_key: string | null;
      total_cents: number;
      transition: string | null;
      catalog_track_id: string | null;
    }>(
      `select b.slot_id, b.id as bid_id, b.status, b.track_title, b.track_artist, b.track_genre,
              coalesce(b.track_bpm, t.bpm) as bpm, coalesce(b.track_key, t.camelot_key) as track_key,
              b.total_cents, b.transition, b.catalog_track_id
         from public.auction_bids b
         join public.auction_slots s on s.id = b.slot_id
         left join public.tracks t on t.id = b.catalog_track_id
        where s.session_id = $1 and s.status = 'open' and b.status in ('leading', 'outbid')
        order by b.slot_id, b.total_cents desc, b.created_at`,
      [scope.sessionId],
    ),
  ]);
  if (!pub) return apiError(404, "not_found");

  const unmeasured = contenders.rows
    .filter((c) => c.bpm === null && c.catalog_track_id !== null)
    .map((c) => c.catalog_track_id as string);
  void wantBpm(unmeasured, now).catch(() => undefined);
  const bySlot: Record<string, Array<{
    bidId: string;
    leading: boolean;
    trackTitle: string;
    trackArtist: string;
    genre: string | null;
    bpm: number | null;
    camelotKey: string | null;
    totalCents: number;
    transition: string | null;
  }>> = {};
  for (const c of contenders.rows) {
    const list = (bySlot[c.slot_id] ??= []);
    if (list.length >= 5) continue;
    list.push({
      bidId: c.bid_id,
      leading: c.status === "leading",
      trackTitle: c.track_title,
      trackArtist: c.track_artist,
      genre: c.track_genre,
      bpm: c.bpm === null ? null : Number(c.bpm),
      camelotKey: c.track_key,
      totalCents: c.total_cents,
      transition: c.transition,
    });
  }

  return NextResponse.json({
    ...pub,
    contenders: bySlot,
    slots: slots.rows.map((s) => ({
      id: s.id,
      kind: s.kind,
      phase: s.phase,
      opensAt: s.opens_at.toISOString(),
      closesAt: s.closes_at.toISOString(),
      status: s.status,
      outcome: s.outcome,
      playStatus: s.play_status,
      minPriceCents: s.min_price_cents,
      hasBids: s.has_bids,
      recognition: s.recognition,
      announce: s.announce,
      announced: s.announced_at !== null,
      closedAt: s.closed_at ? s.closed_at.toISOString() : null,
      // The DJ sees the chosen name even under the screen tier (to call it out).
      winner: s.track_title
        ? {
            trackTitle: s.track_title,
            trackArtist: s.track_artist,
            label: s.display_label,
            totalCents: s.total_cents,
            bpm: s.track_bpm === null ? null : Number(s.track_bpm),
            transition: s.transition,
          }
        : null,
    })),
  });
}

const postSchema = z.object({ sessionId: z.string().uuid() }).strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStaffApi();
  if (!auth.ok) return auth.response;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError(400, "invalid_body");
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) return apiError(400, "invalid_body");
  const scope = await authorizeSession(auth.ctx, parsed.data.sessionId);
  if (!scope) return apiError(403, "forbidden");
  const slotId = await openExtraSlot(scope.sessionId, auth.ctx.actor, Date.now());
  if (!slotId) return apiError(409, "session_not_live");
  return NextResponse.json({ ok: true, slotId });
}
