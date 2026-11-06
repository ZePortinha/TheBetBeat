import { describe, expect, it } from "vitest";
import { BRAND_PALETTE, fitLine, storyPalette } from "@/components/guest/win-story";

/** A flat RGBA picture of one colour. */
const flat = (r: number, g: number, b: number, n = 16) => {
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i += 1) px.set([r, g, b, 255], i * 4);
  return px;
};

const lightness = (hex: string) => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return (Math.max(...v) + Math.min(...v)) / 2;
};

describe("storyPalette", () => {
  it("takes the hue of colourful art and darkens it for white type", () => {
    const p = storyPalette(flat(40, 90, 200));
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(p.top.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r!);
    expect(b).toBeGreaterThan(g!);
    expect(lightness(p.top)).toBeLessThan(0.35);
    expect(lightness(p.bottom)).toBeLessThan(lightness(p.top));
    expect(lightness(p.card)).toBeLessThan(0.1);
  });

  it("uses the brand red for black-and-white art, and for no art", () => {
    expect(storyPalette(flat(128, 128, 128))).toEqual(BRAND_PALETTE);
    expect(storyPalette(new Uint8ClampedArray(0))).toEqual(BRAND_PALETTE);
  });

  it("ignores transparent pixels", () => {
    const px = flat(40, 90, 200);
    for (let i = 3; i < px.length; i += 4) px[i] = 0;
    expect(storyPalette(px)).toEqual(BRAND_PALETTE);
  });
});

describe("fitLine", () => {
  // Every character is `size / 2` wide.
  const measure = (text: string, size: number) => text.length * (size / 2);

  it("keeps the largest size that fits", () => {
    expect(fitLine(measure, "Velvet Drift", 400, [64, 52])).toEqual({ text: "Velvet Drift", size: 64 });
    expect(fitLine(measure, "Velvet Drift", 320, [64, 52])).toEqual({ text: "Velvet Drift", size: 52 });
  });

  it("cuts with an ellipsis at the smallest size", () => {
    const out = fitLine(measure, "Velvet Drift Extended Club Mix", 260, [64, 52]);
    expect(out.size).toBe(52);
    expect(out.text.endsWith("…")).toBe(true);
    expect(measure(out.text, 52)).toBeLessThanOrEqual(260);
  });
});
