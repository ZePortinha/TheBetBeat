/**
 * Property-based tests (B5.8, fast-check): arbitrary queues, session params
 * and base prices must never produce NaN, negatives, out-of-limit prices,
 * broken tier order or inconsistent availability flags.
 */
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { TIERS } from "@/lib/domain/types";
import {
  DEMAND_FACTOR_MAX,
  DEMAND_FACTOR_MIN,
  MIN_TIER_GAP_CENTS,
  OCCUPANCY_FACTOR_MAX,
  OCCUPANCY_FACTOR_MIN,
  SMOOTHING_MAX_RATIO_PER_MIN,
  computeQuote,
} from "./compute";
import type { QuoteInput } from "./types";

const NOW = 1_750_000_000_000;
const EPS = 1e-9;

const GENRE_POOL = [
  "house",
  "tech house",
  "techno",
  "hip hop",
  "reggaeton",
  "pop",
  "salsa",
  "edm",
  "amapiano",
];

const genreArb = fc.oneof(
  fc.constantFrom(...GENRE_POOL, ""),
  fc.string({ maxLength: 12 }),
);

const keyArb = fc.option(
  fc.constantFrom("1A", "5B", "8A", "8B", "12B", "Am", "F# Minor", "junk"),
  { nil: null },
);

const activeArb = fc.record({
  tier: fc.constantFrom(...TIERS),
  amountCents: fc.integer({ min: 0, max: 50_000 }),
  paidAtMs: fc.integer({ min: NOW - 60 * 60_000, max: NOW }),
  trackDurationSec: fc.option(fc.integer({ min: 60, max: 600 }), { nil: null }),
});

const limitsArb = fc
  .tuple(fc.integer({ min: 0, max: 10_000 }), fc.integer({ min: 500, max: 40_000 }))
  .map(([minCents, span]) => ({ minCents, maxCents: minCents + span }));

const lastPublishedArb = fc.option(
  fc.record({
    atMs: fc.integer({ min: NOW - 2 * 3_600_000, max: NOW }),
    demandFactor: fc.double({
      min: DEMAND_FACTOR_MIN,
      max: DEMAND_FACTOR_MAX,
      noNaN: true,
    }),
    occupancyFactor: fc.double({
      min: OCCUPANCY_FACTOR_MIN,
      max: OCCUPANCY_FACTOR_MAX,
      noNaN: true,
    }),
  }),
  { nil: null },
);

const sessionArb = fc.record({
  basePriceCents: fc.integer({ min: 100, max: 30_000 }),
  acceptanceRatePerHour: fc.integer({ min: 1, max: 30 }),
  endsAtMs: fc.integer({ min: NOW - 30 * 60_000, max: NOW + 6 * 3_600_000 }),
  tierLimits: fc.record({ QUEUE: limitsArb, SOON: limitsArb, NEXT: limitsArb }),
  genres: fc.array(genreArb, { maxLength: 3 }),
  soonDeadlineMin: fc.integer({ min: 5, max: 60 }),
  lastPublished: lastPublishedArb,
  minFitScore: fc.oneof(
    fc.constant(0),
    fc.double({ min: 0, max: 1, noNaN: true }),
  ),
});

const queueArb = fc.record({
  active: fc.array(activeArb, { maxLength: 25 }),
  currentTrackRemainingSec: fc.option(fc.integer({ min: 0, max: 900 }), {
    nil: null,
  }),
});

const trackArb = fc.record({
  genre: genreArb,
  bpm: fc.option(fc.double({ min: 40, max: 220, noNaN: true }), { nil: null }),
  camelotKey: keyArb,
  recentlyPlayed: fc.boolean(),
});

const setArb = fc.record({
  recentBpms: fc.array(fc.double({ min: 40, max: 220, noNaN: true }), {
    maxLength: 5,
  }),
  recentGenres: fc.array(genreArb, { maxLength: 5 }),
  currentKey: keyArb,
});

const venueArb = fc.record({
  genreMultipliers: fc.dictionary(
    fc.constantFrom(...GENRE_POOL),
    fc.double({ min: 0.5, max: 2, noNaN: true }),
    { maxKeys: 5 },
  ),
  adjacentGenres: fc.option(
    fc.dictionary(
      fc.constantFrom(...GENRE_POOL),
      fc.array(fc.constantFrom(...GENRE_POOL), { maxLength: 3 }),
      { maxKeys: 4 },
    ),
    { nil: undefined },
  ),
});

const inputArb: fc.Arbitrary<QuoteInput> = fc.record({
  session: sessionArb,
  queue: queueArb,
  track: trackArb,
  set: setArb,
  venue: venueArb,
});

