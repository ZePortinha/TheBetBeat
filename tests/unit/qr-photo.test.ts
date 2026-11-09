import { describe, expect, it } from "vitest";
import { PHOTO_PASSES, passGeometry } from "@/components/landing/qr-photo";

describe("photo QR passes", () => {
  it("starts with the whole photo at a phone-friendly size", () => {
    const [first] = PHOTO_PASSES;
    expect(first).toEqual([1, 1000, 0.5, 0.5]);
    const g = passGeometry(4032, 3024, first ?? [1, 1000, 0.5, 0.5]);
    expect(g).toEqual({ sx: 0, sy: 0, sw: 4032, sh: 3024, w: 1000, h: 750 });
  });

  it("crops around the centre and never upscales", () => {
    const g = passGeometry(4032, 3024, [0.4, 2200, 0.5, 0.5]);
    expect(g.sw).toBe(1613);
    expect(g.sx).toBe(Math.round((4032 - 1613) / 2));
    expect(g.w).toBe(1613);
  });

  it("covers the corners with overlapping halves, all inside the photo", () => {
    const halves = PHOTO_PASSES.filter(([keep]) => keep === 0.5);
    expect(halves).toHaveLength(8);
    for (const pass of PHOTO_PASSES) {
      const g = passGeometry(4032, 3024, pass);
      expect(g.sx).toBeGreaterThanOrEqual(0);
      expect(g.sy).toBeGreaterThanOrEqual(0);
      expect(g.sx + g.sw).toBeLessThanOrEqual(4032);
      expect(g.sy + g.sh).toBeLessThanOrEqual(3024);
    }
  });
});
