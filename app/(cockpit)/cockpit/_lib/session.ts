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
