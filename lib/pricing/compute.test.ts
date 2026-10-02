import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_CONFIG } from "@/lib/domain/types";
import {
  PricingError,
  computeQuote,
  computeQuoteFromFit,
  demandLevelFor,
  genreMultiplierFor,
  listPriceForTier,
  minListPriceCents,
  roundPriceCents,
  tierQuoteFor,
} from "./compute";
import type { PricingQueueInput, QuoteInput } from "./types";

const NOW = 1_750_000_000_000;
const MIN = 60_000;

function active(
  tier: "QUEUE" | "SOON" | "NEXT",
  paidAtMs = NOW - 5 * MIN,
): PricingQueueInput["active"][number] {
  return { tier, amountCents: 1500, paidAtMs, trackDurationSec: 210 };
}

function makeInput(overrides: {
  session?: Partial<QuoteInput["session"]>;
  queue?: Partial<QuoteInput["queue"]>;
  track?: Partial<QuoteInput["track"]>;
  set?: Partial<QuoteInput["set"]>;
  venue?: Partial<QuoteInput["venue"]>;
} = {}): QuoteInput {
  return {
    session: {
      basePriceCents: 1000,
      acceptanceRatePerHour: 8,
      endsAtMs: NOW + 240 * MIN,
      tierLimits: DEFAULT_SESSION_CONFIG.tierLimits,
      genres: ["house"],
      soonDeadlineMin: 20,
      lastPublished: null,
      minFitScore: 0,
      ...overrides.session,
    },
    queue: {
      active: [],
      currentTrackRemainingSec: null,
      ...overrides.queue,
    },
    track: {
      genre: "house",
      bpm: 124,
      camelotKey: "8A",
      recentlyPlayed: false,
      ...overrides.track,
    },
    set: {
      recentBpms: [122, 124, 126],
      recentGenres: ["house"],
      currentKey: "8A",
      ...overrides.set,
    },
    venue: {
      genreMultipliers: {},
      ...overrides.venue,
    },
  };
}

describe("THE B5.2 EXAMPLE (mandatory)", () => {
  it("B=10€, M_g=1, S=0.9, 3 active, R=8, 1 SOON → 11€ / 25€ / 40€", () => {
    const input = makeInput({
      queue: {
        active: [active("SOON"), active("QUEUE"), active("QUEUE")],
        currentTrackRemainingSec: 180,
      },
    });
    const result = computeQuoteFromFit(input, NOW, 0.9);

    expect(result.demand.rho).toBeCloseTo(0.375, 12);
    expect(result.demand.level).toBe("medium");
    expect(result.breakdown.base).toBe(1000);
    expect(result.breakdown.genreMultiplier).toBe(1);
    expect(result.breakdown.demandFactor).toBeCloseTo(1.0375, 12);
    expect(result.breakdown.fitFactor).toBeCloseTo(1.05, 12);
    expect(result.breakdown.occupancy).toBeCloseTo(0.5, 12); // C_s = 2
    expect(result.published.occupancyFactor).toBeCloseTo(1.25, 12);
    expect(result.published.demandFactor).toBeCloseTo(1.0375, 12);

    expect(tierQuoteFor(result, "QUEUE")?.priceCents).toBe(1100); // 10.89 → 11 €
    expect(tierQuoteFor(result, "SOON")?.priceCents).toBe(2500); // 27.23 → 25 €
    expect(tierQuoteFor(result, "NEXT")?.priceCents).toBe(4000); // 38.13 → 40 €
    expect(result.tiers.every((t) => t.available)).toBe(true);

    // ETAs: i = 7.5 min; NEXT uses the current track's remaining 3 min.
    expect(tierQuoteFor(result, "NEXT")?.etaMin).toBe(3);
    expect(tierQuoteFor(result, "SOON")?.etaMin).toBe(15);
    expect(tierQuoteFor(result, "QUEUE")?.etaMin).toBe(30);
    expect(tierQuoteFor(result, "QUEUE")?.etaDisplayMin).toBe(30);
  });
});

