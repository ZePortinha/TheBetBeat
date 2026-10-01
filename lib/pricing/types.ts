/**
 * Pricing engine contracts (BRIEF B5). computeQuote is a PURE function:
 * no I/O, deterministic, `now` injected. The quote service (outside
 * lib/pricing) adds quoteId/expiresAt and persists.
 */
import type { DemandLevel, FitLabel, Tier } from "@/lib/domain/types";

export interface PricingSessionInput {
  /** Base price B, cents (default 1000). */
  basePriceCents: number;
  /** Acceptance rate R — requests the DJ plays per hour (default 8). */
  acceptanceRatePerHour: number;
  /** Set end time, epoch ms UTC. */
  endsAtMs: number;
  /** Tier price limits, cents (B5.6 defaults). */
  tierLimits: Record<Tier, { minCents: number; maxCents: number }>;
  /** Session genres (for fit s_g). */
  genres: string[];
  /** SOON promise window, minutes (default 20) — used for C_s. */
  soonDeadlineMin: number;
  /**
   * Last published factors (for ±15%/min smoothing, B5.6).
   * Null on the session's first quote.
   */
  lastPublished: {
    atMs: number;
    demandFactor: number;
    occupancyFactor: number; // the (1 + o²) term
  } | null;
  /** Minimum fit the session accepts (0 disables). */
  minFitScore: number;
}

export interface PricingQueueInput {
  /** Paid-and-not-yet-played requests. */
  active: Array<{
    tier: Tier;
    amountCents: number;
    paidAtMs: number;
    trackDurationSec: number | null;
  }>;
  /** Seconds remaining of the currently playing track (null if none). */
  currentTrackRemainingSec: number | null;
}

export interface PricingTrackInput {
  genre: string;
  bpm: number | null;
  camelotKey: string | null;
  /** Played within the no-repeat window? (checked by caller; echoed for reason) */
  recentlyPlayed?: boolean;
}

export interface PricingSetInput {
  /** BPM of the last up-to-5 tracks (most recent last). */
  recentBpms: number[];
  /** Genres of the last up-to-5 tracks. */
  recentGenres: string[];
  /** Camelot key of the current/most recent track, if known. */
  currentKey: string | null;
}

export interface PricingVenueInput {
  /** Genre multipliers M_g (default 1.0). Keyed by canonical genre. */
  genreMultipliers: Record<string, number>;
  /** Adjacent-genre map (configurable, sensible defaults). */
  adjacentGenres?: Record<string, string[]>;
}

export interface QuoteInput {
  session: PricingSessionInput;
  queue: PricingQueueInput;
  track: PricingTrackInput;
  set: PricingSetInput;
  venue: PricingVenueInput;
}

export interface TierQuote {
  tier: Tier;
  priceCents: number;
  etaMin: number;
  /** Display form per B5.5: to the minute ≤10, multiples of 5 above. */
  etaDisplayMin: number;
  available: boolean;
  reason?:
    | "soon_full"
    | "next_taken"
    | "no_slot_this_set"
    | "below_min_fit"
    | "recently_played";
}

export interface QuoteResult {
  fit: { score: number; label: FitLabel };
  demand: { rho: number; level: DemandLevel };
  tiers: TierQuote[];
  breakdown: {
    base: number; // cents
    genreMultiplier: number;
    fitFactor: number;
    demandFactor: number;
    occupancy: number; // o = activeSoon / C_s
  };
  /** Factors to persist as lastPublished for smoothing. */
  published: { demandFactor: number; occupancyFactor: number };
}
