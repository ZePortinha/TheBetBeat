/**
 * Unit tests for the pure worker helpers (no database, no I/O).
 * Covers the B5.4 multiplier rules incl. clamping, the pg-boss backoff
 * schedule, the UTC day window and the reconciliation diff.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CONVERSION_LOWER_THRESHOLD,
  CONVERSION_RAISE_THRESHOLD,
  MULTIPLIER_MAX,
  MULTIPLIER_MIN,
  backoffScheduleSeconds,
  clampMultiplier,
  computeGenreMetrics,
  formatJobTable,
  mockSepaReference,
  recommendGenreMultiplier,
  reconcileTotals,
  roundMultiplier,
  utcYesterdayWindow,
  type GenreQuoteStats,
  type ReconciliationTotals,
} from "./lib";

/* ------------------------------------------------------------------ */
/* Genre multiplier rules (B5.4)                                       */
/* ------------------------------------------------------------------ */

describe("recommendGenreMultiplier", () => {
  it("raises by 0.05 when conversion > 35% and demand > 1", () => {
    const r = recommendGenreMultiplier(1.0, { conversion: 0.4, demand: 1.2 });
    expect(r.recommended).toBe(1.05);
    expect(r.delta).toBe(0.05);
    expect(r.reason).toBe("high_conversion_high_demand");
  });

  it("lowers by 0.05 when conversion < 15%", () => {
    const r = recommendGenreMultiplier(1.0, { conversion: 0.1, demand: 2 });
    expect(r.recommended).toBe(0.95);
    expect(r.delta).toBe(-0.05);
    expect(r.reason).toBe("low_conversion");
  });

  it("keeps the value in the middle band", () => {
    const r = recommendGenreMultiplier(1.1, { conversion: 0.25, demand: 1.5 });
    expect(r.recommended).toBe(1.1);
    expect(r.delta).toBe(0);
    expect(r.reason).toBe("stable");
  });

  it("thresholds are strict: exactly 35% / demand 1 / 15% hold", () => {
    expect(
      recommendGenreMultiplier(1.0, {
        conversion: CONVERSION_RAISE_THRESHOLD,
        demand: 2,
      }).reason,
    ).toBe("stable");
    expect(
      recommendGenreMultiplier(1.0, { conversion: 0.5, demand: 1 }).reason,
    ).toBe("stable");
    expect(
      recommendGenreMultiplier(1.0, {
        conversion: CONVERSION_LOWER_THRESHOLD,
        demand: 0.5,
      }).reason,
    ).toBe("stable");
  });

  it("high demand alone never raises when conversion is low", () => {
    const r = recommendGenreMultiplier(1.0, { conversion: 0.1, demand: 5 });
    expect(r.recommended).toBe(0.95); // conversion < 15% wins
  });

  it("clamps at the 1.3 ceiling", () => {
    expect(recommendGenreMultiplier(1.3, { conversion: 0.9, demand: 3 }).recommended).toBe(
      1.3,
    );
    expect(recommendGenreMultiplier(1.28, { conversion: 0.9, demand: 3 }).recommended).toBe(
      1.3,
    );
  });

  it("clamps at the 0.8 floor", () => {
    expect(recommendGenreMultiplier(0.8, { conversion: 0.05, demand: 1 }).recommended).toBe(
      0.8,
    );
    expect(recommendGenreMultiplier(0.82, { conversion: 0.05, demand: 1 }).recommended).toBe(
      0.8,
    );
  });

  it("normalizes an out-of-band current value before adjusting", () => {
    // DB constraint forbids these, but the math must still behave.
    expect(recommendGenreMultiplier(2.0, { conversion: 0.5, demand: 2 }).recommended).toBe(
      1.3,
    );
    expect(recommendGenreMultiplier(0.1, { conversion: 0.1, demand: 1 }).recommended).toBe(
      0.8,
    );
  });

  it("never produces float drift (two decimals always)", () => {
    const r = recommendGenreMultiplier(1.15, { conversion: 0.5, demand: 2 });
    expect(r.recommended).toBe(1.2);
  });

  it("property: the recommendation always lands inside [0.8, 1.3]", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 5, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 10, noNaN: true }),
        (current, conversion, demand) => {
          const r = recommendGenreMultiplier(current, { conversion, demand });
          expect(r.recommended).toBeGreaterThanOrEqual(MULTIPLIER_MIN);
          expect(r.recommended).toBeLessThanOrEqual(MULTIPLIER_MAX);
          expect(Math.round(r.recommended * 100)).toBe(r.recommended * 100);
        },
      ),
    );
  });
});

