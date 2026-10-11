import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { BPS_DENOMINATOR, PLATFORM_FEE_BPS, computeSplit } from "./split";

const bpsArb = fc.integer({ min: 0, max: BPS_DENOMINATOR });

describe("computeSplit", () => {
  it("conserves every cent: fee + venue + dj === amount (all non-negative ints)", () => {
    fc.assert(
      fc.property(fc.maxSafeNat(), bpsArb, bpsArb, (amount, feeBps, venueBps) => {
        const s = computeSplit(amount, feeBps, venueBps);
        expect(s.betbeatFeeCents + s.venueCents + s.djCents).toBe(amount);
        expect(s.amountCents).toBe(amount);
      }),
    );
  });

  it("never produces a negative part and the fee never exceeds the amount", () => {
    fc.assert(
      fc.property(fc.maxSafeNat(), bpsArb, bpsArb, (amount, feeBps, venueBps) => {
        const s = computeSplit(amount, feeBps, venueBps);
        for (const part of [s.betbeatFeeCents, s.venueCents, s.djCents]) {
          expect(Number.isSafeInteger(part)).toBe(true);
          expect(part).toBeGreaterThanOrEqual(0);
        }
        expect(s.betbeatFeeCents).toBeLessThanOrEqual(amount);
        expect(s.venueCents + s.djCents).toBe(amount - s.betbeatFeeCents);
      }),
    );
  });

  it("matches the B4.5 defaults: 20% fee, 50/50 venue/DJ", () => {
    // 11 € QUEUE example from B5.2 → fee 2.20 €, venue 4.40 €, DJ 4.40 €.
    expect(computeSplit(1100, 2000, 5000)).toEqual({
      amountCents: 1100,
      betbeatFeeCents: 220,
      venueCents: 440,
      promoterCents: 0,
      djCents: 440,
    });
  });

  it("rounds half-up on the fee and gives the rounding remainder to the DJ", () => {
    // fee = round(1001 · 0.2) = round(200.2) = 200; rest 801.
    // venue = round(801 · 0.5) = round(400.5) = 401; dj = 400.
    expect(computeSplit(1001, 2000, 5000)).toEqual({
      amountCents: 1001,
      betbeatFeeCents: 200,
      venueCents: 401,
      promoterCents: 0,
      djCents: 400,
    });
  });

  it("handles the extremes of the bps range", () => {
    expect(computeSplit(999, 0, 0)).toEqual({
      amountCents: 999,
      betbeatFeeCents: 0,
      venueCents: 0,
      promoterCents: 0,
      djCents: 999,
    });
    expect(computeSplit(999, 10000, 10000)).toEqual({
      amountCents: 999,
      betbeatFeeCents: 999,
      venueCents: 0,
      promoterCents: 0,
      djCents: 0,
    });
  });

  it("stays exact at the top of the safe-integer range (BigInt internals)", () => {
    const amount = Number.MAX_SAFE_INTEGER;
    const s = computeSplit(amount, 3333, 6667);
    expect(s.betbeatFeeCents + s.venueCents + s.djCents).toBe(amount);
  });

  it("rejects non-integer, negative or out-of-range inputs", () => {
    expect(() => computeSplit(10.5, 2000, 5000)).toThrow(RangeError);
    expect(() => computeSplit(-1, 2000, 5000)).toThrow(RangeError);
    expect(() => computeSplit(100, -1, 5000)).toThrow(RangeError);
    expect(() => computeSplit(100, 10001, 5000)).toThrow(RangeError);
    expect(() => computeSplit(100, 2000, 10001)).toThrow(RangeError);
    expect(() => computeSplit(Number.MAX_SAFE_INTEGER + 1, 2000, 5000)).toThrow(RangeError);
  });

  it("conserves every cent with a promoter: fee + venue + promoter + dj === amount", () => {
    fc.assert(
      fc.property(
        fc.maxSafeNat(),
        bpsArb,
        bpsArb,
        bpsArb,
        (amount, feeBps, a, b) => {
          const venueBps = Math.min(a, BPS_DENOMINATOR - b);
          const s = computeSplit(amount, feeBps, venueBps, b);
          for (const part of [s.betbeatFeeCents, s.venueCents, s.promoterCents, s.djCents]) {
            expect(Number.isSafeInteger(part)).toBe(true);
            expect(part).toBeGreaterThanOrEqual(0);
          }
          expect(s.betbeatFeeCents + s.venueCents + s.promoterCents + s.djCents).toBe(amount);
        },
      ),
    );
  });

  it("splits a 100 € event at the flat 11% fee: club 30%, promoter 20%, DJ the rest", () => {
    expect(PLATFORM_FEE_BPS).toBe(1100);
    expect(computeSplit(10_000, PLATFORM_FEE_BPS, 3000, 2000)).toEqual({
      amountCents: 10_000,
      betbeatFeeCents: 1100,
      venueCents: 2670,
      promoterCents: 1780,
      djCents: 4450,
    });
  });

  it("refuses club + promoter shares above 100%", () => {
    expect(() => computeSplit(100, 1100, 6000, 4001)).toThrow(RangeError);
  });
});
