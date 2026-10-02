/**
 * computeQuote — the pure pricing engine (BRIEF B5.2, B5.5, B5.6, B5.7).
 *
 * No I/O, fully deterministic, `now` (epoch ms) is always injected.
 * The quote service (outside lib/pricing) adds quoteId/expiresAt and persists.
 *
 * Calculation sequence (B5.6, in this exact order):
 *   raw → SMOOTH → CLAMP → ROUND → ENFORCE ORDER → VALIDATE
 */
import { TIERS, type DemandLevel, type Tier } from "@/lib/domain/types";
import type { QuoteInput, QuoteResult, TierQuote } from "./types";
import { computeFit, fitLabel, normalizeGenre } from "./fit";
import {
  computeTierEtasMin,
  countActiveByTier,
  etaDisplayMin,
  soonLiberationEtaMin,
} from "./eta";

export const DEMAND_FACTOR_MIN = 0.85;
export const DEMAND_FACTOR_MAX = 2.0;
export const OCCUPANCY_FACTOR_MIN = 1.0;
/**
 * (1 + o²) is capped at its o = 1 value: beyond that SOON is unavailable
 * anyway, and capping keeps smoothing recovery fast after a full period.
 */
export const OCCUPANCY_FACTOR_MAX = 2.0;
export const SOON_MULTIPLIER = 2.0;
export const NEXT_MULTIPLIER = 3.5;
/** Guaranteed order (B5.6): each tier ≥ previous available tier + 5 €. */
export const MIN_TIER_GAP_CENTS = 500;
/** Rounding switches from 1 € to 5 € steps at this PRE-rounded value. */
export const ROUND_THRESHOLD_CENTS = 2000;
/** Published factors move at most ±15% per minute (B5.6 stability). */
export const SMOOTHING_MAX_RATIO_PER_MIN = 1.15;

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Demand level thresholds (B5.2): <0.3 / ≤0.7 / ≤1.2 / >1.2. */
export function demandLevelFor(rho: number): DemandLevel {
  if (rho < 0.3) return "low";
  if (rho <= 0.7) return "medium";
  if (rho <= 1.2) return "high";
  return "very_high";
}

/**
 * Price rounding (B5.6): nearest euro below 20 €, nearest multiple of 5 €
 * at and above 20 €. The threshold applies to the PRE-rounded cents value.
 */
export function roundPriceCents(cents: number): number {
  const grid = cents < ROUND_THRESHOLD_CENTS ? 100 : 500;
  return Math.round(cents / grid) * grid;
}

/**
 * Smoothing (B5.6): a published factor moves at most ±15% per minute from
 * its last published value, pro-rated by elapsed minutes (max ratio
 * 1.15^minutes), then re-clamped to the factor's own domain bounds.
 * No last published value → no smoothing.
 */
function smoothFactor(
  raw: number,
  lastPublished: number | null,
  elapsedMin: number,
  domainMin: number,
  domainMax: number,
): number {
  const bounded = clamp(raw, domainMin, domainMax);
  if (
    lastPublished === null ||
    !Number.isFinite(lastPublished) ||
    lastPublished <= 0
  ) {
    return bounded;
  }
  const maxRatio = Math.pow(SMOOTHING_MAX_RATIO_PER_MIN, Math.max(0, elapsedMin));
  const smoothed = clamp(bounded, lastPublished / maxRatio, lastPublished * maxRatio);
  return clamp(smoothed, domainMin, domainMax);
}

