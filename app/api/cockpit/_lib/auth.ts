import "server-only";

/**
 * Cockpit API guard (BRIEF B12.2/B12.3).
 *
 * Unlike `requireStaff` (which redirects, for layouts), API routes need
 * plain HTTP outcomes: 401 for no staff session, 403 for a venue the
 * user has no role in, 404-as-403 never leaking which ids exist. Every
 * route resolves the target's venue server-side (the client NEVER sends
 * venue_id) and checks it against the caller's memberships.
 *
 * Errors to the client are generic with a correlation id (B12.4); the
 * detail goes to the server log only.
 */

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPool } from "@/lib/db";
import type { Role } from "@/lib/domain/types";
import { mustChangePassword } from "@/lib/security/password";

export interface StaffApiContext {
  userId: string;
  /** `staff:<auth uid>` — the audit actor string. */
  actor: string;
  memberships: Array<{
    staffId: string;
    venueId: string | null;
    role: Exclude<Role, "guest">;
  }>;
}

export type StaffApiResult =
  | { ok: true; ctx: StaffApiContext }
  | { ok: false; response: NextResponse };

const COCKPIT_ROLES: ReadonlyArray<Exclude<Role, "guest">> = [
  "dj",
  "manager",
  "admin",
];

/** Generic error body — never a stack, never a detail (B12.4). */
export function apiError(
  status: number,
  code: string,
  correlationId = randomUUID().slice(0, 8),
): NextResponse {
  return NextResponse.json({ error: code, correlationId }, { status });
}

/**
 * Validates the staff session on this request (server-side, every call)
 * and loads venue memberships through RLS (staff read their own rows).
 */
export async function requireStaffApi(): Promise<StaffApiResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) {
    return { ok: false, response: apiError(401, "unauthorized") };
  }
  if (mustChangePassword(user)) {
    return { ok: false, response: apiError(403, "password_change_required") };
  }

  const { data: rows } = await supabase
    .from("staff")
    .select("id, venue_id, role")
    .eq("user_id", user.id);

  let memberships = (rows ?? [])
    .map((r) => ({
      staffId: r.id as string,
      venueId: r.venue_id as string | null,
      role: r.role as Exclude<Role, "guest">,
    }))
    .filter((m) => COCKPIT_ROLES.includes(m.role));

  // Same rule as the pages (requireStaff): manager/admin powers need MFA.
  // Without AAL2 only plain DJ memberships count, so a stolen manager
  // password alone cannot drive the cockpit API.
  if (memberships.some((m) => m.role !== "dj")) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") memberships = memberships.filter((m) => m.role === "dj");
    if (memberships.length === 0) return { ok: false, response: apiError(403, "mfa_required") };
  }

  if (memberships.length === 0) {
    return { ok: false, response: apiError(403, "forbidden") };
  }

  return {
    ok: true,
    ctx: { userId: user.id, actor: `staff:${user.id}`, memberships },
  };
}

/** True when the caller holds a cockpit role at `venueId` (admin = global). */
export function hasVenueAccess(ctx: StaffApiContext, venueId: string): boolean {
  return ctx.memberships.some(
    (m) => m.venueId === venueId || (m.role === "admin" && m.venueId === null),
  );
}

/**
 * Resolves a request's session + venue and checks the caller's access.
 * Returns null (callers answer 403) when the request does not exist OR
 * the caller has no role at its venue — indistinguishable on purpose.
 */
export async function authorizeRequest(
  ctx: StaffApiContext,
  requestId: string,
): Promise<{ requestId: string; sessionId: string; venueId: string } | null> {
  const res = await getPool().query<{ session_id: string; venue_id: string }>(
    `select session_id, venue_id from public.requests where id = $1`,
    [requestId],
  );
  const row = res.rows[0];
  if (!row || !hasVenueAccess(ctx, row.venue_id)) return null;
  return { requestId, sessionId: row.session_id, venueId: row.venue_id };
}

/** Same venue-scoping gate for a session id. */
export async function authorizeSession(
  ctx: StaffApiContext,
  sessionId: string,
): Promise<{ sessionId: string; venueId: string } | null> {
  const res = await getPool().query<{ venue_id: string }>(
    `select venue_id from public.sessions where id = $1`,
    [sessionId],
  );
  const row = res.rows[0];
  if (!row || !hasVenueAccess(ctx, row.venue_id)) return null;
  return { sessionId, venueId: row.venue_id };
}
