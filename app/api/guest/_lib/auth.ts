import "server-only";

/**
 * Guest identity for API routes (BRIEF B6 "Identidade sem registo").
 *
 * The browser signs in anonymously (Supabase Anonymous Sign-ins) and the
 * @supabase/ssr cookie carries the session; routes resolve `auth.uid()`
 * server-side. A `Authorization: Bearer <access_token>` header is also
 * accepted (smoke tests / non-browser clients) — the token is validated
 * against Supabase Auth, never trusted blindly.
 *
 * `ensureGuestRow` upserts the guest's own `guests` row so FK targets
 * (quotes.guest_id, requests.guest_id) always exist even if the client
 * upsert raced or failed.
 */

import { getPool } from "@/lib/db";
import { env } from "@/lib/security/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface GuestIdentity {
  guestId: string;
}

export async function getGuestIdentity(request: Request): Promise<GuestIdentity | null> {
  const authz = request.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) {
    const token = authz.slice(7).trim();
    if (token.length > 0 && token.length < 4096) {
      const admin = createAdminClient();
      const { data, error } = await admin.auth.getUser(token);
      if (!error && data.user) return { guestId: data.user.id };
    }
    return null;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { guestId: user.id };
}

/** Insert the guest's own row if missing (FK target for quotes/requests). */
export async function ensureGuestRow(guestId: string, locale?: string): Promise<void> {
  await getPool().query(
    `insert into public.guests (id, locale)
     values ($1, coalesce($2, 'pt-PT'))
     on conflict (id) do nothing`,
    [guestId, locale ?? null],
  );
}

/**
 * The party's phone login (2026-10-08, server-enforced since 2026-10-10):
 * required everywhere except a production build still on the mock SMS
 * provider, where nobody would ever receive a code.
 */
export function phoneLoginRequired(): boolean {
  return !(process.env.NODE_ENV === "production" && env.SMS_PROVIDER === "mock");
}

/** True once this guest proved a phone number with an SMS code (or the login is off). */
export async function isSignedIn(guestId: string): Promise<boolean> {
  if (!phoneLoginRequired()) return true;
  const res = await getPool().query<{ ok: boolean }>(
    `select phone_verified_at is not null as ok from public.guests where id = $1`,
    [guestId],
  );
  return res.rows[0]?.ok ?? false;
}
