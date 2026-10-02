import { describe, expect, it } from "vitest";
import {
  computeTierEtasMin,
  countActiveByTier,
  etaDisplayMin,
  requestIntervalMin,
  soonLiberationEtaMin,
} from "./eta";
import type { PricingQueueInput } from "./types";

const NOW = 1_750_000_000_000;

function active(
  tier: "QUEUE" | "SOON" | "NEXT",
  paidAtMs = NOW - 5 * 60_000,
): PricingQueueInput["active"][number] {
  return { tier, amountCents: 1500, paidAtMs, trackDurationSec: 210 };
}

describe("requestIntervalMin", () => {
  it("is 60/R", () => {
    expect(requestIntervalMin(8)).toBe(7.5);
    expect(requestIntervalMin(12)).toBe(5);
  });
});

describe("countActiveByTier", () => {
  it("counts per tier with zero defaults", () => {
    const counts = countActiveByTier([
      active("QUEUE"),
      active("QUEUE"),
      active("SOON"),
    ]);
    expect(counts).toEqual({ QUEUE: 2, SOON: 1, NEXT: 0 });
  });
});

describe("computeTierEtasMin (B5.5)", () => {
  it("positions the new request after its tier (empty queue)", () => {
    const etas = computeTierEtasMin(
      { active: [], currentTrackRemainingSec: null },
      8,
    );
    expect(etas.NEXT).toBe(3.75); // i/2 when no current track info
    expect(etas.SOON).toBe(7.5); // (0 + 1) · 7.5
    expect(etas.QUEUE).toBe(7.5); // (0 + 0 + 1) · 7.5
  });

  it("uses the current track remaining time for NEXT when known", () => {
    const etas = computeTierEtasMin(
      { active: [], currentTrackRemainingSec: 180 },
      8,
    );
    expect(etas.NEXT).toBe(3);
  });

  it("stacks NEXT before SOON before QUEUE", () => {
    const queue: PricingQueueInput = {
      active: [active("NEXT"), active("SOON"), active("SOON"), active("QUEUE")],
      currentTrackRemainingSec: 60,
    };
    const etas = computeTierEtasMin(queue, 8);
    expect(etas.NEXT).toBe(1);
    expect(etas.SOON).toBe((1 + 2 + 1) * 7.5); // nNext + positionInSoon(3)
    expect(etas.QUEUE).toBe((1 + 2 + 1 + 1) * 7.5); // nNext + nSoon + positionInQueue(2)
  });

  it("never returns a negative NEXT eta", () => {
    const etas = computeTierEtasMin(
      { active: [], currentTrackRemainingSec: -30 },
      8,
    );
    expect(etas.NEXT).toBe(0);
  });
});

describe("soonLiberationEtaMin", () => {
  it("uses the earliest active SOON's paidAtMs + soonDeadlineMin", () => {
    const queue: PricingQueueInput = {
      active: [
        active("SOON", NOW - 5 * 60_000),
        active("SOON", NOW - 2 * 60_000),
        active("QUEUE", NOW - 30 * 60_000),
      ],
      currentTrackRemainingSec: null,
    };
    expect(soonLiberationEtaMin(queue, 20, NOW)).toBe(15); // 20 − 5
  });

  it("floors at 0 when the deadline already passed", () => {
    const queue: PricingQueueInput = {
      active: [active("SOON", NOW - 25 * 60_000)],
      currentTrackRemainingSec: null,
    };
    expect(soonLiberationEtaMin(queue, 20, NOW)).toBe(0);
  });

  it("is null without any active SOON", () => {
    const queue: PricingQueueInput = {
      active: [active("QUEUE")],
      currentTrackRemainingSec: null,
    };
    expect(soonLiberationEtaMin(queue, 20, NOW)).toBeNull();
  });
});

describe("etaDisplayMin (B5.5 presentation)", () => {
  it("rounds to the minute up to 10 minutes", () => {
    expect(etaDisplayMin(0.2)).toBe(1); // never shows 0
    expect(etaDisplayMin(3.4)).toBe(3);
    expect(etaDisplayMin(3.75)).toBe(4);
    expect(etaDisplayMin(10)).toBe(10);
  });

  it("rounds to multiples of 5 above 10 minutes", () => {
    expect(etaDisplayMin(10.4)).toBe(10);
    expect(etaDisplayMin(12.6)).toBe(15);
    expect(etaDisplayMin(23)).toBe(25);
    expect(etaDisplayMin(30)).toBe(30);
  });
});
