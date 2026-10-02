/**
 * Session configuration parsing (BRIEF B4.1 "configuráveis por sessão",
 * B5.6 protections).
 *
 * `session_settings` is stored as jsonb; this module turns that unknown
 * blob into a guaranteed-sane `SessionConfig`:
 *  - deep-merges DEFAULT_SESSION_CONFIG (missing fields → defaults);
 *  - is STRICT about types (a wrong-typed field throws — silent
 *    coercion of money config is how pricing bugs are born);
 *  - clamps insane values instead of propagating them (R ≥ 1, base
 *    price inside the QUEUE limits, windows ≥ 1 min, cents are ints);
 *  - enforces the B5.6 invariant: each tier's min is at least 5 €
 *    (500 cents) above the previous tier's min, and max ≥ min, which
 *    together keep "+5 € per tier" orderings always possible.
 */
import { z } from "zod";
import { DEFAULT_SESSION_CONFIG, type SessionConfig, type Tier } from "./types";

/** B5.6: each tier must cost at least 5 € more than the previous one. */
export const MIN_TIER_STEP_CENTS = 500;

/* ------------------------------------------------------------------ */
/* Schema — every field optional, every type strict                    */
/* ------------------------------------------------------------------ */

const money = z.number().finite();
const minutes = z.number().finite();

const tierLimitInputSchema = z
  .object({
    minCents: money.optional(),
    maxCents: money.optional(),
  })
  .strip();

export const sessionConfigInputSchema = z
  .object({
    basePriceCents: money.optional(),
    acceptanceRatePerHour: z.number().finite().optional(),
    soonDeadlineMin: minutes.optional(),
    nextDeadlineMin: minutes.optional(),
    decisionWindowNextMin: minutes.optional(),
    decisionWindowSoonMin: minutes.optional(),
    decisionWindowQueueMin: minutes.optional(),
    tierLimits: z
      .object({
        QUEUE: tierLimitInputSchema.optional(),
        SOON: tierLimitInputSchema.optional(),
        NEXT: tierLimitInputSchema.optional(),
      })
      .strip()
      .optional(),
    betbeatFeeBps: z.number().finite().optional(),
    venueShareBps: z.number().finite().optional(),
    minFitScore: z.number().finite().optional(),
    noRepeatWindowMin: minutes.optional(),
    maxActiveRequestsPerGuest: z.number().finite().optional(),
    nightSpendLimitCents: money.optional(),
    mbwayTimeoutMin: minutes.optional(),
    guestMessagesEnabled: z.boolean().optional(),
  })
  .strip();

export type SessionConfigInput = z.input<typeof sessionConfigInputSchema>;

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function intClamp(value: number, min: number, max: number): number {
  return clamp(Math.round(value), min, max);
}

const MAX_CENTS = 10_000_000; // 100 000 € — nothing sane lives above this
const MAX_MINUTES = 24 * 60;

function mergeTierLimits(
  partial: Partial<Record<Tier, { minCents?: number; maxCents?: number }>> | undefined,
): Record<Tier, { minCents: number; maxCents: number }> {
  const merged = {} as Record<Tier, { minCents: number; maxCents: number }>;
  for (const tier of ["QUEUE", "SOON", "NEXT"] as const) {
    const defaults = DEFAULT_SESSION_CONFIG.tierLimits[tier];
    const given = partial?.[tier];
    merged[tier] = {
      minCents: intClamp(given?.minCents ?? defaults.minCents, 0, MAX_CENTS),
      maxCents: intClamp(given?.maxCents ?? defaults.maxCents, 0, MAX_CENTS),
    };
  }
  // B5.6 invariant: each tier's min ≥ previous min + 500 cents.
  merged.SOON.minCents = Math.max(
    merged.SOON.minCents,
    merged.QUEUE.minCents + MIN_TIER_STEP_CENTS,
  );
  merged.NEXT.minCents = Math.max(
    merged.NEXT.minCents,
    merged.SOON.minCents + MIN_TIER_STEP_CENTS,
  );
  // Ranges must be non-empty (max ≥ min). Combined with the min chain
  // this keeps the "+5 € per tier" ordering always satisfiable.
  for (const tier of ["QUEUE", "SOON", "NEXT"] as const) {
    merged[tier].maxCents = Math.max(merged[tier].maxCents, merged[tier].minCents);
  }
  return merged;
}

