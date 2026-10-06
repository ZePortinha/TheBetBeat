/**
 * Dev helper (local only): prints a guest link and the venue-screen link
 * for the seeded live session and opens one auction now, so the slot
 * auction screens can be checked without waiting for the schedule.
 *   pnpm exec tsx --conditions=react-server --env-file=.env.local scripts/dev-auction-links.ts
 */
import { signToken } from "@/lib/security/tokens";
import { getPool } from "@/lib/db";
import { openExtraSlot } from "@/lib/auction/service";

const SESSION = "dddddddd-0000-4000-8000-000000000001";
const VENUE = "aaaaaaaa-0000-4000-8000-000000000001";

async function main() {
  const pool = getPool();
  const s = await pool.query<{ status: string; ends_at: Date }>(`select status, ends_at from public.sessions where id = $1`, [SESSION]);
  console.log("session", s.rows[0]);
  const open = await pool.query(`select 1 from public.auction_slots where session_id = $1 and status = 'open'`, [SESSION]);
  if ((open.rowCount ?? 0) === 0) console.log("opened slot", await openExtraSlot(SESSION, "system:dev", Date.now()));
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  console.log("guest  ", `${base}/s/${encodeURIComponent(signToken({ kind: "zone", venueId: VENUE, slug: "zone-pista-dev" }))}`);
  console.log("display", `${base}/display/${encodeURIComponent(signToken({ kind: "display", venueId: VENUE, slug: "display-dev" }))}`);
  await pool.end();
}

void main();
