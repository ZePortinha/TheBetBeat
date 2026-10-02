"use server";

/**
 * Sessões — create / edit / end (B9.1).
 *
 * Security (B12.2): requireStaff via requireConsole on every action,
 * venue scoping through assertVenueAccess + venue-scoped SQL, zod STRICT
 * allowlists (no price/status/role/venue mass assignment: betbeatFeeBps
 * always comes from the venue row, never the body), audit_log per
 * mutation. B5.6: tier-min configs that break the "+5 € per tier"
 * ordering are REJECTED with inline field errors (B10.8), then
 * parseSessionConfig normalizes the stored config as the final guard.
 */

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { query, withTransaction } from "@/lib/db";
import { parseSessionConfig, MIN_TIER_STEP_CENTS } from "@/lib/domain/config";
import { endSession } from "@/lib/domain/service";
import { assertVenueAccess, audit, requireConsole } from "../_lib/context";

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

const eur = z.coerce.number().finite().min(0).max(100_000);

const sessionFormSchema = z
  .object({
    venueId: z.string().uuid(),
    sessionId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(80),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    djStaffId: z.string().uuid(),
    genres: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
    catalogMode: z.enum(["library", "library_plus_catalog"]),
    basePriceEur: eur,
    acceptanceRatePerHour: z.coerce.number().finite().min(1).max(60),
    soonDeadlineMin: z.coerce.number().int().min(5).max(120),
    nextDeadlineMin: z.coerce.number().int().min(3).max(60),
    queueMinEur: eur,
    queueMaxEur: eur,
    soonMinEur: eur,
    soonMaxEur: eur,
    nextMinEur: eur,
    nextMaxEur: eur,
    venueSharePct: z.coerce.number().finite().min(0).max(100),
  })
  .strict();

export type SessionFormState = {
  ok?: boolean;
  /** Field name → translation key under console.sessions.errors. */
  errors?: Record<string, string>;
  formError?: string;
} | null;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function toCents(eurValue: number): number {
  return Math.round(eurValue * 100);
}

/** Europe/Lisbon wall-clock → UTC epoch ms (DST-aware via Intl). */
function lisbonToUtcMs(date: string, time: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(new Date(naive)).map((p) => [p.type, p.value]),
  );
  const asLisbon = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return naive - (asLisbon - naive);
}

function readForm(formData: FormData): unknown {
  return {
    venueId: formData.get("venueId"),
    sessionId: formData.get("sessionId") || undefined,
    name: formData.get("name"),
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    djStaffId: formData.get("djStaffId"),
    genres: formData.getAll("genres"),
    catalogMode: formData.get("catalogMode"),
    basePriceEur: formData.get("basePriceEur"),
    acceptanceRatePerHour: formData.get("acceptanceRatePerHour"),
    soonDeadlineMin: formData.get("soonDeadlineMin"),
    nextDeadlineMin: formData.get("nextDeadlineMin"),
    queueMinEur: formData.get("queueMinEur"),
    queueMaxEur: formData.get("queueMaxEur"),
    soonMinEur: formData.get("soonMinEur"),
    soonMaxEur: formData.get("soonMaxEur"),
    nextMinEur: formData.get("nextMinEur"),
    nextMaxEur: formData.get("nextMaxEur"),
    venueSharePct: formData.get("venueSharePct"),
  };
}

/**
 * B5.6 inline validation: every max ≥ min, each tier's min at least
 * 5 € above the previous one, base price inside the QUEUE range.
 * Returns field → error translation key (console.sessions.errors.*).
 */