/** Resolve M_g for a track genre (canonicalized lookup, default 1.0). */
export function genreMultiplierFor(
  genreMultipliers: Record<string, number>,
  genre: string,
): number {
  const norm = normalizeGenre(genre);
  // Own-property lookups only: genre strings come from imported libraries and
  // may be hostile ("__proto__", "toString") — never read inherited members.
  let value: number | undefined = Object.hasOwn(genreMultipliers, genre)
    ? genreMultipliers[genre]
    : Object.hasOwn(genreMultipliers, norm)
      ? genreMultipliers[norm]
      : undefined;
  if (value === undefined) {
    for (const [key, candidate] of Object.entries(genreMultipliers)) {
      if (normalizeGenre(key) === norm) {
        value = candidate;
        break;
      }
    }
  }
  if (value === undefined) return 1;
  if (!Number.isFinite(value) || value <= 0) {
    throw new PricingError(`Invalid genre multiplier for "${genre}": ${value}`);
  }
  return value;
}

/** Full quote: computes musical fit from track/set, then prices. */
export function computeQuote(input: QuoteInput, now: number): QuoteResult {
  const fit = computeFit(
    input.track,
    input.set,
    input.session.genres,
    input.venue.adjacentGenres,
  );
  return computeQuoteFromFit(input, now, fit.score);
}

/**
 * Test/service seam: price with a given fit score S (B5.2 example fixes
 * S = 0.9). Everything else behaves exactly like computeQuote.
 */
