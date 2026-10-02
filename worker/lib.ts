/**
 * Pure worker helpers — no I/O, no Date.now(): `now` (epoch ms) is always
 * injected (B11 "Tempo"). Everything here is unit-tested in
 * worker/lib.test.ts without a database.
 */

/* ------------------------------------------------------------------ */
/* Genre multiplier recommendation (BRIEF B5.4)                        */
/* ------------------------------------------------------------------ */

export const MULTIPLIER_MIN = 0.8;
export const MULTIPLIER_MAX = 1.3;
export const MULTIPLIER_STEP = 0.05;
/** Raise when conversion > 35% AND demand > 1 (B5.4). */
export const CONVERSION_RAISE_THRESHOLD = 0.35;
/** Lower when conversion < 15% (B5.4). */
export const CONVERSION_LOWER_THRESHOLD = 0.15;
export const DEMAND_RAISE_THRESHOLD = 1;

/** Quote counts for one genre inside the metrics window. */
export interface GenreQuoteStats {
  /** Quotes shown. */
  total: number;
  /** Quotes that turned into a PAID request (B5.4 conversion = paid / shown). */
  converted: number;
}

export interface GenreMetrics extends GenreQuoteStats {
  /** converted / total ∈ [0, 1]. */
  conversion: number;
  /** This genre's share of the venue's quotes ∈ [0, 1]. */
  share: number;
  /** share / average share (= share × number of genres) — B5.4 "demand". */
  demand: number;
}

/** Multipliers are stored with 2 decimals; kill float drift (1.1500000002). */
export function roundMultiplier(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Clamps into the allowed band [0.8, 1.3] (B5.4 + DB check constraint). */
export function clampMultiplier(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return roundMultiplier(Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, value)));
}

/**
 * Derives conversion / share / demand per genre for one venue.
 * `demand = share / avgShare`; the average share over N genres is 1/N, so
 * demand = share × N. An empty window yields an empty map.
 */
export function computeGenreMetrics(
  byGenre: ReadonlyMap<string, GenreQuoteStats>,
): Map<string, GenreMetrics> {
  const metrics = new Map<string, GenreMetrics>();
  let totalQuotes = 0;
  for (const stats of byGenre.values()) totalQuotes += stats.total;
  if (totalQuotes <= 0) return metrics;
  const genreCount = byGenre.size;
  for (const [genre, stats] of byGenre) {
    const share = stats.total / totalQuotes;
    metrics.set(genre, {
      total: stats.total,
      converted: stats.converted,
      conversion: stats.total > 0 ? stats.converted / stats.total : 0,
      share,
      demand: share * genreCount,
    });
  }
  return metrics;
}

/** Machine-readable reason key — the Console translates it (B5.4 "motivo"). */
export type MultiplierReason =
  | "high_conversion_high_demand"
  | "low_conversion"
  | "stable";

export interface MultiplierRecommendation {
  /** New recommended multiplier, clamped to [0.8, 1.3], 2 decimals. */
  recommended: number;
  /** recommended − clamp(current); 0 when nothing changes. */
  delta: number;
  reason: MultiplierReason;
}

/**
 * B5.4 adjustment rules:
 *   conversion > 35% AND demand > 1 → +0.05
 *   conversion < 15%                → −0.05
 *   otherwise                       → keep
 * Always clamped to [0.8, 1.3]. The thresholds are strict (>, <): exactly
 * 35% / 15% / demand exactly 1 keep the current value.
 */
export function recommendGenreMultiplier(
  current: number,
  metrics: Pick<GenreMetrics, "conversion" | "demand">,
): MultiplierRecommendation {
  const base = clampMultiplier(current);
  let reason: MultiplierReason = "stable";
  let next = base;
  if (
    metrics.conversion > CONVERSION_RAISE_THRESHOLD &&
    metrics.demand > DEMAND_RAISE_THRESHOLD
  ) {
    next = base + MULTIPLIER_STEP;
    reason = "high_conversion_high_demand";
  } else if (metrics.conversion < CONVERSION_LOWER_THRESHOLD) {
    next = base - MULTIPLIER_STEP;
    reason = "low_conversion";
  }
  const recommended = clampMultiplier(next);
  return { recommended, delta: roundMultiplier(recommended - base), reason };
}

/* ------------------------------------------------------------------ */
/* Refund retry backoff (BRIEF B4.4)                                   */
/* ------------------------------------------------------------------ */

/**
 * The deterministic base of pg-boss's exponential backoff, in seconds,
 * for retries 1..retryLimit:
 *
 *   start_after = now + retry_delay × 2^min(16, retry_count + 1) / 2
 *
 * i.e. delay × [1, 2, 4, 8, …] with the exponent capped at 16. pg-boss
 * additionally adds up to +100% random jitter on top of each value; this
 * helper returns the jitter-free floor so tests and docs stay exact.
 */
