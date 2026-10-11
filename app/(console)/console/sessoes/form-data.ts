import "server-only";

/** Shared loaders for the session form (DJs + genres of the active venue). */

import { query } from "@/lib/db";
import { EVENT_STYLES, normalizeStyle } from "@/lib/catalog/styles";

export async function loadDjs(venueId: string): Promise<Array<{ id: string; name: string }>> {
  const res = await query<{ id: string; display_name: string }>(
    `select id, display_name from public.staff
      where venue_id = $1 and role = 'dj'
      order by display_name asc`,
    [venueId],
  );
  return res.rows.map((r) => ({ id: r.id, name: r.display_name }));
}

/**
 * Styles the event form offers: the common ones (EVENT_STYLES), the club's
 * priced genres and the styles of its library, lowercase and deduplicated.
 */
export async function loadGenres(venueId: string): Promise<string[]> {
  const res = await query<{ genre: string }>(
    `select lower(genre) as genre from public.genre_multipliers where venue_id = $1
     union
     select lower(genre) from public.library_tracks where venue_id = $1 and genre <> 'unknown'`,
    [venueId],
  );
  const all = new Set<string>(EVENT_STYLES);
  for (const r of res.rows) all.add(normalizeStyle(r.genre));
  return [...all];
}

/** Lisbon-local yyyy-mm-dd / HH:mm parts of a UTC timestamp. */
export function lisbonParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const time = new Intl.DateTimeFormat("pt-PT", {
    timeZone: "Europe/Lisbon",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return { date, time };
}
