import { describe, expect, it } from "vitest";
import { stillATap, TOUCH_MOVE_CANCEL_PX } from "@/components/ui/scroll-guard";

describe("stillATap (list rows on touch)", () => {
  const start = { x: 100, y: 200 };

  it("keeps a still finger and a small jitter as a tap", () => {
    expect(stillATap(start, start, false)).toBe(true);
    expect(stillATap(start, { x: 103, y: 204 }, false)).toBe(true);
    expect(stillATap(start, { x: 100, y: 200 + TOUCH_MOVE_CANCEL_PX }, false)).toBe(true);
  });

  it("turns travel beyond the limit into a scroll", () => {
    expect(stillATap(start, { x: 100, y: 200 - TOUCH_MOVE_CANCEL_PX - 1 }, false)).toBe(false);
    expect(stillATap(start, { x: 100, y: 160 }, false)).toBe(false);
    expect(stillATap(start, { x: 110, y: 200 }, false)).toBe(false);
  });

  it("cancels when the list scrolled during the press, even without travel", () => {
    expect(stillATap(start, start, true)).toBe(false);
  });
});
