import "server-only";

import { getPool } from "@/lib/db";
import { signToken } from "@/lib/security/tokens";

/**
 * Party guest list (2026-10-05): the live party whose list holds this
 * number, as a guest URL (signed zone token of that venue). Null when the
 * number is on no list of a party happening now.
 */
export async function guestListPartyHref(phoneHash: string): Promise<string | null> {
  const res = await getPool().query<{ venue_id: string; qr_slug: string }>(
    `select s.venue_id, z.qr_slug
       from public.session_guest_list l
       join public.sessions s on s.id = l.session_id
       join lateral (
         select qr_slug from public.zones
          where venue_id = s.venue_id
          order by created_at
          limit 1
       ) z on true
      where l.phone_hash = $1 and s.status in ('live', 'paused')
      order by s.starts_at desc
      limit 1`,
    [phoneHash],
  );
  const row = res.rows[0];
  if (!row) return null;
  return `/s/${encodeURIComponent(
    signToken({ kind: "zone", venueId: row.venue_id, slug: row.qr_slug }),
  )}`;
}
