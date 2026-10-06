import { describe, expect, it } from "vitest";
import { DEFAULT_AUCTION_CONFIG } from "./config";
import { announcementsLeft, displayLabel, recognitionFor } from "./recognition";

const rules = DEFAULT_AUCTION_CONFIG.recognition; // 50 € / 150 € / 300 €, 3 mic calls per hour
const NOW = Date.UTC(2026, 9, 3, 2, 0);

describe("how a bidder appears", () => {
  it("is the @ handle, a table or nobody — never a real name", () => {
    expect(displayLabel({ mode: "handle", handle: "rita" })).toBe("@rita");
    expect(displayLabel({ mode: "handle", handle: "@rita" })).toBe("@rita");
    expect(displayLabel({ mode: "table", table: "Mesa 7" })).toBe("Mesa 7");
    expect(displayLabel({ mode: "anonymous" })).toBeNull();
  });
});

describe("recognition tiers", () => {
  it("names on screen from 50 €, mic from 150 €, special moment from 300 €", () => {
    expect(recognitionFor(4999, false, [], NOW, rules)).toEqual({ level: "none", announce: false });
    expect(recognitionFor(5000, false, [], NOW, rules)).toEqual({ level: "screen", announce: false });
    expect(recognitionFor(15000, false, [], NOW, rules)).toEqual({ level: "announce", announce: true });
    expect(recognitionFor(30000, false, [], NOW, rules)).toEqual({ level: "special_moment", announce: true });
  });

  it("never announces an anonymous winner", () => {
    expect(recognitionFor(30000, true, [], NOW, rules)).toEqual({ level: "special_moment", announce: false });
  });

  it("caps mic announcements per rolling hour, then falls back to the screen", () => {
    const threeRecent = [NOW - 50 * 60_000, NOW - 20 * 60_000, NOW - 60_000];
    expect(announcementsLeft(threeRecent, NOW, rules)).toBe(0);
    expect(recognitionFor(20000, false, threeRecent, NOW, rules)).toEqual({ level: "announce", announce: false });
    // An announcement older than an hour no longer counts.
    const oneExpired = [NOW - 61 * 60_000, NOW - 20 * 60_000, NOW - 60_000];
    expect(announcementsLeft(oneExpired, NOW, rules)).toBe(1);
    expect(recognitionFor(20000, false, oneExpired, NOW, rules).announce).toBe(true);
  });
});
