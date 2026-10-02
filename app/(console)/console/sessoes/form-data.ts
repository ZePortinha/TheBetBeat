import "server-only";

/** Shared loaders for the session form (DJs + genres of the active venue). */

import { query } from "@/lib/db";

export async function loadDjs(venueId: string): Promise<Array<{ id: string; name: string }>> {
  const res = await query<{ id: string; display_name: string }>(
    `select id, display_name from public.staff
      where venue_id = $1 and role = 'dj'
      order by display_name asc`,
    [venueId],
  );
  return res.rows.map((r) => ({ id: r.id, name: r.display_name }));
}

export async function loadGenres(venueId: string): Promise<string[]> {
  const res = await query<{ genre: string }>(
    `select genre from public.genre_multipliers where venue_id = $1 order by genre asc`,
    [venueId],
  );
  return res.rows.map((r) => r.genre);
}

export async function loadVenueFeeBps(venueId: string): Promise<number> {
  const res = await query<{ betbeat_fee_bps: number }>(
    `select betbeat_fee_bps from public.venues where id = $1`,
    [venueId],
  );
  return res.rows[0]?.betbeat_fee_bps ?? 2000;
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
