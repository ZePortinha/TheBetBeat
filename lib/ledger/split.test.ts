import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { BPS_DENOMINATOR, computeSplit } from "./split";

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
      djCents: 400,
    });
  });

  it("handles the extremes of the bps range", () => {
    expect(computeSplit(999, 0, 0)).toEqual({
      amountCents: 999,
      betbeatFeeCents: 0,
      venueCents: 0,
      djCents: 999,
    });
    expect(computeSplit(999, 10000, 10000)).toEqual({
      amountCents: 999,
      betbeatFeeCents: 999,
      venueCents: 0,
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
});
