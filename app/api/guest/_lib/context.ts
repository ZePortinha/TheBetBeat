import "server-only";

/**
 * QR token → guest session context (BRIEF B4.7 "QR codes assinados").
 *
 * The token is an HMAC-signed { kind: 'zone', venueId, slug } payload
 * (lib/security/tokens). It resolves to the zone and the venue's LIVE
 * session. Every guest route re-verifies the token — it is the only
 * capability a guest URL carries.
 */

import { getPool } from "@/lib/db";
import { parseSessionConfig } from "@/lib/domain/config";
import type { SessionConfig } from "@/lib/domain/types";
import { verifyToken } from "@/lib/security/tokens";

export interface GuestSessionContext {
  venueId: string;
  venueName: string;
  zoneId: string;
  zoneName: string;
  sessionId: string;
  sessionName: string;
  djName: string | null;
  genres: string[];
  /** ISO UTC. */
  endsAt: string;
  status: string;
  requestsOpen: boolean;
  config: SessionConfig;
}

export type ResolveResult =
  | { ok: true; ctx: GuestSessionContext }
  | { ok: false; error: "invalid_token" | "no_live_session" };

export async function resolveGuestContext(qrToken: string): Promise<ResolveResult> {
  const payload = verifyToken(qrToken);
  if (!payload || (payload.kind !== "zone" && payload.kind !== "session")) return { ok: false, error: "invalid_token" };
  // An event QR (kind "session") opens that event only, through the venue's first zone.
  const eventQr = payload.kind === "session";

  const pool = getPool();
  const zoneRes = await pool.query<{
    zone_id: string;
    zone_name: string;
    venue_id: string;
    venue_name: string;
  }>(
    `select z.id as zone_id, z.name as zone_name, v.id as venue_id, v.name as venue_name
       from public.zones z
       join public.venues v on v.id = z.venue_id
      where z.venue_id = $2 and ($3 or z.qr_slug = $1)
      order by z.created_at
      limit 1`,
    [payload.slug, payload.venueId, eventQr],
  );
  const zone = zoneRes.rows[0];
  if (!zone) return { ok: false, error: "invalid_token" };

  const sessionRes = await pool.query<{
    id: string;
    name: string;
    status: string;
    genres: string[];
    ends_at: Date;
    requests_open: boolean;
    dj_name: string | null;
    config: unknown;
  }>(
    `select s.id, s.name, s.status, s.genres, s.ends_at, s.requests_open,
            st.display_name as dj_name,
            coalesce(ss.config, '{}'::jsonb) as config
       from public.sessions s
       left join public.staff st on st.id = s.dj_staff_id
       left join public.session_settings ss on ss.session_id = s.id
      where s.venue_id = $1 and s.status in ('live', 'paused') and ($2::uuid is null or s.id = $2::uuid)
      order by s.starts_at desc
      limit 1`,
    [zone.venue_id, eventQr && /^[0-9a-f-]{36}$/i.test(payload.slug) ? payload.slug : eventQr ? "00000000-0000-0000-0000-000000000000" : null],
  );
  const session = sessionRes.rows[0];
  if (!session) return { ok: false, error: "no_live_session" };

  return {
    ok: true,
    ctx: {
      venueId: zone.venue_id,
      venueName: zone.venue_name,
      zoneId: zone.zone_id,
      zoneName: zone.zone_name,
      sessionId: session.id,
      sessionName: session.name,
      djName: session.dj_name,
      genres: session.genres,
      endsAt: session.ends_at.toISOString(),
      status: session.status,
      requestsOpen: session.requests_open,
      config: parseSessionConfig(session.config),
    },
  };
}
