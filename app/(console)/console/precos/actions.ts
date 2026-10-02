"use server";

/**
 * Preços (B9.3): venue default tier limits + genre multiplier actions
 * (B5.4 Aprovar / Ajustar / auto-apply). All venue-scoped, zod strict,
 * clamped to [0.8, 1.3] server-side, audited.
 */

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { MIN_TIER_STEP_CENTS } from "@/lib/domain/config";
import { assertVenueAccess, audit, requireConsole } from "../_lib/context";

/* ------------------------------------------------------------------ */
/* Venue default tier limits (stored in venues.settings.sessionDefaults) */
/* ------------------------------------------------------------------ */

const eur = z.coerce.number().finite().min(0).max(100_000);

const defaultsSchema = z
  .object({
    venueId: z.string().uuid(),
    basePriceEur: eur,
    queueMinEur: eur,
    queueMaxEur: eur,
    soonMinEur: eur,
    soonMaxEur: eur,
    nextMinEur: eur,
    nextMaxEur: eur,
  })
  .strict();

export type DefaultsFormState = {
  ok?: boolean;
  errors?: Record<string, string>;
} | null;

const toCents = (v: number) => Math.round(v * 100);

export async function saveDefaultsAction(
  _prev: DefaultsFormState,
  formData: FormData,
): Promise<DefaultsFormState> {
  const ctx = await requireConsole("/console/precos");
  const parsed = defaultsSchema.safeParse({
    venueId: formData.get("venueId"),
    basePriceEur: formData.get("basePriceEur"),
    queueMinEur: formData.get("queueMinEur"),
    queueMaxEur: formData.get("queueMaxEur"),
    soonMinEur: formData.get("soonMinEur"),
    soonMaxEur: formData.get("soonMaxEur"),
    nextMinEur: formData.get("nextMinEur"),
    nextMaxEur: formData.get("nextMaxEur"),
  });
  if (!parsed.success) return { errors: { form: "invalid" } };
  const data = parsed.data;
  const venueId = assertVenueAccess(ctx, data.venueId);

  // B5.6: reject configs that break the "+5 € per tier" ordering.
  const errors: Record<string, string> = {};
  const q = { min: toCents(data.queueMinEur), max: toCents(data.queueMaxEur) };
  const s = { min: toCents(data.soonMinEur), max: toCents(data.soonMaxEur) };
  const n = { min: toCents(data.nextMinEur), max: toCents(data.nextMaxEur) };
  if (q.max < q.min) errors.queueMaxEur = "maxBelowMin";
  if (s.max < s.min) errors.soonMaxEur = "maxBelowMin";
  if (n.max < n.min) errors.nextMaxEur = "maxBelowMin";
  if (s.min < q.min + MIN_TIER_STEP_CENTS) errors.soonMinEur = "tierStep";
  if (n.min < s.min + MIN_TIER_STEP_CENTS) errors.nextMinEur = "tierStep";
  const base = toCents(data.basePriceEur);
  if (base < q.min || base > q.max) errors.basePriceEur = "baseOutsideQueue";
  if (Object.keys(errors).length > 0) return { errors };

  const sessionDefaults = {
    basePriceCents: base,
    tierLimits: {
      QUEUE: { minCents: q.min, maxCents: q.max },
      SOON: { minCents: s.min, maxCents: s.max },
      NEXT: { minCents: n.min, maxCents: n.max },
    },
  };
  await query(
    `update public.venues
        set settings = settings || jsonb_build_object('sessionDefaults', $2::jsonb)
      where id = $1`,
    [venueId, JSON.stringify(sessionDefaults)],
  );
  await audit(ctx, "venue.pricing_defaults_updated", "venue", venueId, venueId, sessionDefaults);
  revalidatePath("/console/precos");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Genre multipliers (B5.4)                                            */
/* ------------------------------------------------------------------ */

const genreBase = {
  venueId: z.string().uuid(),
  genre: z.string().trim().min(1).max(40),
};

const approveSchema = z.object(genreBase).strict();

export async function approveGenreAction(formData: FormData): Promise<void> {
  const ctx = await requireConsole("/console/precos");
  const parsed = approveSchema.safeParse({
    venueId: formData.get("venueId"),
    genre: formData.get("genre"),
  });
  if (!parsed.success) redirect("/console/precos");
  const venueId = assertVenueAccess(ctx, parsed.data.venueId);

  const res = await query<{ multiplier: string }>(
    `update public.genre_multipliers
        set multiplier = least(1.3, greatest(0.8, recommended)), updated_at = now()
      where venue_id = $1 and genre = $2 and recommended is not null
      returning multiplier`,
    [venueId, parsed.data.genre],
  );
  if (res.rows[0]) {
    await audit(ctx, "genre_multiplier.approved", "genre_multiplier", parsed.data.genre, venueId, {
      multiplier: Number(res.rows[0].multiplier),
    });
  }
  revalidatePath("/console/precos");
  redirect("/console/precos");
}

const adjustSchema = z
  .object({
    ...genreBase,
    multiplier: z.coerce.number().finite().min(0.8).max(1.3),
  })
  .strict();

export async function adjustGenreAction(formData: FormData): Promise<void> {
  const ctx = await requireConsole("/console/precos");
  const parsed = adjustSchema.safeParse({
    venueId: formData.get("venueId"),
    genre: formData.get("genre"),
    multiplier: formData.get("multiplier"),
  });
  if (!parsed.success) redirect("/console/precos?error=multiplierRange");
  const venueId = assertVenueAccess(ctx, parsed.data.venueId);

  // Defense in depth: clamp again server-side (zod already bounds it).
  const multiplier = Math.min(1.3, Math.max(0.8, parsed.data.multiplier));
  await query(
    `update public.genre_multipliers
        set multiplier = $3, updated_at = now()
      where venue_id = $1 and genre = $2`,
    [venueId, parsed.data.genre, multiplier],
  );
  await audit(ctx, "genre_multiplier.adjusted", "genre_multiplier", parsed.data.genre, venueId, {
    multiplier,
  });
  revalidatePath("/console/precos");
  redirect("/console/precos");
}

const autoApplySchema = z
  .object({ ...genreBase, enabled: z.enum(["on", "off"]) })
  .strict();

export async function toggleAutoApplyAction(formData: FormData): Promise<void> {
  const ctx = await requireConsole("/console/precos");
  const parsed = autoApplySchema.safeParse({
    venueId: formData.get("venueId"),
    genre: formData.get("genre"),
    enabled: formData.get("enabled"),
  });
  if (!parsed.success) redirect("/console/precos");
  const venueId = assertVenueAccess(ctx, parsed.data.venueId);

  const enabled = parsed.data.enabled === "on";
  await query(
    `update public.genre_multipliers
        set auto_apply = $3, updated_at = now()
      where venue_id = $1 and genre = $2`,
    [venueId, parsed.data.genre, enabled],
  );
  await audit(ctx, "genre_multiplier.auto_apply", "genre_multiplier", parsed.data.genre, venueId, {
    enabled,
  });
  revalidatePath("/console/precos");
  redirect("/console/precos");
}