export function computeQuoteFromFit(
  input: QuoteInput,
  now: number,
  fitScore: number,
): QuoteResult {
  assertValidInput(input, now, fitScore);
  const { session, queue, track } = input;
  const R = session.acceptanceRatePerHour;
  const counts = countActiveByTier(queue.active);

  // --- Demand (B5.2) -------------------------------------------------------
  const rho = queue.active.length / R;
  const demandRaw = clamp(0.85 + 0.5 * rho, DEMAND_FACTOR_MIN, DEMAND_FACTOR_MAX);

  // --- Fit factor (B5.2): off-style costs at most +50% ---------------------
  const fitFactor = 1 + 0.5 * (1 - fitScore);

  // --- SOON occupancy (B5.2) -----------------------------------------------
  const soonCapacity = Math.max(1, Math.floor((R * session.soonDeadlineMin) / 60));
  const occupancy = counts.SOON / soonCapacity;
  const occupancyFactorRaw = 1 + occupancy * occupancy;

  // --- SMOOTH (B5.6) -------------------------------------------------------
  const elapsedMin = session.lastPublished
    ? Math.max(0, (now - session.lastPublished.atMs) / 60_000)
    : 0;
  const demandFactor = smoothFactor(
    demandRaw,
    session.lastPublished?.demandFactor ?? null,
    elapsedMin,
    DEMAND_FACTOR_MIN,
    DEMAND_FACTOR_MAX,
  );
  const occupancyFactor = smoothFactor(
    occupancyFactorRaw,
    session.lastPublished?.occupancyFactor ?? null,
    elapsedMin,
    OCCUPANCY_FACTOR_MIN,
    OCCUPANCY_FACTOR_MAX,
  );

  // --- Raw prices (B5.2) ---------------------------------------------------
  const genreMultiplier = genreMultiplierFor(input.venue.genreMultipliers, track.genre);
  const queueRaw = session.basePriceCents * genreMultiplier * fitFactor * demandFactor;
  const rawByTier: Record<Tier, number> = {
    QUEUE: queueRaw,
    SOON: queueRaw * SOON_MULTIPLIER * occupancyFactor,
    NEXT: queueRaw * NEXT_MULTIPLIER,
  };

  // --- CLAMP → ROUND (B5.6) ------------------------------------------------
  // Limits beat the rounding grid: a rounded price is re-clamped so it can
  // never leave [min, max] (relevant when a limit is not itself on-grid).
  const prices = {} as Record<Tier, number>;
  for (const tier of TIERS) {
    const limits = session.tierLimits[tier];
    const clamped = clamp(rawByTier[tier], limits.minCents, limits.maxCents);
    prices[tier] = clamp(roundPriceCents(clamped), limits.minCents, limits.maxCents);
  }

  // --- ETAs (B5.5) ---------------------------------------------------------
  const etaByTier = computeTierEtasMin(queue, R);
  const soonFreesInMin = soonLiberationEtaMin(queue, session.soonDeadlineMin, now);

  // --- Availability (B5.2 / B5.5) ------------------------------------------
  // Track-level blocks apply to every tier and win over tier-level reasons.
  const trackBlockReason: TierQuote["reason"] | undefined = track.recentlyPlayed
    ? "recently_played"
    : session.minFitScore > 0 && fitScore < session.minFitScore
      ? "below_min_fit"
      : undefined;
  const tierReason: Record<Tier, TierQuote["reason"] | undefined> = {
    QUEUE:
      now + etaByTier.QUEUE * 60_000 > session.endsAtMs
        ? "no_slot_this_set"
        : undefined,
    SOON: occupancy >= 1 ? "soon_full" : undefined,
    NEXT: counts.NEXT > 0 ? "next_taken" : undefined,
  };
  // When SOON is full, its ETA becomes the liberation ETA: minutes until the
  // earliest active SOON hits its promise deadline and frees a slot.
  if (tierReason.SOON === "soon_full" && soonFreesInMin !== null) {
    etaByTier.SOON = soonFreesInMin;
  }

  // --- ENFORCE ORDER (B5.6) ------------------------------------------------
  // Each tier costs at least MIN_TIER_GAP_CENTS more than the previous
  // AVAILABLE tier; upper tiers are raised, re-clamped to their max, and
  // marked unavailable when the gap cannot be satisfied.
  const orderImpossible: Record<Tier, boolean> = {
    QUEUE: false,
    SOON: false,
    NEXT: false,
  };
  let previousAvailableCents: number | null = null;
  for (const tier of TIERS) {
    const limits = session.tierLimits[tier];
    if (previousAvailableCents !== null) {
      const floor = previousAvailableCents + MIN_TIER_GAP_CENTS;
      if (prices[tier] < floor) prices[tier] = floor;
      if (prices[tier] > limits.maxCents) prices[tier] = limits.maxCents;
      if (prices[tier] < floor) orderImpossible[tier] = true;
    }
    const blocked =
      trackBlockReason !== undefined ||
      tierReason[tier] !== undefined ||
      orderImpossible[tier];
    if (!blocked) previousAvailableCents = prices[tier];
  }

  // --- Assemble (B5.7) -----------------------------------------------------
  const tiers: TierQuote[] = TIERS.map((tier) => {
    const reason = trackBlockReason ?? tierReason[tier];
    const etaMin = etaByTier[tier];
    const quote: TierQuote = {
      tier,
      priceCents: prices[tier],
      etaMin,
      etaDisplayMin: etaDisplayMin(etaMin),
      available: reason === undefined && !orderImpossible[tier],
    };
    if (reason !== undefined) quote.reason = reason;
    return quote;
  });

  const result: QuoteResult = {
    fit: { score: fitScore, label: fitLabel(fitScore) },
    demand: { rho, level: demandLevelFor(rho) },
    tiers,
    breakdown: {
      base: session.basePriceCents,
      genreMultiplier,
      fitFactor,
      demandFactor,
      occupancy,
    },
    published: { demandFactor, occupancyFactor },
  };

  // --- VALIDATE (B5.6): never NaN / negative / out of limits ---------------
  assertValidResult(result, session.tierLimits);
  return result;
}

// --- List-price helpers (reused by the quote service / guest "from X €") ---

/** The tier's quoted price in cents, or null when the tier is unavailable. */
export function listPriceForTier(result: QuoteResult, tier: Tier): number | null {
  const quote = tierQuoteFor(result, tier);
  return quote && quote.available ? quote.priceCents : null;
}

/** The full TierQuote for a tier (present for every tier). */
export function tierQuoteFor(result: QuoteResult, tier: Tier): TierQuote | undefined {
  return result.tiers.find((t) => t.tier === tier);
}

/** Lowest available price — the guest-facing "from X €". Null if none. */
export function minListPriceCents(result: QuoteResult): number | null {
  let min: number | null = null;
  for (const quote of result.tiers) {
    if (quote.available && (min === null || quote.priceCents < min)) {
      min = quote.priceCents;
    }
  }
  return min;
}

