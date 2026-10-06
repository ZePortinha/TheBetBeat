import { describe, expect, it } from "vitest";
import { DEFAULT_AUCTION_CONFIG, parseAuctionConfig } from "./config";
import { assessTransition, startingPriceCents } from "./transition";

const rules = DEFAULT_AUCTION_CONFIG.transition;
const playing = (bpm: number | null, camelotKey: string | null = null) => ({ bpm, camelotKey });

describe("assessTransition", () => {
  it("rates by the tempo change the DJ has to make", () => {
    expect(assessTransition(playing(126), playing(124), rules)).toMatchObject({ level: "easy", mode: "same", deltaPct: 1.6 });
    expect(assessTransition(playing(132), playing(124), rules)).toMatchObject({ level: "medium", deltaPct: 6.5 });
    expect(assessTransition(playing(140), playing(124), rules)).toMatchObject({ level: "hard", deltaPct: 12.9 });
  });

  it("half and double time line up", () => {
    expect(assessTransition(playing(64), playing(128), rules)).toMatchObject({ level: "easy", mode: "half" });
    expect(assessTransition(playing(172), playing(87), rules)).toMatchObject({ level: "easy", mode: "double" });
  });

  it("a key clash makes it one step harder; unknown keys change nothing", () => {
    expect(assessTransition(playing(124, "8A"), playing(124, "9A"), rules).level).toBe("easy");
    expect(assessTransition(playing(124, "8A"), playing(124, "2B"), rules)).toMatchObject({ level: "medium", keyMatch: false });
    expect(assessTransition(playing(124), playing(124, "2B"), rules)).toMatchObject({ level: "easy", keyMatch: null });
  });

  it("unknown tempo is priced as medium; an empty floor takes anything", () => {
    expect(assessTransition(playing(null), playing(124), rules)).toMatchObject({ level: "unknown", multiplierBps: 15_000 });
    expect(assessTransition(playing(90), null, rules)).toMatchObject({ level: "easy", nothingPlaying: true });
  });

  it("uses the club's multipliers", () => {
    const club = parseAuctionConfig({ transition: { hardBps: 40_000 } }).transition;
    expect(assessTransition(playing(150), playing(124), club).multiplierBps).toBe(40_000);
  });
});

describe("startingPriceCents", () => {
  it("multiplies the auction minimum and rounds up to 0,50 €", () => {
    expect(startingPriceCents(200, 10_000)).toBe(200);
    expect(startingPriceCents(200, 15_000)).toBe(300);
    expect(startingPriceCents(500, 25_000)).toBe(1250);
    expect(startingPriceCents(150, 15_000)).toBe(250);
  });
});
