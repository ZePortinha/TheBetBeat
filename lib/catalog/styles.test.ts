import { describe, expect, it } from "vitest";
import { eventStyleFirst, inBpmRange, matchesStyle, normalizeStyle } from "./styles";

describe("matchesStyle", () => {
  it("is case and accent blind and matches a style inside a longer genre", () => {
    expect(matchesStyle("Funk Carioca", ["funk"])).toBe(true);
    expect(matchesStyle("Afro House", ["house"])).toBe(true);
    expect(matchesStyle("Eletronica", ["eletrónica"])).toBe(true);
    expect(matchesStyle("R&B", ["r&b"])).toBe(true);
  });

  it("matches whole words only", () => {
    expect(matchesStyle("Housework Pop", ["house"])).toBe(false);
    expect(matchesStyle("Techno", ["tech"])).toBe(false);
  });

  it("never matches without a genre or styles", () => {
    expect(matchesStyle(null, ["funk"])).toBe(false);
    expect(matchesStyle("Funk", [])).toBe(false);
  });
});

describe("inBpmRange", () => {
  it("keeps tracks inside the range and never excludes an unknown BPM", () => {
    expect(inBpmRange(120, 100, 130)).toBe(true);
    expect(inBpmRange(90, 100, 130)).toBe(false);
    expect(inBpmRange(140, 100, 130)).toBe(false);
    expect(inBpmRange(null, 100, 130)).toBe(true);
    expect(inBpmRange(200, null, null)).toBe(true);
  });
});

describe("eventStyleFirst", () => {
  const tracks = [
    { id: "pop", genre: "Pop", bpm: 110 },
    { id: "funk-slow", genre: "Funk", bpm: 80 },
    { id: "funk", genre: "Funk", bpm: 108 },
    { id: "house", genre: "House", bpm: 124 },
    { id: "funk2", genre: "Funk Carioca", bpm: 130 },
  ];

  it("puts the event's style first, keeping the original order inside each group", () => {
    expect(eventStyleFirst(tracks, ["funk"]).map((t) => t.id)).toEqual([
      "funk-slow",
      "funk",
      "funk2",
      "pop",
      "house",
    ]);
  });

  it("applies the BPM range to the style group", () => {
    expect(eventStyleFirst(tracks, ["funk"], 100, 128).map((t) => t.id)).toEqual([
      "funk",
      "pop",
      "funk-slow",
      "house",
      "funk2",
    ]);
  });

  it("leaves the list alone without criteria", () => {
    expect(eventStyleFirst(tracks, []).map((t) => t.id)).toEqual(tracks.map((t) => t.id));
  });
});

describe("normalizeStyle", () => {
  it("lowercases and collapses spaces", () => {
    expect(normalizeStyle("  Afro   House ")).toBe("afro house");
  });
});