describe("empty queue (B5.8)", () => {
  it("prices near base with guaranteed order", () => {
    const result = computeQuote(makeInput(), NOW);
    expect(result.fit.score).toBe(1); // perfect genre/BPM/key match
    expect(result.demand.level).toBe("low");
    // D floor = 0.85 → QUEUE 850 → 900; SOON 1700; NEXT 2975 → 3000.
    expect(tierQuoteFor(result, "QUEUE")?.priceCents).toBe(900);
    expect(tierQuoteFor(result, "SOON")?.priceCents).toBe(1700);
    expect(tierQuoteFor(result, "NEXT")?.priceCents).toBe(3000);
    const [q, s, n] = result.tiers;
    expect(s!.priceCents - q!.priceCents).toBeGreaterThanOrEqual(500);
    expect(n!.priceCents - s!.priceCents).toBeGreaterThanOrEqual(500);
    expect(result.tiers.every((t) => t.available)).toBe(true);
  });
});

describe("rising demand (B5.8)", () => {
  it("is monotonically non-decreasing and never above the max", () => {
    let previous = 0;
    for (let n = 0; n <= 24; n++) {
      const input = makeInput({
        session: { endsAtMs: NOW + 6 * 60 * MIN },
        queue: {
          active: Array.from({ length: n }, () => active("QUEUE")),
          currentTrackRemainingSec: null,
        },
      });
      const result = computeQuoteFromFit(input, NOW, 1);
      const price = tierQuoteFor(result, "QUEUE")!.priceCents;
      expect(price).toBeGreaterThanOrEqual(previous);
      expect(price).toBeLessThanOrEqual(
        DEFAULT_SESSION_CONFIG.tierLimits.QUEUE.maxCents,
      );
      previous = price;
    }
  });

  it("clamps every tier to its max under extreme base prices", () => {
    const input = makeInput({ session: { basePriceCents: 100_000 } });
    const result = computeQuoteFromFit(input, NOW, 1);
    expect(tierQuoteFor(result, "QUEUE")?.priceCents).toBe(6000);
    expect(tierQuoteFor(result, "SOON")?.priceCents).toBe(12_000);
    expect(tierQuoteFor(result, "NEXT")?.priceCents).toBe(20_000);
    expect(result.tiers.every((t) => t.available)).toBe(true);
  });

  it("maps rho to the right demand level", () => {
    expect(demandLevelFor(0.29)).toBe("low");
    expect(demandLevelFor(0.3)).toBe("medium");
    expect(demandLevelFor(0.7)).toBe("medium");
    expect(demandLevelFor(0.71)).toBe("high");
    expect(demandLevelFor(1.2)).toBe("high");
    expect(demandLevelFor(1.21)).toBe("very_high");
  });
});

describe("SOON filling up (B5.8)", () => {
  function soonInput(nSoon: number): QuoteInput {
    // Total active held at 4 so rho (and D) stay constant across cases.
    const activeList = [
      ...Array.from({ length: nSoon }, (_, i) =>
        active("SOON", NOW - (5 - i) * MIN),
      ),
      ...Array.from({ length: 4 - nSoon }, () => active("QUEUE")),
    ];
    return makeInput({
      queue: { active: activeList, currentTrackRemainingSec: null },
    });
  }

  it("raises the SOON price as occupancy grows, then goes unavailable", () => {
    // R=8, soonDeadlineMin=20 → C_s = 2.
    const r0 = computeQuoteFromFit(soonInput(0), NOW, 1); // o = 0
    const r1 = computeQuoteFromFit(soonInput(1), NOW, 1); // o = 0.5
    const r2 = computeQuoteFromFit(soonInput(2), NOW, 1); // o = 1 → full

    expect(tierQuoteFor(r0, "SOON")?.priceCents).toBe(2000);
    expect(tierQuoteFor(r1, "SOON")?.priceCents).toBe(3000);
    expect(tierQuoteFor(r1, "SOON")!.priceCents).toBeGreaterThan(
      tierQuoteFor(r0, "SOON")!.priceCents,
    );

    const full = tierQuoteFor(r2, "SOON")!;
    expect(full.available).toBe(false);
    expect(full.reason).toBe("soon_full");
    expect(r2.breakdown.occupancy).toBe(1);
  });

  it("shows the liberation ETA when full (earliest SOON deadline)", () => {
    // Earliest SOON paid 5 min ago with a 20 min promise → frees in 15 min.
    const r2 = computeQuoteFromFit(soonInput(2), NOW, 1);
    const full = tierQuoteFor(r2, "SOON")!;
    expect(full.etaMin).toBeCloseTo(15, 10);
    expect(full.etaDisplayMin).toBe(15);
  });
});

