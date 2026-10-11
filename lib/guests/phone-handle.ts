import "server-only";

/**
 * A phone number owns one @ (migration 0012). The link is made only once
 * the number is proven: an SMS code, or an MB WAY payment the owner
 * approved in the app. Never a lookup by number from the client: knowing
 * someone's number must not reveal their @.
 */

import type { Pool, PoolClient } from "pg";
import { isOffensiveHandle } from "./blocked-words";
import { isReservedHandle } from "./reserved-handles";

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

export type HandleCheck = "ok" | "taken" | "not_allowed";

/**
 * The word rules alone (no database): a slur or insult is "not_allowed";
 * a reserved name answers like a taken @, so nobody learns it is special.
 */
export function handleRules(handle: string): HandleCheck {
  if (isOffensiveHandle(handle)) return "not_allowed";
  if (isReservedHandle(handle)) return "taken";
  return "ok";
}

/**
 * True when someone else already uses the @ (2026-10-11): the @ of
 * another number, or of another guest in `guests`, ignoring case. Guests
 * signed in with the same proven number are the same person.
 */
export async function handleInUse(db: Db, handle: string, guestId: string, phoneHash: string | null): Promise<boolean> {
  if (await handleTaken(db, handle, phoneHash)) return true;
  const res = await db.query(
    `select 1 from public.guests
      where lower(handle) = lower($1) and id <> $2
        and ($3::text is null or phone_hash is distinct from $3)
      limit 1`,
    [handle, guestId, phoneHash],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Rules, then the database: what the guest would get if they picked it now. */
export async function checkHandle(db: Db, handle: string, guestId: string, phoneHash: string | null): Promise<HandleCheck> {
  const rule = handleRules(handle);
  if (rule !== "ok") return rule;
  return (await handleInUse(db, handle, guestId, phoneHash)) ? "taken" : "ok";
}

/**
 * Gives the guest the @ if it passes the rules and nobody uses it. The
 * check and the write share one transaction behind a lock on the @, so
 * two phones picking the same @ at the same moment cannot both get it.
 */
export async function claimHandle(pool: Pool, guestId: string, handle: string, phoneHash: string | null): Promise<HandleCheck> {
  const rule = handleRules(handle);
  if (rule !== "ok") return rule;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`handle:${handle.toLowerCase()}`]);
    if (await handleInUse(client, handle, guestId, phoneHash)) {
      await client.query("rollback");
      return "taken";
    }
    await client.query(`update public.guests set handle = $2 where id = $1`, [guestId, handle]);
    await client.query("commit");
    return "ok";
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
