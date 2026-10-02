import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { parseSessionConfig } from "@/lib/domain/config";
import { toStaffRequestDto, type RequestRow } from "@/lib/domain/dto";
import { computeSplit } from "@/lib/ledger/split";
import type { StaffRequestPayload } from "@/lib/realtime/events";
import {
  apiError,
  authorizeSession,
  hasVenueAccess,
  requireStaffApi,
} from "../_lib/auth";

/**
 * GET /api/cockpit/state[?sessionId=] — the cockpit's full read model.
 *
 * Server is the source of truth (B7 Fiabilidade): the client reconciles
 * from this endpoint after offline replays and on every reconnect. The
 * DTO is minimal (B12.4): staff card payloads carry no guest PII, and
 * the only financial figures are this session's own revenue + DJ share.
 */

const querySchema = z.object({ sessionId: z.string().uuid().optional() }).strict();

interface RequestJoinRow extends RequestRow {
  zone_name: string | null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireStaffApi();
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    sessionId: url.searchParams.get("sessionId") ?? undefined,
  });
  if (!parsed.success) return apiError(400, "invalid_query");

  const pool = getPool();
  const now = Date.now();

  try {
    // Resolve the session: explicit id (venue-scoped) or the caller's
    // venues' current live session.
    let sessionId = parsed.data.sessionId ?? null;
    if (sessionId) {
      const scope = await authorizeSession(ctx, sessionId);
      if (!scope) return apiError(403, "forbidden");
    } else {
      const venueIds = ctx.memberships
        .map((m) => m.venueId)
        .filter((v): v is string => v !== null);
      const isAdmin = ctx.memberships.some(
        (m) => m.role === "admin" && m.venueId === null,
      );
      const liveRes = isAdmin
        ? await pool.query<{ id: string }>(
            `select id from public.sessions where status = 'live'
              order by starts_at desc limit 1`,
          )
        : await pool.query<{ id: string }>(
            `select id from public.sessions
              where status = 'live' and venue_id = any($1::uuid[])
              order by starts_at desc limit 1`,
            [venueIds],
          );
      sessionId = liveRes.rows[0]?.id ?? null;
    }

    if (!sessionId) {
      return NextResponse.json({ session: null, serverNow: new Date(now).toISOString() });
    }

    const sessionRes = await pool.query<{
      id: string;
      venue_id: string;
      dj_staff_id: string | null;
      name: string;
      status: string;
      genres: string[];
      catalog_mode: string;
      starts_at: Date;
      ends_at: Date;
      requests_open: boolean;
      config: unknown;
      venue_share_bps: number;
      venue_settings: unknown;
    }>(
      `select s.id, s.venue_id, s.dj_staff_id, s.name, s.status, s.genres,
              s.catalog_mode, s.starts_at, s.ends_at, s.requests_open,
              coalesce(ss.config, '{}'::jsonb) as config,
              coalesce(ss.venue_share_bps, 5000) as venue_share_bps,
              v.settings as venue_settings
         from public.sessions s
         left join public.session_settings ss on ss.session_id = s.id
         join public.venues v on v.id = s.venue_id
        where s.id = $1`,
      [sessionId],
    );
    const session = sessionRes.rows[0];
    if (!session || !hasVenueAccess(ctx, session.venue_id)) {
      return apiError(403, "forbidden");
    }
    const config = parseSessionConfig(session.config);

    // Active requests (paid / accepted / playing) with zone names.
    const reqRes = await pool.query<RequestJoinRow>(
      `select r.*, z.name as zone_name
         from public.requests r
         left join public.zones z on z.id = r.zone_id
        where r.session_id = $1 and r.status in ('paid', 'accepted', 'playing')
        order by r.paid_at nulls last`,
      [sessionId],
    );
    const dtoCtx = {
      betbeatFeeBps: config.betbeatFeeBps,
      venueShareBps: session.venue_share_bps,
      zoneName: null as string | null,
    };
    const requests: StaffRequestPayload[] = reqRes.rows.map((row) =>
      toStaffRequestDto(row, { ...dtoCtx, zoneName: row.zone_name }),
    );

    // Now playing: the latest session_track still inside its duration.
    const nowPlayingRes = await pool.query<{
      request_id: string | null;
      title: string;
      artist: string;
      bpm: string | number | null;
      duration_sec: number | null;
      started_at: Date;
      amount_cents: number | null;
    }>(
      `select st.request_id, st.title, st.artist, st.bpm, st.duration_sec,
              st.started_at, r.amount_cents
         from public.session_tracks st
         left join public.requests r on r.id = st.request_id
        where st.session_id = $1
        order by st.started_at desc
        limit 1`,
      [sessionId],
    );
    const np = nowPlayingRes.rows[0];
    const npDuration = np?.duration_sec ?? 0;
    const npActive =
      np !== undefined &&
      (npDuration <= 0 || np.started_at.getTime() + npDuration * 1000 > now);
    const nowPlaying = npActive
      ? {
          requestId: np.request_id,
          title: np.title,
          artist: np.artist,
          bpm: np.bpm === null ? null : Number(np.bpm),
          durationSec: np.duration_sec,
          startedAt: np.started_at.toISOString(),
          amountCents: np.amount_cents,
        }
      : null;

    // Revenue: value the DJ has locked in (accepted + playing + played),
    // net of partial SLA refunds (amount_cents already shrank).
    const revRes = await pool.query<{ total: string }>(
      `select coalesce(sum(amount_cents), 0)::bigint as total
         from public.requests
        where session_id = $1 and status in ('accepted', 'playing', 'played')`,
      [sessionId],
    );
    const totalCents = Number(revRes.rows[0]?.total ?? 0);
    const split = computeSplit(totalCents, config.betbeatFeeBps, session.venue_share_bps);

    // Library genres with their blocked state (Definições chips).
    const genresRes = await pool.query<{ genre: string; blocked: boolean }>(
      `select genre, bool_and(blocked) as blocked
         from public.library_tracks
        where venue_id = $1
        group by genre
        order by genre`,
      [session.venue_id],
    );

    // Venue DJs, for the transfer control.
    const djsRes = await pool.query<{ id: string; display_name: string }>(
      `select id, display_name from public.staff
        where venue_id = $1 and role = 'dj'
        order by display_name`,
      [session.venue_id],
    );

    const venueSettings =
      typeof session.venue_settings === "object" && session.venue_settings !== null
        ? (session.venue_settings as Record<string, unknown>)
        : {};
    const venueBase =
      typeof venueSettings.basePriceCents === "number" &&
      Number.isSafeInteger(venueSettings.basePriceCents)
        ? venueSettings.basePriceCents
        : 1000;

    return NextResponse.json({
      serverNow: new Date(now).toISOString(),
      session: {
        id: session.id,
        name: session.name,
        status: session.status,
        requestsOpen: session.requests_open,
        startsAt: session.starts_at.toISOString(),
        endsAt: session.ends_at.toISOString(),
        sessionGenres: session.genres,
        catalogMode: session.catalog_mode,
        djStaffId: session.dj_staff_id,
        config: {
          acceptanceRatePerHour: config.acceptanceRatePerHour,
          basePriceCents: config.basePriceCents,
          soonDeadlineMin: config.soonDeadlineMin,
          nextDeadlineMin: config.nextDeadlineMin,
          decisionWindowNextMin: config.decisionWindowNextMin,
          decisionWindowSoonMin: config.decisionWindowSoonMin,
          decisionWindowQueueMin: config.decisionWindowQueueMin,
          noRepeatWindowMin: config.noRepeatWindowMin,
        },
        // ±30% around the venue's base price (B7 Definições).
        basePriceBounds: {
          minCents: Math.round(venueBase * 0.7),
          maxCents: Math.round(venueBase * 1.3),
        },
      },
      requests,
      nowPlaying,
      revenue: { totalCents, djCents: split.djCents },
      genres: genresRes.rows.map((g) => ({ genre: g.genre, blocked: g.blocked })),
      venueDjs: djsRes.rows.map((d) => ({ staffId: d.id, name: d.display_name })),
    });
  } catch (error) {
    const correlationId = Math.random().toString(16).slice(2, 10);
    console.error(
      `[cockpit:state] ${correlationId}: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return apiError(500, "internal", correlationId);
  }
}
