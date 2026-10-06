import "server-only";

/**
 * A phone number owns one @ (migration 0012). The link is made only once
 * the number is proven: an SMS code, or an MB WAY payment the owner
 * approved in the app. Never a lookup by number from the client: knowing
 * someone's number must not reveal their @.
 */

import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

/**
 * Ties a proven number and the guest's @, both ways: the number's @ wins
 * (this device takes it); a number without one keeps the guest's @ if it
 * is still free. Returns the guest's @ afterwards.
 */
export async function linkPhoneHandle(db: Db, guestId: string, phoneHash: string): Promise<string | null> {
  const owned = await db.query<{ handle: string }>(`select handle from public.phone_handles where phone_hash = $1`, [phoneHash]);
  const handle = owned.rows[0]?.handle;
  if (handle) {
    await db.query(`update public.guests set handle = $2, ranking_optin = true where id = $1`, [guestId, handle]);
    return handle;
  }
  const guest = await db.query<{ handle: string | null }>(`select handle from public.guests where id = $1`, [guestId]);
  const mine = guest.rows[0]?.handle ?? null;
  if (!mine) return null;
  // Taken meanwhile by another number: no link, the guest picks another later.
  await db.query(`insert into public.phone_handles (phone_hash, handle) values ($1, $2) on conflict do nothing`, [phoneHash, mine]);
  return mine;
}

/** True when the @ belongs to another number (so this guest cannot use it). */
export async function handleTaken(db: Db, handle: string, phoneHash: string | null): Promise<boolean> {
  const res = await db.query<{ phone_hash: string }>(
    `select phone_hash from public.phone_handles where lower(handle) = lower($1)`,
    [handle],
  );
  const owner = res.rows[0]?.phone_hash;
  return owner !== undefined && owner !== phoneHash;
}
