import "server-only";

/**
 * Public session state DTO (BRIEF B6 screens 1, 7 e 8) — ONLY public
 * data: now playing, the anonymous upcoming queue and the opt-in top of
 * the night. Amounts are never included (hidden by default, B6.8); guest
 * handles only appear with `ranking_optin`.
 */

import { getPool } from "@/lib/db";
import { orderQueue } from "@/lib/domain/ordering";
import type { Tier } from "@/lib/domain/types";
import type { GuestSessionContext } from "./context";

export interface PublicNowPlaying {
  title: string;
  artist: string;
  genre: string | null;
  bpm: number | null;
  /** ISO UTC. */
  startedAt: string;
  durationSec: number | null;
  /** Album art when we know it (catalog), for the hero background. */
  coverUrl: string | null;
  /**
   * Who chose it: null = the DJ's own pick; otherwise the auction winner,
   * shown the way they chose when bidding (label null = anonymous).
   */
  pickedBy: { label: string | null } | null;
}

export interface PublicUpNextItem {
  title: string;
  artist: string;
  tier: Tier;
}

export interface PublicSessionState {
  session: {
    name: string;
    venueName: string;
    djName: string | null;
    status: string;
    requestsOpen: boolean;
    endsAt: string;
  };
  nowPlaying: PublicNowPlaying | null;
  upNext: PublicUpNextItem[];
  top: {
    tracks: Array<{ title: string; artist: string; count: number }>;
    guests: Array<{ handle: string; count: number }>;
  };
}

export async function buildSessionState(
  ctx: GuestSessionContext,
): Promise<PublicSessionState> {
  const pool = getPool();

  const [nowRes, queueRes, topTracksRes, topGuestsRes] = await Promise.all([
    pool.query<{
      title: string;
      artist: string;
      genre: string | null;
      bpm: string | null;
      duration_sec: number | null;
      started_at: Date;
    }>(
      `select title, artist, genre, bpm, duration_sec, started_at
         from public.session_tracks
        where session_id = $1
        order by started_at desc
        limit 1`,
      [ctx.sessionId],
    ),
    pool.query<{
      id: string;
      track_title: string;
      track_artist: string;
      tier: Tier;
      amount_cents: number;
      paid_at: Date | null;
      deadline_at: Date | null;
    }>(
      `select id, track_title, track_artist, tier, amount_cents, paid_at, deadline_at
         from public.requests
        where session_id = $1 and status in ('paid', 'accepted')`,
      [ctx.sessionId],
    ),
    pool.query<{ title: string; artist: string; n: string }>(
      `select track_title as title, track_artist as artist, count(*)::bigint as n
         from public.requests
        where session_id = $1
          and status in ('paid', 'accepted', 'playing', 'played')
        group by 1, 2
        order by n desc, min(created_at)
        limit 5`,
      [ctx.sessionId],
    ),
    pool.query<{ handle: string; n: string }>(
      `select g.handle, count(*)::bigint as n
         from public.requests r
         join public.guests g on g.id = r.guest_id
        where r.session_id = $1
          and r.status in ('paid', 'accepted', 'playing', 'played')
          and g.ranking_optin and g.handle is not null
        group by g.handle
        order by n desc
        limit 5`,
      [ctx.sessionId],
    ),
  ]);

  const nowRow = nowRes.rows[0];
  const now = Date.now();
  // The auction that put it on (same instant as the play), and its cover.
  const pick = nowRow
    ? (
        await pool.query<{ slot_id: string | null; display_label: string | null; cover_url: string | null }>(
          `select s.id as slot_id, b.display_label,
                  coalesce(ct.cover_url,
                           (select t.cover_url from public.tracks t
                             where lower(t.title) = lower($3) and lower(t.artist) = lower($4) and t.cover_url is not null
                             limit 1)) as cover_url
             from (select 1) one
             left join public.auction_slots s on s.session_id = $1 and s.playing_at = $2
             left join public.auction_bids b on b.id = s.winning_bid_id
             left join public.tracks ct on ct.id = b.catalog_track_id
            limit 1`,
          [ctx.sessionId, nowRow.started_at, nowRow.title, nowRow.artist],
        )
      ).rows[0]
    : undefined;

  const ordered = orderQueue(
    queueRes.rows.map((r) => ({
      id: r.id,
      tier: r.tier,
      amountCents: r.amount_cents,
      paidAt: (r.paid_at ?? new Date(now)).toISOString(),
      deadlineAt: r.deadline_at ? r.deadline_at.toISOString() : null,
      title: r.track_title,
      artist: r.track_artist,
    })),
    now,
  );

  return {
    session: {
      name: ctx.sessionName,
      venueName: ctx.venueName,
      djName: ctx.djName,
      status: ctx.status,
      requestsOpen: ctx.requestsOpen,
      endsAt: ctx.endsAt,
    },
    nowPlaying: nowRow
      ? {
          title: nowRow.title,
          artist: nowRow.artist,
          genre: nowRow.genre,
          bpm: nowRow.bpm !== null ? Number(nowRow.bpm) : null,
          startedAt: nowRow.started_at.toISOString(),
          durationSec: nowRow.duration_sec,
          coverUrl: pick?.cover_url ?? null,
          pickedBy: pick?.slot_id ? { label: pick.display_label } : null,
        }
      : null,
    // Anonymous by design: track + tier only, never guest data or amounts.
    upNext: ordered.slice(0, 8).map((r) => ({
      title: r.title,
      artist: r.artist,
      tier: r.tier,
    })),
    top: {
      tracks: topTracksRes.rows.map((r) => ({
        title: r.title,
        artist: r.artist,
        count: Number(r.n),
      })),
      guests: topGuestsRes.rows.map((r) => ({
        handle: r.handle,
        count: Number(r.n),
      })),
    },
  };
}
