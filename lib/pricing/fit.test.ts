import { describe, expect, it } from "vitest";
import {
  BPM_UNKNOWN_SCORE,
  GENRE_ADJACENT_SCORE,
  GENRE_IN_SESSION_SCORE,
  GENRE_OTHER_SCORE,
  GENRE_UNKNOWN_SCORE,
  KEY_INCOMPATIBLE_SCORE,
  KEY_UNKNOWN_SCORE,
  bpmScore,
  computeFit,
  fitLabel,
  genreScore,
  keyScore,
  median,
  normalizeGenre,
} from "./fit";
import type { PricingSetInput, PricingTrackInput } from "./types";

const SET: PricingSetInput = {
  recentBpms: [122, 124, 126],
  recentGenres: ["house", "house", "tech house"],
  currentKey: "8A",
};

function track(overrides: Partial<PricingTrackInput> = {}): PricingTrackInput {
  return { genre: "house", bpm: 124, camelotKey: "8A", ...overrides };
}

describe("normalizeGenre", () => {
  it("canonicalizes case, separators and aliases", () => {
    expect(normalizeGenre("  Hip-Hop ")).toBe("hip hop");
    expect(normalizeGenre("R&B")).toBe("rnb");
    expect(normalizeGenre("Drum & Bass")).toBe("drum and bass");
    expect(normalizeGenre("DnB")).toBe("drum and bass");
    expect(normalizeGenre("TECH_HOUSE")).toBe("tech house");
  });
});

describe("genreScore (s_g)", () => {
  it("scores 1 for a session genre", () => {
    expect(genreScore("House", ["house", "techno"])).toBe(GENRE_IN_SESSION_SCORE);
  });

  it("scores 0.6 for an adjacent genre via the default map", () => {
    expect(genreScore("tech house", ["house"])).toBe(GENRE_ADJACENT_SCORE);
    // Symmetric: map entry lists it from the other side too.
    expect(genreScore("house", ["tech house"])).toBe(GENRE_ADJACENT_SCORE);
    expect(genreScore("amapiano", ["afrobeats"])).toBe(GENRE_ADJACENT_SCORE);
  });

  it("scores 0.2 for an unrelated genre", () => {
    expect(genreScore("salsa", ["techno"])).toBe(GENRE_OTHER_SCORE);
    expect(genreScore("jungle", ["reggaeton"])).toBe(GENRE_OTHER_SCORE);
  });

  it("lets a venue adjacency map EXTEND the defaults (symmetric)", () => {
    const venueMap = { techno: ["salsa"] };
    expect(genreScore("salsa", ["techno"], venueMap)).toBe(GENRE_ADJACENT_SCORE);
    expect(genreScore("techno", ["salsa"], venueMap)).toBe(GENRE_ADJACENT_SCORE);
    // Defaults still apply alongside the venue entries.
    expect(genreScore("tech house", ["house"], venueMap)).toBe(GENRE_ADJACENT_SCORE);
  });

  it("treats an empty session genre list as no restriction", () => {
    expect(genreScore("polka", [])).toBe(GENRE_IN_SESSION_SCORE);
  });

  it("treats a blank track genre as unknown (0.6)", () => {
    expect(genreScore("", ["house"])).toBe(GENRE_UNKNOWN_SCORE);
    expect(genreScore("   ", ["house"])).toBe(GENRE_UNKNOWN_SCORE);
  });
});

describe("median", () => {
  it("handles odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([5])).toBe(5);
  });
});

describe("bpmScore (s_b)", () => {
  it("scores 1 on an exact median match", () => {
    expect(bpmScore(124, [122, 124, 126])).toBe(1);
  });

  it("uses half/double time for the smallest delta", () => {
    expect(bpmScore(140, [70])).toBe(1); // 140 × 0.5 = 70
    expect(bpmScore(62, [124])).toBe(1); // 62 × 2 = 124
  });

  it("applies s_b = max(0, 1 − Δ/16)", () => {
    expect(bpmScore(132, [124])).toBeCloseTo(0.5, 10); // Δ = 8
    expect(bpmScore(128, [124])).toBeCloseTo(0.75, 10); // Δ = 4
    expect(bpmScore(95, [128])).toBe(0); // Δ = 33 → floor at 0
  });

  it("returns 0.75 when BPM data is missing on either side", () => {
    expect(bpmScore(null, [124])).toBe(BPM_UNKNOWN_SCORE);
    expect(bpmScore(124, [])).toBe(BPM_UNKNOWN_SCORE);
    expect(bpmScore(124, [NaN, -3])).toBe(BPM_UNKNOWN_SCORE);
  });
});

describe("keyScore (s_k)", () => {
  it("scores 1 for Camelot-compatible keys", () => {
    expect(keyScore("8A", "8A")).toBe(1); // same
    expect(keyScore("9A", "8A")).toBe(1); // ±1 same letter
    expect(keyScore("8B", "8A")).toBe(1); // relative
    expect(keyScore("12A", "1A")).toBe(1); // wheel wrap
  });

  it("scores 0.5 for incompatible keys", () => {
    expect(keyScore("3A", "8A")).toBe(KEY_INCOMPATIBLE_SCORE);
  });

  it("scores 0.75 when a key is unknown or unparseable", () => {
    expect(keyScore(null, "8A")).toBe(KEY_UNKNOWN_SCORE);
    expect(keyScore("8A", null)).toBe(KEY_UNKNOWN_SCORE);
    expect(keyScore("not-a-key", "8A")).toBe(KEY_UNKNOWN_SCORE);
  });

  it("accepts musical key names via parseCamelot", () => {
    expect(keyScore("Am", "8A")).toBe(1); // Am = 8A
  });
});

describe("computeFit", () => {
  it("combines S = 0.5·s_g + 0.35·s_b + 0.15·s_k and clamps to [0, 1]", () => {
    const perfect = computeFit(track(), SET, ["house"]);
    expect(perfect.score).toBe(1);
    expect(perfect.label).toBe("fits");

    const partial = computeFit(
      track({ genre: "tech house", bpm: 132, camelotKey: "3A" }),
      SET,
      ["house"],
    );
    // s_g 0.6, s_b 1 − 8/16 = 0.5, s_k 0.5 → 0.3 + 0.175 + 0.075 = 0.55
    expect(partial.score).toBeCloseTo(0.55, 10);
    expect(partial.label).toBe("possible");
    expect(partial.sGenre).toBe(0.6);
    expect(partial.sBpm).toBeCloseTo(0.5, 10);
    expect(partial.sKey).toBe(0.5);
  });

  it("labels a clearly off-style track", () => {
    const off = computeFit(
      track({ genre: "salsa", bpm: 95, camelotKey: "3A" }),
      { ...SET, recentBpms: [128, 128, 128] },
      ["techno"],
    );
    // s_g 0.2, s_b 0 (Δ = 33), s_k 0.5 → 0.1 + 0 + 0.075 = 0.175
    expect(off.score).toBeCloseTo(0.175, 10);
    expect(off.label).toBe("off_style");
  });
});

describe("fitLabel boundaries (B5.3)", () => {
  it("fits ≥ 0.7, possible [0.4, 0.7), off_style < 0.4", () => {
    expect(fitLabel(1)).toBe("fits");
    expect(fitLabel(0.7)).toBe("fits");
    expect(fitLabel(0.699)).toBe("possible");
    expect(fitLabel(0.4)).toBe("possible");
    expect(fitLabel(0.399)).toBe("off_style");
    expect(fitLabel(0)).toBe("off_style");
  });
});
