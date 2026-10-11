import "server-only";

import { getPool } from "@/lib/db";
import { requireStaff } from "@/lib/security/staff";

/**
 * Resolves the live session the cockpit should bind to, scoped to the
 * venues where the caller holds a staff role (B12.2). Admins (global,
 * venue_id null) see the most recent live session.
 */
export async function resolveCockpitSession(nextPath: string): Promise<string | null> {
  const staff = await requireStaff(["dj", "manager", "admin"], { nextPath });
  const venueIds = staff.memberships
    .map((m) => m.venueId)
    .filter((v): v is string => v !== null);
  const isGlobalAdmin = staff.memberships.some(
    (m) => m.role === "admin" && m.venueId === null,
  );

  const res = isGlobalAdmin
    ? await getPool().query<{ id: string }>(
        `select id from public.sessions where status = 'live'
          order by starts_at desc limit 1`,
      )
    : await getPool().query<{ id: string }>(
        `select id from public.sessions
          where status = 'live' and venue_id = any($1::uuid[])
          order by starts_at desc limit 1`,
        [venueIds],
      );
  return res.rows[0]?.id ?? null;
}

/**
 * The venue whose library the cockpit edits: tonight's live session venue,
 * else the caller's first venue (a global admin with no live night: the
 * first venue by name).
 */
export async function resolveCockpitVenue(nextPath: string): Promise<{ id: string; name: string } | null> {
  const staff = await requireStaff(["dj", "manager", "admin"], { nextPath });
  const sessionId = await resolveCockpitSession(nextPath);
  const pool = getPool();
  if (sessionId) {
    const res = await pool.query<{ id: string; name: string }>(
      `select v.id, v.name from public.sessions s join public.venues v on v.id = s.venue_id where s.id = $1`,
      [sessionId],
    );
    if (res.rows[0]) return res.rows[0];
  }
  const venueIds = staff.memberships.map((m) => m.venueId).filter((v): v is string => v !== null);
  const isGlobalAdmin = staff.memberships.some((m) => m.role === "admin" && m.venueId === null);
  const res = isGlobalAdmin
    ? await pool.query<{ id: string; name: string }>(`select id, name from public.venues order by name limit 1`)
    : await pool.query<{ id: string; name: string }>(
        `select id, name from public.venues where id = any($1::uuid[]) order by name limit 1`,
        [venueIds],
      );
  return res.rows[0] ?? null;
}
