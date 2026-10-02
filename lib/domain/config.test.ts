/**
 * Tests for session config parsing (B4.1 configurable windows, B5.6
 * protections): defaults, deep merge, type strictness, clamping and the
 * tier-min ordering invariant.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ZodError } from "zod";
import {
  MIN_TIER_STEP_CENTS,
  parseSessionConfig,
  safeParseSessionConfig,
} from "./config";
import { DEFAULT_SESSION_CONFIG } from "./types";

describe("defaults and merging", () => {
  it("null, undefined and {} all yield the full defaults", () => {
    expect(parseSessionConfig(null)).toEqual(DEFAULT_SESSION_CONFIG);
    expect(parseSessionConfig(undefined)).toEqual(DEFAULT_SESSION_CONFIG);
    expect(parseSessionConfig({})).toEqual(DEFAULT_SESSION_CONFIG);
  });

  it("the defaults themselves satisfy every invariant (fixed point)", () => {
    expect(parseSessionConfig(DEFAULT_SESSION_CONFIG)).toEqual(DEFAULT_SESSION_CONFIG);
  });

  it("deep-merges a partial override, keeping untouched defaults", () => {
    const config = parseSessionConfig({ basePriceCents: 1200, soonDeadlineMin: 25 });
    expect(config.basePriceCents).toBe(1200);
    expect(config.soonDeadlineMin).toBe(25);
    expect(config.acceptanceRatePerHour).toBe(DEFAULT_SESSION_CONFIG.acceptanceRatePerHour);
    expect(config.tierLimits).toEqual(DEFAULT_SESSION_CONFIG.tierLimits);
  });

  it("deep-merges nested tierLimits per tier and per bound", () => {
    const config = parseSessionConfig({ tierLimits: { SOON: { maxCents: 15000 } } });
    expect(config.tierLimits.SOON).toEqual({ minCents: 1500, maxCents: 15000 });
    expect(config.tierLimits.QUEUE).toEqual(DEFAULT_SESSION_CONFIG.tierLimits.QUEUE);
    expect(config.tierLimits.NEXT).toEqual(DEFAULT_SESSION_CONFIG.tierLimits.NEXT);
  });

  it("drops unknown keys (config versions can coexist)", () => {
    const config = parseSessionConfig({ legacyField: true, basePriceCents: 1100 });
    expect(config).not.toHaveProperty("legacyField");
    expect(config.basePriceCents).toBe(1100);
  });
});

describe("type strictness", () => {
  it("throws on wrong-typed fields instead of silently coercing", () => {
    expect(() => parseSessionConfig({ basePriceCents: "1000" })).toThrow(ZodError);
    expect(() => parseSessionConfig({ acceptanceRatePerHour: "8" })).toThrow(ZodError);
    expect(() => parseSessionConfig({ guestMessagesEnabled: "yes" })).toThrow(ZodError);
    expect(() => parseSessionConfig({ tierLimits: { QUEUE: { minCents: "500" } } })).toThrow(
      ZodError,
    );
    expect(() => parseSessionConfig({ basePriceCents: Number.POSITIVE_INFINITY })).toThrow(
      ZodError,
    );
  });

  it("throws on non-object jsonb values", () => {
    expect(() => parseSessionConfig("config")).toThrow(ZodError);
    expect(() => parseSessionConfig(42)).toThrow(ZodError);
    expect(() => parseSessionConfig([1, 2, 3])).toThrow(ZodError);
  });

  it("safeParseSessionConfig never throws", () => {
    const bad = safeParseSessionConfig({ basePriceCents: "oops" });
    expect(bad.success).toBe(false);
    const good = safeParseSessionConfig({ basePriceCents: 1200 });
    if (!good.success) throw new Error("expected success");
    expect(good.config.basePriceCents).toBe(1200);
    expect(good.config).toEqual(parseSessionConfig({ basePriceCents: 1200 }));
  });
});

describe("clamping insane values", () => {
  it("acceptance rate R is clamped to at least 1", () => {
    expect(parseSessionConfig({ acceptanceRatePerHour: 0 }).acceptanceRatePerHour).toBe(1);
    expect(parseSessionConfig({ acceptanceRatePerHour: -8 }).acceptanceRatePerHour).toBe(1);
    expect(parseSessionConfig({ acceptanceRatePerHour: 0.2 }).acceptanceRatePerHour).toBe(1);
    expect(parseSessionConfig({ acceptanceRatePerHour: 1e9 }).acceptanceRatePerHour).toBe(1000);
  });

  it("base price is clamped inside the QUEUE tier limits (B5.6)", () => {
    expect(parseSessionConfig({ basePriceCents: 100 }).basePriceCents).toBe(500);
    expect(parseSessionConfig({ basePriceCents: 999_999 }).basePriceCents).toBe(6000);
    // And against CUSTOM queue limits, not the defaults.
    const custom = parseSessionConfig({
      basePriceCents: 100,
      tierLimits: { QUEUE: { minCents: 2000, maxCents: 8000 } },
    });
    expect(custom.basePriceCents).toBe(2000);
  });

  it("money becomes integer cents (rounded)", () => {
    expect(parseSessionConfig({ basePriceCents: 1000.4 }).basePriceCents).toBe(1000);
    expect(parseSessionConfig({ nightSpendLimitCents: 15000.6 }).nightSpendLimitCents).toBe(15001);
    expect(
      parseSessionConfig({ tierLimits: { QUEUE: { minCents: 500.4 } } }).tierLimits.QUEUE.minCents,
    ).toBe(500);
  });

  it("windows and deadlines are at least 1 minute", () => {
    const config = parseSessionConfig({
      soonDeadlineMin: 0,
      nextDeadlineMin: -5,
      decisionWindowNextMin: 0,
      mbwayTimeoutMin: -1,
    });
    expect(config.soonDeadlineMin).toBe(1);
    expect(config.nextDeadlineMin).toBe(1);
    expect(config.decisionWindowNextMin).toBe(1);
    expect(config.mbwayTimeoutMin).toBe(1);
  });

  it("fee/split bps stay inside [0, 10000] and fit score inside [0, 1]", () => {
    const config = parseSessionConfig({
      betbeatFeeBps: 25_000,
      venueShareBps: -100,
      minFitScore: 7,
    });
    expect(config.betbeatFeeBps).toBe(10_000);
    expect(config.venueShareBps).toBe(0);
    expect(config.minFitScore).toBe(1);
    expect(parseSessionConfig({ minFitScore: -1 }).minFitScore).toBe(0);
  });
});

describe("B5.6 tier ordering invariant", () => {
  it("raises each tier's min to at least the previous min + 500", () => {
    const config = parseSessionConfig({
      tierLimits: {
        QUEUE: { minCents: 2000 },
        SOON: { minCents: 2100 },
        NEXT: { minCents: 2600 },
      },
    });
    expect(config.tierLimits.QUEUE.minCents).toBe(2000);
    expect(config.tierLimits.SOON.minCents).toBe(2000 + MIN_TIER_STEP_CENTS);
    expect(config.tierLimits.NEXT.minCents).toBe(2500 + MIN_TIER_STEP_CENTS);
  });

  it("keeps compliant mins untouched", () => {
    const config = parseSessionConfig({
      tierLimits: {
        QUEUE: { minCents: 1000 },
        SOON: { minCents: 2000 },
        NEXT: { minCents: 4000 },
      },
    });
    expect(config.tierLimits.SOON.minCents).toBe(2000);
    expect(config.tierLimits.NEXT.minCents).toBe(4000);
  });

  it("raises max to min when a range would be empty", () => {
    const config = parseSessionConfig({
      tierLimits: { SOON: { minCents: 3000, maxCents: 100 } },
    });
    expect(config.tierLimits.SOON.maxCents).toBe(config.tierLimits.SOON.minCents);
  });

  it("negative cents floor at 0 and the chain still holds", () => {
    const config = parseSessionConfig({
      tierLimits: {
        QUEUE: { minCents: -500, maxCents: -1 },
        SOON: { minCents: -500 },
        NEXT: { minCents: -500 },
      },
    });
    expect(config.tierLimits.QUEUE.minCents).toBe(0);
    expect(config.tierLimits.SOON.minCents).toBe(MIN_TIER_STEP_CENTS);
    expect(config.tierLimits.NEXT.minCents).toBe(2 * MIN_TIER_STEP_CENTS);
    expect(config.tierLimits.QUEUE.maxCents).toBeGreaterThanOrEqual(0);
  });
});

describe("property: any numeric garbage still yields a sane config", () => {
  const anyNumber = fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e9, max: 1e9 });
  const partialArb = fc.record(
    {
      basePriceCents: anyNumber,
      acceptanceRatePerHour: anyNumber,
      soonDeadlineMin: anyNumber,
      nextDeadlineMin: anyNumber,
      decisionWindowNextMin: anyNumber,
      decisionWindowSoonMin: anyNumber,
      decisionWindowQueueMin: anyNumber,
      betbeatFeeBps: anyNumber,
      venueShareBps: anyNumber,
      minFitScore: anyNumber,
      noRepeatWindowMin: anyNumber,
      maxActiveRequestsPerGuest: anyNumber,
      nightSpendLimitCents: anyNumber,
      mbwayTimeoutMin: anyNumber,
      guestMessagesEnabled: fc.boolean(),
      tierLimits: fc.record(
        {
          QUEUE: fc.record({ minCents: anyNumber, maxCents: anyNumber }, { requiredKeys: [] }),
          SOON: fc.record({ minCents: anyNumber, maxCents: anyNumber }, { requiredKeys: [] }),
          NEXT: fc.record({ minCents: anyNumber, maxCents: anyNumber }, { requiredKeys: [] }),
        },
        { requiredKeys: [] },
      ),
    },
    { requiredKeys: [] },
  );

  it("holds every invariant", () => {
    fc.assert(
      fc.property(partialArb, (partial) => {
        const config = parseSessionConfig(partial);

        expect(config.acceptanceRatePerHour).toBeGreaterThanOrEqual(1);

        const { QUEUE, SOON, NEXT } = config.tierLimits;
        for (const limits of [QUEUE, SOON, NEXT]) {
          expect(Number.isInteger(limits.minCents)).toBe(true);
          expect(Number.isInteger(limits.maxCents)).toBe(true);
          expect(limits.minCents).toBeGreaterThanOrEqual(0);
          expect(limits.maxCents).toBeGreaterThanOrEqual(limits.minCents);
        }
        expect(SOON.minCents).toBeGreaterThanOrEqual(QUEUE.minCents + MIN_TIER_STEP_CENTS);
        expect(NEXT.minCents).toBeGreaterThanOrEqual(SOON.minCents + MIN_TIER_STEP_CENTS);

        expect(Number.isInteger(config.basePriceCents)).toBe(true);
        expect(config.basePriceCents).toBeGreaterThanOrEqual(QUEUE.minCents);
        expect(config.basePriceCents).toBeLessThanOrEqual(QUEUE.maxCents);

        for (const minutesField of [
          config.soonDeadlineMin,
          config.nextDeadlineMin,
          config.decisionWindowNextMin,
          config.decisionWindowSoonMin,
          config.decisionWindowQueueMin,
          config.mbwayTimeoutMin,
        ]) {
          expect(Number.isInteger(minutesField)).toBe(true);
          expect(minutesField).toBeGreaterThanOrEqual(1);
        }

        expect(config.betbeatFeeBps).toBeGreaterThanOrEqual(0);
        expect(config.betbeatFeeBps).toBeLessThanOrEqual(10_000);
        expect(config.venueShareBps).toBeGreaterThanOrEqual(0);
        expect(config.venueShareBps).toBeLessThanOrEqual(10_000);
        expect(config.minFitScore).toBeGreaterThanOrEqual(0);
        expect(config.minFitScore).toBeLessThanOrEqual(1);
        expect(config.noRepeatWindowMin).toBeGreaterThanOrEqual(0);
        expect(config.maxActiveRequestsPerGuest).toBeGreaterThanOrEqual(1);
        expect(config.nightSpendLimitCents).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 300 },
    );
  });
});