describe("NEXT occupied (B5.8)", () => {
  it("is unavailable with reason next_taken", () => {
    const input = makeInput({
      queue: { active: [active("NEXT")], currentTrackRemainingSec: 120 },
    });
    const result = computeQuoteFromFit(input, NOW, 1);
    const next = tierQuoteFor(result, "NEXT")!;
    expect(next.available).toBe(false);
    expect(next.reason).toBe("next_taken");
    expect(tierQuoteFor(result, "QUEUE")?.available).toBe(true);
    expect(tierQuoteFor(result, "SOON")?.available).toBe(true);
    expect(listPriceForTier(result, "NEXT")).toBeNull();
  });
});

describe("off-style track (B5.8)", () => {
  it("costs at most +50% and carries the off_style label", () => {
    const offInput = makeInput({
      session: { genres: ["techno"] },
      track: { genre: "salsa", bpm: 95, camelotKey: "3A" },
      set: { recentBpms: [128, 128, 128], recentGenres: ["techno"], currentKey: "8A" },
    });
    const off = computeQuote(offInput, NOW);
    expect(off.fit.label).toBe("off_style");
    expect(off.breakdown.fitFactor).toBeLessThanOrEqual(1.5);

    // Worst case S = 0 is exactly +50% on the raw price.
    const worst = computeQuoteFromFit(makeInput(), NOW, 0);
    const best = computeQuoteFromFit(makeInput(), NOW, 1);
    expect(worst.breakdown.fitFactor).toBeCloseTo(1.5, 12);
    expect(best.breakdown.fitFactor).toBeCloseTo(1.0, 12);
    const rawRatio =
      (worst.breakdown.base *
        worst.breakdown.genreMultiplier *
        worst.breakdown.fitFactor *
        worst.breakdown.demandFactor) /
      (best.breakdown.base *
        best.breakdown.genreMultiplier *
        best.breakdown.fitFactor *
        best.breakdown.demandFactor);
    expect(rawRatio).toBeCloseTo(1.5, 12);
  });
});

describe("smoothing (B5.8): 30 quotes in one minute vary ≤ 15%", () => {
  const wideLimits = {
    QUEUE: { minCents: 500, maxCents: 100_000 },
    SOON: { minCents: 1500, maxCents: 200_000 },
    NEXT: { minCents: 2500, maxCents: 400_000 },
  };

  it("holds the demand factor within ±15% over the minute", () => {
    // Quote 0: calm floor (D = 0.85) establishes lastPublished.
    const first = computeQuoteFromFit(
      makeInput({ session: { basePriceCents: 10_000, tierLimits: wideLimits } }),
      NOW,
      1,
    );
    expect(first.published.demandFactor).toBeCloseTo(0.85, 12);

    // Then demand spikes (raw D would jump straight to 2.0) and 30 quotes
    // arrive 2 s apart, each chaining the previously published factors.
    let lastPublished = {
      atMs: NOW,
      demandFactor: first.published.demandFactor,
      occupancyFactor: first.published.occupancyFactor,
    };
    const factors: number[] = [];
    const prices: number[] = [];
    for (let k = 1; k <= 30; k++) {
      const at = NOW + k * 2000;
      const spiked = computeQuoteFromFit(
        makeInput({
          session: {
            basePriceCents: 10_000,
            tierLimits: wideLimits,
            endsAtMs: NOW + 12 * 60 * MIN,
            lastPublished,
          },
          queue: {
            active: Array.from({ length: 20 }, () => active("QUEUE")),
            currentTrackRemainingSec: null,
          },
        }),
        at,
        1,
      );
      factors.push(spiked.published.demandFactor);
      prices.push(tierQuoteFor(spiked, "QUEUE")!.priceCents);
      lastPublished = {
        atMs: at,
        demandFactor: spiked.published.demandFactor,
        occupancyFactor: spiked.published.occupancyFactor,
      };
    }

    const maxFactor = Math.max(...factors);
    const minFactor = Math.min(...factors);
    // Factors never drift more than 15% from the start of the minute.
    expect(maxFactor / first.published.demandFactor).toBeLessThanOrEqual(1.15 + 1e-9);
    expect(maxFactor / minFactor).toBeLessThanOrEqual(1.15 + 1e-9);
    // After exactly one minute of compounding: 0.85 · 1.15.
    expect(factors[29]).toBeCloseTo(0.85 * 1.15, 9);
    // Without smoothing D would be 2.0 — smoothing held it under 1.
    expect(factors[29]!).toBeLessThan(1);
    // Rounded prices stay within 15% plus at most one rounding step.
    expect(Math.max(...prices) / Math.min(...prices)).toBeLessThanOrEqual(1.21);
  });

  it("limits downward moves the same way (pro-rated by elapsed time)", () => {
    const result = computeQuoteFromFit(
      makeInput({
        session: {
          lastPublished: { atMs: NOW - 30_000, demandFactor: 2.0, occupancyFactor: 2.0 },
        },
      }),
      NOW,
      1,
    );
    // 30 s elapsed → min ratio 1/1.15^0.5.
    expect(result.published.demandFactor).toBeCloseTo(2 / Math.sqrt(1.15), 9);
  });

  it("smooths the occupancy factor too", () => {
    const input = makeInput({
      session: {
        lastPublished: { atMs: NOW - MIN, demandFactor: 1.0, occupancyFactor: 1.0 },
      },
      queue: {
        active: [active("SOON"), active("SOON")], // o = 1 → raw factor 2
        currentTrackRemainingSec: null,
      },
    });
    const result = computeQuoteFromFit(input, NOW, 1);
    expect(result.published.occupancyFactor).toBeCloseTo(1.15, 9);
    expect(tierQuoteFor(result, "SOON")?.available).toBe(false); // still full
  });
});

