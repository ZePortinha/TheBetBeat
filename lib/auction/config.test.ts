import { describe, expect, it } from "vitest";
import { auctionConfigProblems, DEFAULT_AUCTION_CONFIG, parseAuctionConfig } from "./config";

describe("parseAuctionConfig", () => {
  it("gives the club defaults for an empty or missing blob", () => {
    expect(parseAuctionConfig(undefined)).toEqual(DEFAULT_AUCTION_CONFIG);
    expect(parseAuctionConfig({})).toEqual(DEFAULT_AUCTION_CONFIG);
  });

  it("throws on a wrong type instead of guessing", () => {
    expect(() => parseAuctionConfig({ minIncrementCents: "1 €" })).toThrow();
    expect(() => parseAuctionConfig({ phases: [{ name: "peak", start: "2am", slotsPerHour: 4, minPriceCents: 500 }] })).toThrow();
  });

  it("clamps insane values and keeps the recognition tiers ascending", () => {
    const c = parseAuctionConfig({
      minIncrementCents: 0,
      auctionDurationSec: 5,
      refundAfterMin: 8,
      playTargetMin: 30,
      recognition: { screenNameCents: 20000, announceCents: 10000, specialMomentCents: 5000 },
    });
    expect(c.minIncrementCents).toBe(1);
    expect(c.auctionDurationSec).toBe(30);
    expect(c.playTargetMin).toBe(8); // never after the refund deadline
    expect(c.recognition).toMatchObject({ screenNameCents: 20000, announceCents: 20000, specialMomentCents: 20000 });
  });

  it("flags phase layouts that need a human decision", () => {
    expect(auctionConfigProblems(DEFAULT_AUCTION_CONFIG)).toEqual([]);
    const bad = parseAuctionConfig({
      phases: [
        { name: "ramp", start: "01:00", slotsPerHour: 2, minPriceCents: 200 },
        { name: "ramp", start: null, slotsPerHour: 2, minPriceCents: 200 },
      ],
    });
    expect(auctionConfigProblems(bad)).toEqual([
      "firstPhaseStartsAtOpening",
      "onlyFirstPhaseWithoutStart",
      "duplicatePhase",
    ]);
  });
});