function validateTierOrdering(data: z.infer<typeof sessionFormSchema>): Record<string, string> {
  const errors: Record<string, string> = {};
  const q = { min: toCents(data.queueMinEur), max: toCents(data.queueMaxEur) };
  const s = { min: toCents(data.soonMinEur), max: toCents(data.soonMaxEur) };
  const n = { min: toCents(data.nextMinEur), max: toCents(data.nextMaxEur) };

  if (q.max < q.min) errors.queueMaxEur = "maxBelowMin";
  if (s.max < s.min) errors.soonMaxEur = "maxBelowMin";
  if (n.max < n.min) errors.nextMaxEur = "maxBelowMin";
  if (s.min < q.min + MIN_TIER_STEP_CENTS) errors.soonMinEur = "tierStep";
  if (n.min < s.min + MIN_TIER_STEP_CENTS) errors.nextMinEur = "tierStep";
  // The +5 € chain must also FIT under each max (B5.6 "a Consola rejeita").
  if (s.max < q.min + MIN_TIER_STEP_CENTS) errors.soonMaxEur = "tierStepMax";
  if (n.max < Math.max(s.min, q.min + MIN_TIER_STEP_CENTS) + MIN_TIER_STEP_CENTS) {
    errors.nextMaxEur = "tierStepMax";
  }
  const base = toCents(data.basePriceEur);
  if (base < q.min || base > q.max) errors.basePriceEur = "baseOutsideQueue";
  return errors;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export async function saveSessionAction(
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  const ctx = await requireConsole("/console/sessoes");
  const parsed = sessionFormSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      if (!errors[field]) errors[field] = "invalid";
    }
    return { errors };
  }
  const data = parsed.data;
  const venueId = assertVenueAccess(ctx, data.venueId);

  const tierErrors = validateTierOrdering(data);
  if (Object.keys(tierErrors).length > 0) return { errors: tierErrors };

  const startsAtMs = lisbonToUtcMs(data.date, data.startTime);
  let endsAtMs = lisbonToUtcMs(data.date, data.endTime);
  if (endsAtMs <= startsAtMs) endsAtMs += 24 * 60 * 60 * 1000; // crosses midnight
  if (endsAtMs - startsAtMs > 24 * 60 * 60 * 1000) {
    return { errors: { endTime: "invalid" } };
  }

  // DJ must belong to THIS venue (allowlist — never trust the body alone).
  const dj = await query<{ id: string }>(
    `select id from public.staff where id = $1 and venue_id = $2 and role = 'dj'`,
    [data.djStaffId, venueId],
  );
  if (dj.rows.length === 0) return { errors: { djStaffId: "invalid" } };

  // betbeatFeeBps is NEVER client-provided: read from the venue contract.
  const venueRow = await query<{ betbeat_fee_bps: number }>(
    `select betbeat_fee_bps from public.venues where id = $1`,
    [venueId],
  );
  const betbeatFeeBps = venueRow.rows[0]?.betbeat_fee_bps ?? 2000;
  const venueShareBps = Math.round(data.venueSharePct * 100);

  const config = parseSessionConfig({
    basePriceCents: toCents(data.basePriceEur),
    acceptanceRatePerHour: data.acceptanceRatePerHour,
    soonDeadlineMin: data.soonDeadlineMin,
    nextDeadlineMin: data.nextDeadlineMin,
    tierLimits: {
      QUEUE: { minCents: toCents(data.queueMinEur), maxCents: toCents(data.queueMaxEur) },
      SOON: { minCents: toCents(data.soonMinEur), maxCents: toCents(data.soonMaxEur) },
      NEXT: { minCents: toCents(data.nextMinEur), maxCents: toCents(data.nextMaxEur) },
    },
    betbeatFeeBps,
    venueShareBps,
  });

  const genres = data.genres.map((g) => g.toLowerCase());

  if (data.sessionId) {
    // Edit — venue-scoped UPDATE; ended sessions are immutable.
    const updated = await withTransaction(async (client) => {
      const res = await client.query<{ id: string; status: string }>(
        `select id, status from public.sessions
          where id = $1 and venue_id = $2 for update`,
        [data.sessionId, venueId],
      );
      const row = res.rows[0];
      if (!row || row.status === "ended") return false;
      await client.query(
        `update public.sessions
            set name = $2, dj_staff_id = $3, genres = $4, catalog_mode = $5,
                starts_at = to_timestamp($6 / 1000.0), ends_at = to_timestamp($7 / 1000.0)
          where id = $1`,
        [
          data.sessionId,
          data.name,
          data.djStaffId,
          genres,
          data.catalogMode,
          startsAtMs,
          endsAtMs,
        ],
      );
      await client.query(
        `update public.session_settings
            set config = $2, venue_share_bps = $3, updated_at = now()
          where session_id = $1`,
        [data.sessionId, JSON.stringify(config), venueShareBps],
      );
      await client.query(
        `insert into public.audit_log (actor, action, entity, entity_id, venue_id, payload)
         values ($1, 'session.updated', 'session', $2, $3, $4)`,
        [
          ctx.actor,
          data.sessionId,
          venueId,
          JSON.stringify({ name: data.name, venueShareBps }),
        ],
      );
      return true;
    });
    if (!updated) return { formError: "notEditable" };
    revalidatePath("/console/sessoes");
    redirect(`/console/sessoes?saved=1`);
  }

  const created = await withTransaction(async (client) => {
    const res = await client.query<{ id: string }>(
      `insert into public.sessions
         (venue_id, dj_staff_id, name, genres, catalog_mode, starts_at, ends_at)
       values ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0))
       returning id`,
      [venueId, data.djStaffId, data.name, genres, data.catalogMode, startsAtMs, endsAtMs],
    );
    const sessionId = res.rows[0].id;
    await client.query(
      `insert into public.session_settings (session_id, config, venue_share_bps)
       values ($1, $2, $3)`,
      [sessionId, JSON.stringify(config), venueShareBps],
    );
    await client.query(
      `insert into public.audit_log (actor, action, entity, entity_id, venue_id, payload)
       values ($1, 'session.created', 'session', $2, $3, $4)`,
      [
        ctx.actor,
        sessionId,
        venueId,
        JSON.stringify({ name: data.name, venueShareBps, betbeatFeeBps }),
      ],
    );
    return sessionId;
  });
  revalidatePath("/console/sessoes");
  redirect(`/console/sessoes?created=${created}`);
}

const endSchema = z.object({ sessionId: z.string().uuid() }).strict();

export async function endSessionAction(formData: FormData): Promise<void> {
  const ctx = await requireConsole("/console/sessoes");
  const parsed = endSchema.safeParse({ sessionId: formData.get("sessionId") });
  if (!parsed.success) redirect("/console/sessoes");

  // Venue scope: the session must belong to a venue this user controls.
  const res = await query<{ venue_id: string }>(
    `select venue_id from public.sessions where id = $1`,
    [parsed.data.sessionId],
  );
  const row = res.rows[0];
  if (!row || !ctx.venues.some((v) => v.id === row.venue_id)) {
    redirect("/console/sessoes");
  }

  // endSession does the heavy lifting: refunds, payouts, its own audit row.
  await endSession(parsed.data.sessionId, ctx.actor, Date.now());
  await audit(ctx, "session.ended_via_console", "session", parsed.data.sessionId, row.venue_id);
  revalidatePath("/console/sessoes");
  redirect("/console/sessoes?ended=1");
}