describe("clampMultiplier / roundMultiplier", () => {
  it("clamps and rounds", () => {
    expect(clampMultiplier(1.7)).toBe(1.3);
    expect(clampMultiplier(0.1)).toBe(0.8);
    expect(clampMultiplier(1.0500000000000002)).toBe(1.05);
    expect(roundMultiplier(1.1500000000000001)).toBe(1.15);
  });

  it("falls back to 1 on non-finite input", () => {
    expect(clampMultiplier(Number.NaN)).toBe(1);
    expect(clampMultiplier(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("computeGenreMetrics", () => {
  it("derives conversion, share and demand per genre", () => {
    const stats = new Map<string, GenreQuoteStats>([
      ["house", { total: 60, converted: 30 }],
      ["techno", { total: 30, converted: 3 }],
      ["pop", { total: 10, converted: 1 }],
    ]);
    const metrics = computeGenreMetrics(stats);
    const house = metrics.get("house");
    const techno = metrics.get("techno");
    expect(house).toBeDefined();
    expect(house?.conversion).toBeCloseTo(0.5, 10);
    expect(house?.share).toBeCloseTo(0.6, 10);
    // avg share over 3 genres = 1/3 → demand = share × 3
    expect(house?.demand).toBeCloseTo(1.8, 10);
    expect(techno?.demand).toBeCloseTo(0.9, 10);
  });

  it("returns an empty map for an empty window", () => {
    expect(computeGenreMetrics(new Map()).size).toBe(0);
    expect(
      computeGenreMetrics(new Map([["house", { total: 0, converted: 0 }]])).size,
    ).toBe(0);
  });

  it("property: shares sum to 1 and demand averages 1", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 12 }),
          fc.record({
            total: fc.integer({ min: 1, max: 1000 }),
            converted: fc.integer({ min: 0, max: 1000 }),
          }),
          { minKeys: 1, maxKeys: 8 },
        ),
        (byGenre) => {
          const map = new Map(Object.entries(byGenre));
          const metrics = computeGenreMetrics(map);
          let shareSum = 0;
          let demandSum = 0;
          for (const m of metrics.values()) {
            shareSum += m.share;
            demandSum += m.demand;
          }
          expect(shareSum).toBeCloseTo(1, 9);
          expect(demandSum / metrics.size).toBeCloseTo(1, 9);
        },
      ),
    );
  });
});

/* ------------------------------------------------------------------ */
/* Backoff (B4.4)                                                      */
/* ------------------------------------------------------------------ */

describe("backoffScheduleSeconds", () => {
  it("doubles from the base delay (pg-boss formula, jitter-free floor)", () => {
    expect(backoffScheduleSeconds(60, 4)).toEqual([60, 120, 240, 480]);
    expect(backoffScheduleSeconds(30, 5)).toEqual([30, 60, 120, 240, 480]);
  });

  it("caps the exponent at 2^16", () => {
    const schedule = backoffScheduleSeconds(1, 20);
    expect(schedule[15]).toBe(2 ** 16 / 2);
    expect(schedule[16]).toBe(2 ** 16 / 2); // capped from here on
    expect(schedule[19]).toBe(2 ** 16 / 2);
  });

  it("is empty for a non-positive delay or limit", () => {
    expect(backoffScheduleSeconds(0, 5)).toEqual([]);
    expect(backoffScheduleSeconds(60, 0)).toEqual([]);
    expect(backoffScheduleSeconds(Number.NaN, 5)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Reconciliation (B4.3)                                               */
/* ------------------------------------------------------------------ */

describe("utcYesterdayWindow", () => {
  it("covers exactly the previous UTC day", () => {
    // 2026-10-02T14:30:00Z → yesterday = 2026-10-01 UTC
    const now = Date.UTC(2026, 9, 2, 14, 30, 0);
    const w = utcYesterdayWindow(now);
    expect(w.dayIso).toBe("2026-10-01");
    expect(new Date(w.startMs).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(new Date(w.endMs).toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(w.endMs - w.startMs).toBe(24 * 60 * 60 * 1000);
  });

  it("handles midnight itself (the whole previous day)", () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const w = utcYesterdayWindow(now);
    expect(w.dayIso).toBe("2025-12-31");
  });
});

describe("reconcileTotals", () => {
  const balanced: ReconciliationTotals = {
    paymentsCapturedCents: 10_000,
    ledgerCapturedCents: 10_000,
    refundsSucceededCents: 2_500,
    ledgerRefundedCents: 2_500,
    payoutsPaidCents: 6_000,
    ledgerPayoutCents: 6_000,
  };

  it("is ok when every pair matches", () => {
    const diff = reconcileTotals(balanced);
    expect(diff.ok).toBe(true);
    expect(diff.mismatches).toEqual([]);
  });

  it("reports each mismatching pair with its signed delta", () => {
    const diff = reconcileTotals({
      ...balanced,
      ledgerCapturedCents: 9_000,
      refundsSucceededCents: 2_600,
    });
    expect(diff.ok).toBe(false);
    expect(diff.mismatches).toEqual([
      { kind: "captures", tableCents: 10_000, ledgerCents: 9_000, deltaCents: 1_000 },
      { kind: "refunds", tableCents: 2_600, ledgerCents: 2_500, deltaCents: 100 },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

describe("mockSepaReference", () => {
  it("is deterministic and dash-free", () => {
    const ref = mockSepaReference("aabbccdd-1122-4333-8444-555566667777", 1_700_000_000_000);
    expect(ref).toBe("sepa_mock_aabbccdd1122_1700000000000");
    expect(mockSepaReference("aabbccdd-1122-4333-8444-555566667777", 1_700_000_000_000)).toBe(
      ref,
    );
  });
});

describe("formatJobTable", () => {
  it("renders aligned columns with a header", () => {
    const table = formatJobTable([
      { queue: "a", trigger: "cron", duty: "x" },
      { queue: "longer-name", trigger: "queue", duty: "y" },
    ]);
    const lines = table.split("\n");
    expect(lines[0]).toContain("queue");
    expect(lines).toHaveLength(4); // header + separator + 2 rows
    expect(lines[2]).toContain("a");
    expect(lines[3]).toContain("longer-name");
  });
});