function normalize(raw: z.output<typeof sessionConfigInputSchema>): SessionConfig {
  const d = DEFAULT_SESSION_CONFIG;
  const tierLimits = mergeTierLimits(raw.tierLimits);
  return {
    // Base price must live inside the QUEUE limits (B5.6).
    basePriceCents: intClamp(
      raw.basePriceCents ?? d.basePriceCents,
      tierLimits.QUEUE.minCents,
      tierLimits.QUEUE.maxCents,
    ),
    // R ≥ 1: a DJ who plays zero requests per hour breaks every ETA.
    acceptanceRatePerHour: clamp(
      raw.acceptanceRatePerHour ?? d.acceptanceRatePerHour,
      1,
      1000,
    ),
    soonDeadlineMin: intClamp(raw.soonDeadlineMin ?? d.soonDeadlineMin, 1, MAX_MINUTES),
    nextDeadlineMin: intClamp(raw.nextDeadlineMin ?? d.nextDeadlineMin, 1, MAX_MINUTES),
    decisionWindowNextMin: intClamp(
      raw.decisionWindowNextMin ?? d.decisionWindowNextMin,
      1,
      MAX_MINUTES,
    ),
    decisionWindowSoonMin: intClamp(
      raw.decisionWindowSoonMin ?? d.decisionWindowSoonMin,
      1,
      MAX_MINUTES,
    ),
    decisionWindowQueueMin: intClamp(
      raw.decisionWindowQueueMin ?? d.decisionWindowQueueMin,
      1,
      MAX_MINUTES,
    ),
    tierLimits,
    betbeatFeeBps: intClamp(raw.betbeatFeeBps ?? d.betbeatFeeBps, 0, 10_000),
    venueShareBps: intClamp(raw.venueShareBps ?? d.venueShareBps, 0, 10_000),
    minFitScore: clamp(raw.minFitScore ?? d.minFitScore, 0, 1),
    noRepeatWindowMin: intClamp(raw.noRepeatWindowMin ?? d.noRepeatWindowMin, 0, MAX_MINUTES),
    maxActiveRequestsPerGuest: intClamp(
      raw.maxActiveRequestsPerGuest ?? d.maxActiveRequestsPerGuest,
      1,
      100,
    ),
    nightSpendLimitCents: intClamp(
      raw.nightSpendLimitCents ?? d.nightSpendLimitCents,
      0,
      MAX_CENTS,
    ),
    mbwayTimeoutMin: intClamp(raw.mbwayTimeoutMin ?? d.mbwayTimeoutMin, 1, 60),
    guestMessagesEnabled: raw.guestMessagesEnabled ?? d.guestMessagesEnabled,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Parse a `session_settings` jsonb value into a sane SessionConfig.
 * - `null`/`undefined`/`{}` → full defaults.
 * - Unknown keys are dropped (older/newer config versions coexist).
 * - A field with the WRONG TYPE throws a ZodError (strictness beats
 *   silently mispricing a night).
 * - Numeric values are clamped into sane ranges and money becomes
 *   integer cents; the B5.6 tier-min invariant is enforced.
 */
export function parseSessionConfig(input: unknown): SessionConfig {
  const raw = sessionConfigInputSchema.parse(input ?? {});
  return normalize(raw);
}

/** Non-throwing variant, for request paths that must not 500. */
export function safeParseSessionConfig(
  input: unknown,
):
  | { success: true; config: SessionConfig }
  | { success: false; error: z.ZodError } {
  const parsed = sessionConfigInputSchema.safeParse(input ?? {});
  if (!parsed.success) return { success: false, error: parsed.error };
  return { success: true, config: normalize(parsed.data) };
}