export function backoffScheduleSeconds(retryDelaySec: number, retryLimit: number): number[] {
  if (!Number.isFinite(retryDelaySec) || retryDelaySec <= 0 || retryLimit <= 0) return [];
  const delays: number[] = [];
  for (let retryCount = 0; retryCount < retryLimit; retryCount += 1) {
    delays.push((retryDelaySec * 2 ** Math.min(16, retryCount + 1)) / 2);
  }
  return delays;
}

/* ------------------------------------------------------------------ */
/* Reconciliation (BRIEF B4.3 "reconciliação diária automática")       */
/* ------------------------------------------------------------------ */

/** The UTC calendar day before `now`: [startMs, endMs) plus its ISO date. */
export interface UtcDayWindow {
  startMs: number;
  endMs: number;
  /** YYYY-MM-DD of the day covered (yesterday, UTC). */
  dayIso: string;
}

export function utcYesterdayWindow(now: number): UtcDayWindow {
  const today = new Date(now);
  const endMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const startMs = endMs - 24 * 60 * 60 * 1000; // UTC days are always 24 h
  return { startMs, endMs, dayIso: new Date(startMs).toISOString().slice(0, 10) };
}

/**
 * Cumulative money invariants, all integer cents, read in ONE consistent
 * snapshot: each pair is written atomically by the same transaction in the
 * services layer, so table totals and ledger totals must match exactly.
 */
export interface ReconciliationTotals {
  /** Σ payments.captured_cents. */
  paymentsCapturedCents: number;
  /** Σ psp_clearing debits (capture groups). */
  ledgerCapturedCents: number;
  /** Σ refunds.amount_cents where status = succeeded. */
  refundsSucceededCents: number;
  /** Σ guest_escrow debits with memo 'refund:%' (refund groups). */
  ledgerRefundedCents: number;
  /** Σ payouts.amount_cents where status = paid. */
  payoutsPaidCents: number;
  /** Σ venue/dj payable debits with memo 'payout:%' (payout groups). */
  ledgerPayoutCents: number;
}

export type ReconciliationKind = "captures" | "refunds" | "payouts";

export interface ReconciliationMismatch {
  kind: ReconciliationKind;
  tableCents: number;
  ledgerCents: number;
  /** tableCents − ledgerCents. */
  deltaCents: number;
}

export interface ReconciliationDiff {
  ok: boolean;
  mismatches: ReconciliationMismatch[];
}

/** Pure diff of the three money flows: captures, refunds and payouts. */
export function reconcileTotals(totals: ReconciliationTotals): ReconciliationDiff {
  const pairs: Array<[ReconciliationKind, number, number]> = [
    ["captures", totals.paymentsCapturedCents, totals.ledgerCapturedCents],
    ["refunds", totals.refundsSucceededCents, totals.ledgerRefundedCents],
    ["payouts", totals.payoutsPaidCents, totals.ledgerPayoutCents],
  ];
  const mismatches: ReconciliationMismatch[] = [];
  for (const [kind, tableCents, ledgerCents] of pairs) {
    if (tableCents !== ledgerCents) {
      mismatches.push({ kind, tableCents, ledgerCents, deltaCents: tableCents - ledgerCents });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

/* ------------------------------------------------------------------ */
/* Payout execution (BRIEF B4.5 — SEPA mocked until Phase 8)           */
/* ------------------------------------------------------------------ */

/** Deterministic mock SEPA transfer reference for a payout. */
export function mockSepaReference(payoutId: string, now: number): string {
  return `sepa_mock_${payoutId.replace(/-/g, "").slice(0, 12)}_${now}`;
}

/* ------------------------------------------------------------------ */
/* Startup table                                                       */
/* ------------------------------------------------------------------ */

export interface JobTableRow {
  queue: string;
  trigger: string;
  duty: string;
}

/** Plain-text table for the worker's startup log. */
export function formatJobTable(rows: readonly JobTableRow[]): string {
  const headers: JobTableRow = { queue: "queue", trigger: "trigger", duty: "duty" };
  const all = [headers, ...rows];
  const width = (key: keyof JobTableRow): number =>
    Math.max(...all.map((r) => r[key].length));
  const wq = width("queue");
  const wt = width("trigger");
  const line = (r: JobTableRow): string =>
    `  ${r.queue.padEnd(wq)}  ${r.trigger.padEnd(wt)}  ${r.duty}`;
  const separator = `  ${"-".repeat(wq)}  ${"-".repeat(wt)}  ${"-".repeat(width("duty"))}`;
  return [line(headers), separator, ...rows.map(line)].join("\n");
}