describe("QUEUE availability (B5.5 / task spec)", () => {
  it("goes unavailable with no_slot_this_set when the ETA passes end of set", () => {
    const input = makeInput({
      session: { endsAtMs: NOW + 10 * MIN },
      queue: { active: [active("QUEUE")], currentTrackRemainingSec: null },
    });
    const result = computeQuoteFromFit(input, NOW, 1); // QUEUE ETA = 15 min
    const queueTier = tierQuoteFor(result, "QUEUE")!;
    expect(queueTier.available).toBe(false);
    expect(queueTier.reason).toBe("no_slot_this_set");
    expect(tierQuoteFor(result, "SOON")?.available).toBe(true);
    expect(tierQuoteFor(result, "NEXT")?.available).toBe(true);
  });

  it("blocks all tiers below the session's minimum fit", () => {
    const input = makeInput({ session: { minFitScore: 0.5 } });
    const result = computeQuoteFromFit(input, NOW, 0.3);
    for (const tier of result.tiers) {
      expect(tier.available).toBe(false);
      expect(tier.reason).toBe("below_min_fit");
    }
  });

  it("passes recently_played through to every tier (wins over tier reasons)", () => {
    const input = makeInput({
      track: { recentlyPlayed: true },
      queue: { active: [active("NEXT")], currentTrackRemainingSec: null },
    });
    const result = computeQuoteFromFit(input, NOW, 1);
    for (const tier of result.tiers) {
      expect(tier.available).toBe(false);
      expect(tier.reason).toBe("recently_played");
    }
    expect(minListPriceCents(result)).toBeNull();
  });
});

describe("guaranteed order (B5.6)", () => {
  it("raises upper tiers to previous available + 5 €", () => {
    // A high QUEUE floor pushes QUEUE above the natural SOON/NEXT prices,
    // so order enforcement must raise the upper tiers.
    const input = makeInput({
      session: {
        tierLimits: {
          QUEUE: { minCents: 5000, maxCents: 6000 },
          SOON: { minCents: 1500, maxCents: 12_000 },
          NEXT: { minCents: 2500, maxCents: 20_000 },
        },
      },
    });
    const result = computeQuoteFromFit(input, NOW, 1);
    const q = tierQuoteFor(result, "QUEUE")!;
    const s = tierQuoteFor(result, "SOON")!;
    const n = tierQuoteFor(result, "NEXT")!;
    expect(q.priceCents).toBe(5000); // 850 clamped up to the QUEUE min
    expect(s.priceCents).toBe(5500); // raised from 1700 to QUEUE + 500
    expect(n.priceCents).toBe(6000); // raised from 3000 to SOON + 500
    expect(result.tiers.every((t) => t.available)).toBe(true);
  });

  it("marks a tier unavailable when the order cannot be satisfied", () => {
    const input = makeInput({
      session: {
        basePriceCents: 2000,
        tierLimits: {
          QUEUE: { minCents: 500, maxCents: 6000 },
          SOON: { minCents: 1500, maxCents: 2000 }, // impossible above QUEUE
          NEXT: { minCents: 2500, maxCents: 20_000 },
        },
      },
    });
    const result = computeQuoteFromFit(input, NOW, 1);
    const q = tierQuoteFor(result, "QUEUE")!;
    const s = tierQuoteFor(result, "SOON")!;
    const n = tierQuoteFor(result, "NEXT")!;
    expect(q.priceCents).toBe(1700); // 2000·0.85
    expect(s.available).toBe(false);
    expect(s.priceCents).toBe(2000); // capped at its max, gap impossible
    expect(s.reason).toBeUndefined(); // no reason code exists for this case
    // NEXT still orders against QUEUE (the previous AVAILABLE tier).
    expect(n.available).toBe(true);
    expect(n.priceCents).toBeGreaterThanOrEqual(q.priceCents + 500);
  });
});

