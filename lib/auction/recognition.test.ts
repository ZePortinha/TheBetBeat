import { describe, expect, it } from "vitest";
import { DEFAULT_AUCTION_CONFIG } from "./config";
import { displayLabel, recognitionFor } from "./recognition";

const rules = DEFAULT_AUCTION_CONFIG.recognition; // 50 € / 150 € / 300 €

describe("how a bidder appears", () => {
  it("is the @ handle, a table or nobody — never a real name", () => {
    expect(displayLabel({ mode: "handle", handle: "rita" })).toBe("@rita");
    expect(displayLabel({ mode: "handle", handle: "@rita" })).toBe("@rita");
    expect(displayLabel({ mode: "table", table: "Mesa 7" })).toBe("Mesa 7");
    expect(displayLabel({ mode: "anonymous" })).toBeNull();
  });
});

describe("recognition tiers", () => {
  it("names on screen from 50 €, mic shoutout from 150 €, special moment from 300 €", () => {
    expect(recognitionFor(4999, rules)).toEqual({ level: "none", announce: false });
    expect(recognitionFor(5000, rules)).toEqual({ level: "screen", announce: false });
    expect(recognitionFor(14999, rules)).toEqual({ level: "screen", announce: false });
    expect(recognitionFor(15000, rules)).toEqual({ level: "announce", announce: true });
    expect(recognitionFor(30000, rules)).toEqual({ level: "special_moment", announce: true });
  });

  it("every winner from 150 € gets the shoutout the bid panel promised: no hourly cap", () => {
    for (let i = 0; i < 10; i++) expect(recognitionFor(15000 + i, rules).announce).toBe(true);
  });
});
