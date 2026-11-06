import "server-only";
import { createMicroCache } from "@/lib/cache/micro";
import { getPool } from "@/lib/db";
import type { SpentRow } from "./ranking";

/**
 * Played money per guest tonight, the whole table (not only the top 50),
 * highest first and ties by guest id, exactly the order of the public
 * ranking. Every phone asks for its own place on each read, so the table is
 * shared per night for half a second (lib/cache/micro), like the public
 * board. Guest ids stay on the server: only each guest's own place leaves.
 */
const cache = createMicroCache<SpentRow[]>(500);

export function sessionSpent(sessionId: string, now = Date.now()): Promise<SpentRow[]> {
  return cache(
    sessionId,
    async () => {
      const res = await getPool().query<{ guest_id: string; spent: string }>(
        `select c.guest_id, sum(c.amount_cents)::bigint as spent
           from public.auction_contributions c
           join public.auction_slots s on s.id = c.slot_id
          where s.session_id = $1 and c.spent_at is not null
          group by c.guest_id
          order by spent desc, c.guest_id`,
        [sessionId],
      );
      return res.rows.map((r) => ({ guestId: r.guest_id, spentCents: Number(r.spent) }));
    },
    now,
  );
}
