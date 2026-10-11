import "server-only";

/**
 * Phone login (owner, 2026-10-10): the phone number IS the guest's
 * account. The first guest (Supabase auth user) that proves a number owns
 * it (migration 17, `phone_accounts`); any other phone or browser that
 * later proves the same number is signed in AS that guest, so the @, the
 * balance and the history follow the number.
 *
 * Signing a browser into an existing guest: Supabase has no "admin, make
 * me a session" call, so the server gives the account an internal email
 * (never shown, never mailed), asks Auth for a one-time magic-link token
 * and redeems it right away. The browser only receives that guest's own
 * session tokens, after the SMS code proved the number.
 */

import type { Pool, PoolClient } from "pg";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/security/env";

type Db = Pool | PoolClient;

export type AccountResolution =
  | { kind: "same"; accountId: string }
  | { kind: "claimed"; accountId: string }
  | { kind: "switch"; accountId: string };

/**
 * Who owns a just-proven number, from the point of view of `guestId`:
 *   - nobody yet → this guest claims it (or moves its account to it, when
 *     it already owned another number: "mudar de número");
 *   - this guest → nothing to do;
 *   - another guest → the browser must switch to that guest.
 */
export async function resolvePhoneAccount(db: Db, guestId: string, phoneHash: string): Promise<AccountResolution> {
  const owner = await db.query<{ guest_id: string }>(`select guest_id from public.phone_accounts where phone_hash = $1`, [
    phoneHash,
  ]);
  const ownerId = owner.rows[0]?.guest_id;
  if (ownerId === guestId) return { kind: "same", accountId: guestId };
  if (ownerId) return { kind: "switch", accountId: ownerId };

  const moved = await db.query(`update public.phone_accounts set phone_hash = $2 where guest_id = $1`, [guestId, phoneHash]);
  if ((moved.rowCount ?? 0) === 0) {
    const inserted = await db.query(
      `insert into public.phone_accounts (phone_hash, guest_id) values ($1, $2) on conflict do nothing`,
      [phoneHash, guestId],
    );
    // Lost a race with another device proving the same number: follow it.
    if ((inserted.rowCount ?? 0) === 0) return resolvePhoneAccount(db, guestId, phoneHash);
  }
  return { kind: "claimed", accountId: guestId };
}

export interface GuestSession {
  accessToken: string;
  refreshToken: string;
}

/** Internal sign-in address of a guest account (RFC 2606: never deliverable). */
export function accountEmail(guestId: string): string {
  return `${guestId}@guests.betbeat.invalid`;
}

/** A fresh Supabase session for an existing guest (see the module comment). */
export async function sessionForGuest(guestId: string): Promise<GuestSession | null> {
  const admin = createAdminClient();
  const found = await admin.auth.admin.getUserById(guestId);
  if (found.error || !found.data.user) return null;
  let email = found.data.user.email ?? null;
  if (!email) {
    // An anonymous guest becomes a permanent user the first time another
    // device needs to sign in as it.
    email = accountEmail(guestId);
    const updated = await admin.auth.admin.updateUserById(guestId, { email, email_confirm: true });
    if (updated.error) {
      console.error(`[account] could not prepare the account: ${updated.error.message}`);
      return null;
    }
  }
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) {
    console.error(`[account] could not issue a sign-in token: ${link.error?.message ?? "no token"}`);
    return null;
  }
  const auth = createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const verified = await auth.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  const session = verified.data.session;
  if (verified.error || !session) {
    console.error(`[account] could not redeem the sign-in token: ${verified.error?.message ?? "no session"}`);
    return null;
  }
  return { accessToken: session.access_token, refreshToken: session.refresh_token };
}