// --- Guards ------------------------------------------------------------------

function assertValidInput(input: QuoteInput, now: number, fitScore: number): void {
  const { session } = input;
  if (!Number.isFinite(now)) {
    throw new PricingError(`"now" must be finite epoch ms, got ${now}`);
  }
  if (!Number.isInteger(session.basePriceCents) || session.basePriceCents < 0) {
    throw new PricingError(
      `basePriceCents must be a non-negative integer, got ${session.basePriceCents}`,
    );
  }
  if (
    !Number.isFinite(session.acceptanceRatePerHour) ||
    session.acceptanceRatePerHour <= 0
  ) {
    throw new PricingError(
      `acceptanceRatePerHour must be > 0, got ${session.acceptanceRatePerHour}`,
    );
  }
  if (!Number.isFinite(session.soonDeadlineMin) || session.soonDeadlineMin <= 0) {
    throw new PricingError(
      `soonDeadlineMin must be > 0, got ${session.soonDeadlineMin}`,
    );
  }
  if (!Number.isFinite(session.endsAtMs)) {
    throw new PricingError(`endsAtMs must be finite epoch ms, got ${session.endsAtMs}`);
  }
  if (!Number.isFinite(fitScore) || fitScore < 0 || fitScore > 1) {
    throw new PricingError(`fit score must be within [0, 1], got ${fitScore}`);
  }
  for (const tier of TIERS) {
    const limits = session.tierLimits[tier];
    if (
      !limits ||
      !Number.isInteger(limits.minCents) ||
      !Number.isInteger(limits.maxCents) ||
      limits.minCents < 0 ||
      limits.maxCents < limits.minCents
    ) {
      throw new PricingError(
        `tierLimits.${tier} must be integer cents with 0 ≤ min ≤ max`,
      );
    }
  }
}

function assertValidResult(
  result: QuoteResult,
  tierLimits: QuoteInput["session"]["tierLimits"],
): void {
  if (
    !Number.isFinite(result.fit.score) ||
    result.fit.score < 0 ||
    result.fit.score > 1
  ) {
    throw new PricingError(`invalid fit score ${result.fit.score}`);
  }
  if (!Number.isFinite(result.demand.rho) || result.demand.rho < 0) {
    throw new PricingError(`invalid rho ${result.demand.rho}`);
  }
  const factors = [
    result.breakdown.genreMultiplier,
    result.breakdown.fitFactor,
    result.breakdown.demandFactor,
    result.breakdown.occupancy,
    result.published.demandFactor,
    result.published.occupancyFactor,
  ];
  for (const factor of factors) {
    if (!Number.isFinite(factor) || factor < 0) {
      throw new PricingError(`invalid pricing factor ${factor}`);
    }
  }
  for (const quote of result.tiers) {
    const limits = tierLimits[quote.tier];
    if (
      !Number.isInteger(quote.priceCents) ||
      quote.priceCents < 0 ||
      Number.isNaN(quote.priceCents)
    ) {
      throw new PricingError(
        `${quote.tier} price must be a non-negative integer, got ${quote.priceCents}`,
      );
    }
    if (quote.priceCents < limits.minCents || quote.priceCents > limits.maxCents) {
      throw new PricingError(
        `${quote.tier} price ${quote.priceCents} outside limits [${limits.minCents}, ${limits.maxCents}]`,
      );
    }
    if (!Number.isFinite(quote.etaMin) || quote.etaMin < 0) {
      throw new PricingError(`${quote.tier} etaMin invalid: ${quote.etaMin}`);
    }
    if (!Number.isInteger(quote.etaDisplayMin) || quote.etaDisplayMin <= 0) {
      throw new PricingError(
        `${quote.tier} etaDisplayMin invalid: ${quote.etaDisplayMin}`,
      );
    }
  }
}