describe("computeQuote properties (B5.8)", () => {
  it("never yields NaN, negatives, out-of-limit prices or a broken order", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = computeQuote(input, NOW);

        // Fit and demand are finite and in range.
        expect(result.fit.score).toBeGreaterThanOrEqual(0);
        expect(result.fit.score).toBeLessThanOrEqual(1);
        expect(Number.isFinite(result.demand.rho)).toBe(true);
        expect(result.demand.rho).toBeCloseTo(
          input.queue.active.length / input.session.acceptanceRatePerHour,
          10,
        );

        // Published factors stay in their domains.
        expect(result.published.demandFactor).toBeGreaterThanOrEqual(
          DEMAND_FACTOR_MIN - EPS,
        );
        expect(result.published.demandFactor).toBeLessThanOrEqual(
          DEMAND_FACTOR_MAX + EPS,
        );
        expect(result.published.occupancyFactor).toBeGreaterThanOrEqual(
          OCCUPANCY_FACTOR_MIN - EPS,
        );
        expect(result.published.occupancyFactor).toBeLessThanOrEqual(
          OCCUPANCY_FACTOR_MAX + EPS,
        );

        // Tiers come back complete, in canonical order, inside limits.
        expect(result.tiers.map((t) => t.tier)).toEqual([...TIERS]);
        for (const tier of result.tiers) {
          const limits = input.session.tierLimits[tier.tier];
          expect(Number.isInteger(tier.priceCents)).toBe(true);
          expect(tier.priceCents).toBeGreaterThanOrEqual(0);
          expect(tier.priceCents).toBeGreaterThanOrEqual(limits.minCents);
          expect(tier.priceCents).toBeLessThanOrEqual(limits.maxCents);
          expect(Number.isFinite(tier.etaMin)).toBe(true);
          expect(tier.etaMin).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(tier.etaDisplayMin)).toBe(true);
          expect(tier.etaDisplayMin).toBeGreaterThanOrEqual(1);
          if (tier.etaMin > 10) {
            expect(tier.etaDisplayMin % 5).toBe(0);
          }
        }

        // Guaranteed order between consecutive AVAILABLE tiers.
        let previousAvailable: number | null = null;
        for (const tier of result.tiers) {
          if (!tier.available) continue;
          if (previousAvailable !== null) {
            expect(tier.priceCents).toBeGreaterThanOrEqual(
              previousAvailable + MIN_TIER_GAP_CENTS,
            );
          }
          previousAvailable = tier.priceCents;
        }
      }),
      { numRuns: 300 },
    );
  });

  it("keeps availability flags consistent with their causes", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = computeQuote(input, NOW);
        const soon = result.tiers.find((t) => t.tier === "SOON")!;
        const next = result.tiers.find((t) => t.tier === "NEXT")!;
        const queueTier = result.tiers.find((t) => t.tier === "QUEUE")!;
        const hasActiveNext = input.queue.active.some((r) => r.tier === "NEXT");

        if (input.track.recentlyPlayed) {
          for (const tier of result.tiers) {
            expect(tier.available).toBe(false);
            expect(tier.reason).toBe("recently_played");
          }
          return;
        }
        if (
          input.session.minFitScore > 0 &&
          result.fit.score < input.session.minFitScore
        ) {
          for (const tier of result.tiers) {
            expect(tier.available).toBe(false);
            expect(tier.reason).toBe("below_min_fit");
          }
          return;
        }

        if (soon.available) expect(result.breakdown.occupancy).toBeLessThan(1);
        if (result.breakdown.occupancy >= 1) {
          expect(soon.available).toBe(false);
          expect(soon.reason).toBe("soon_full");
        }
        if (next.available) expect(hasActiveNext).toBe(false);
        if (hasActiveNext) {
          expect(next.available).toBe(false);
          expect(next.reason).toBe("next_taken");
        }
        if (queueTier.reason === "no_slot_this_set") {
          expect(NOW + queueTier.etaMin * 60_000).toBeGreaterThan(
            input.session.endsAtMs,
          );
        }
      }),
      { numRuns: 300 },
    );
  });

  it("respects the pro-rated smoothing bound against lastPublished", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const last = input.session.lastPublished;
        fc.pre(last !== null);
        const result = computeQuote(input, NOW);
        const elapsedMin = Math.max(0, (NOW - last!.atMs) / 60_000);
        const ratio = Math.pow(SMOOTHING_MAX_RATIO_PER_MIN, elapsedMin);
        expect(result.published.demandFactor).toBeLessThanOrEqual(
          Math.min(DEMAND_FACTOR_MAX, last!.demandFactor * ratio) + EPS,
        );
        expect(result.published.demandFactor).toBeGreaterThanOrEqual(
          Math.max(DEMAND_FACTOR_MIN, last!.demandFactor / ratio) - EPS,
        );
        expect(result.published.occupancyFactor).toBeLessThanOrEqual(
          Math.min(OCCUPANCY_FACTOR_MAX, last!.occupancyFactor * ratio) + EPS,
        );
        expect(result.published.occupancyFactor).toBeGreaterThanOrEqual(
          Math.max(OCCUPANCY_FACTOR_MIN, last!.occupancyFactor / ratio) - EPS,
        );
      }),
      { numRuns: 200 },
    );
  });

  it("is deterministic: same input and now, same quote", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const a = computeQuote(input, NOW);
        const b = computeQuote(input, NOW);
        expect(b).toEqual(a);
      }),
      { numRuns: 50 },
    );
  });
});
