import "server-only";

/**
 * Console access context (BRIEF B9 + B12).
 *
 * Every console page/action starts here: `requireConsole` wraps
 * `requireStaff` (session + role + MFA/AAL2 enforced server-side) and
 * resolves the ACTIVE VENUE with strict scoping:
 *  - managers only ever see venues they hold a membership in;
 *  - platform admins (staff.venue_id IS NULL) can switch to any venue.
 *
 * The active venue is a cookie (`bb-console-venue`) set by a server
 * action — the client never decides scope, it only picks among the
 * venues this helper already authorized.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff, type StaffContext } from "@/lib/security/staff";
import { query } from "@/lib/db";

export const VENUE_COOKIE = "bb-console-venue";

export interface VenueOption {
  id: string;
  name: string;
}

export interface ConsoleContext {
  staff: StaffContext;
  /** True when the user holds a platform admin membership (venue_id null). */
  isAdmin: boolean;
  /** Venues this user may operate on (all venues for platform admins). */
  venues: VenueOption[];
  /** The venue the console is currently scoped to (null: no venue exists). */
  activeVenue: VenueOption | null;
  /** Audit actor string. */
  actor: string;
}

/** True when the context holds a PLATFORM admin membership (venue_id null). */
export function isPlatformAdmin(staff: StaffContext): boolean {
  return staff.memberships.some((m) => m.role === "admin" && m.venueId === null);
}

/**
 * Gate for venue-panel pages: managers and admins only (DJs never see
 * the console — B9). Resolves the venue list + active venue.
 */
export async function requireConsole(nextPath: string): Promise<ConsoleContext> {
  const staff = await requireStaff(["manager", "admin"], { nextPath });
  const admin = isPlatformAdmin(staff);

  let venues: VenueOption[];
  if (admin) {
    const res = await query<{ id: string; name: string }>(
      `select id, name from public.venues order by name asc`,
    );
    venues = res.rows;
  } else {
    const ids = staff.memberships
      .filter((m) => (m.role === "manager" || m.role === "admin") && m.venueId !== null)
      .map((m) => m.venueId as string);
    if (ids.length === 0) {
      redirect(`/login?next=${encodeURIComponent(nextPath)}&error=forbidden`);
    }
    const res = await query<{ id: string; name: string }>(
      `select id, name from public.venues where id = any($1::uuid[]) order by name asc`,
      [ids],
    );
    venues = res.rows;
  }

  const store = await cookies();
  const wanted = store.get(VENUE_COOKIE)?.value;
  const activeVenue =
    venues.find((v) => v.id === wanted) ?? venues[0] ?? null;

  return {
    staff,
    isAdmin: admin,
    venues,
    activeVenue,
    actor: `console:${staff.email ?? staff.userId}`,
  };
}

/**
 * Gate for Admin BetBeat pages: PLATFORM admins only (role admin with a
 * null venue membership — a venue-scoped admin is not platform staff).
 */
export async function requireAdminConsole(nextPath: string): Promise<ConsoleContext> {
  const ctx = await requireConsole(nextPath);
  if (!ctx.isAdmin) {
    redirect("/console");
  }
  return ctx;
}

/**
 * Venue scoping for mutations (B12.2 "sem mass assignment"): the venue id
 * a form claims is only accepted when this user is authorized for it.
 * Returns the venue id or redirects away.
 */
export function assertVenueAccess(ctx: ConsoleContext, venueId: string): string {
  if (!ctx.venues.some((v) => v.id === venueId)) {
    redirect("/console");
  }
  return venueId;
}

/** Audit row for every console mutation (B12.2). */
export async function audit(
  ctx: ConsoleContext,
  action: string,
  entity: string,
  entityId: string | null,
  venueId: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await query(
    `insert into public.audit_log (actor, action, entity, entity_id, venue_id, payload)
     values ($1, $2, $3, $4, $5, $6)`,
    [ctx.actor, action, entity, entityId, venueId, JSON.stringify(payload)],
  );
}

/** "12,50 €" — console money formatting (server-side, pt-PT). */
export function formatEuros(cents: number): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** Lisbon-local date-time for tables. */
export function formatDateTime(iso: string | Date): string {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: "Europe/Lisbon",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}