describe("rounding (B5.6)", () => {
  it("rounds to 1 € below the 20 € threshold and 5 € at/above it", () => {
    expect(roundPriceCents(1089.375)).toBe(1100);
    expect(roundPriceCents(1949)).toBe(1900);
    expect(roundPriceCents(1951)).toBe(2000);
    expect(roundPriceCents(2000)).toBe(2000);
    expect(roundPriceCents(2723.4375)).toBe(2500);
    expect(roundPriceCents(3812.8125)).toBe(4000);
  });
});

describe("genre multiplier M_g", () => {
  it("resolves by canonical genre and defaults to 1", () => {
    expect(genreMultiplierFor({ "Hip-Hop": 1.2 }, "hip hop")).toBe(1.2);
    expect(genreMultiplierFor({ house: 0.9 }, "House")).toBe(0.9);
    expect(genreMultiplierFor({}, "techno")).toBe(1);
  });

  it("feeds into the price", () => {
    const result = computeQuoteFromFit(
      makeInput({ venue: { genreMultipliers: { house: 1.2 } } }),
      NOW,
      1,
    );
    expect(result.breakdown.genreMultiplier).toBe(1.2);
    // 1000 · 1.2 · 0.85 = 1020 → 1000
    expect(tierQuoteFor(result, "QUEUE")?.priceCents).toBe(1000);
  });
});

describe("validation (B5.6: never NaN/negative/out of limits)", () => {
  it("rejects a non-positive acceptance rate", () => {
    const input = makeInput({ session: { acceptanceRatePerHour: 0 } });
    expect(() => computeQuoteFromFit(input, NOW, 1)).toThrow(PricingError);
  });

  it("rejects inverted tier limits", () => {
    const input = makeInput({
      session: {
        tierLimits: {
          QUEUE: { minCents: 6000, maxCents: 500 },
          SOON: { minCents: 1500, maxCents: 12_000 },
          NEXT: { minCents: 2500, maxCents: 20_000 },
        },
      },
    });
    expect(() => computeQuoteFromFit(input, NOW, 1)).toThrow(PricingError);
  });

  it("rejects an out-of-range fit score and invalid multipliers", () => {
    expect(() => computeQuoteFromFit(makeInput(), NOW, 1.2)).toThrow(PricingError);
    expect(() => computeQuoteFromFit(makeInput(), NOW, -0.1)).toThrow(PricingError);
    const badVenue = makeInput({ venue: { genreMultipliers: { house: 0 } } });
    expect(() => computeQuoteFromFit(badVenue, NOW, 1)).toThrow(PricingError);
  });

  it("rejects a non-integer base price", () => {
    const input = makeInput({ session: { basePriceCents: 10.5 } });
    expect(() => computeQuoteFromFit(input, NOW, 1)).toThrow(PricingError);
  });
});

describe("list-price helpers", () => {
  it("expose per-tier and minimum list prices", () => {
    const result = computeQuoteFromFit(makeInput(), NOW, 1);
    expect(listPriceForTier(result, "QUEUE")).toBe(900);
    expect(listPriceForTier(result, "SOON")).toBe(1700);
    expect(tierQuoteFor(result, "NEXT")?.priceCents).toBe(3000);
    expect(minListPriceCents(result)).toBe(900);
  });
});
