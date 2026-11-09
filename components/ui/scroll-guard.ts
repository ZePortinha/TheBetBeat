/**
 * Scroll guard: knows when the page (or any scrolling list) last moved, so a
 * touch that is really a scroll never counts as a tap.
 *
 * - A finger that lands while a list is still gliding (momentum) only stops
 *   it: iOS sends pointer events for that touch but it is not a tap.
 * - A press whose list scrolled before the finger lifted is cancelled.
 *
 * One passive capture listener for the whole page, installed on first use.
 * performance.now() is UI plumbing, not domain logic (no injected clock).
 */

/** A touch this soon after the last scroll only stops the glide. */
export const SCROLL_SETTLE_MS = 180;

let lastScrollAt = Number.NEGATIVE_INFINITY;
let scrollCount = 0;
let installed = false;

export function installScrollGuard(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener(
    "scroll",
    () => {
      lastScrollAt = performance.now();
      scrollCount += 1;
    },
    { capture: true, passive: true },
  );
}

/** True when something scrolled within the last `ms` milliseconds. */
export function scrolledRecently(ms: number = SCROLL_SETTLE_MS): boolean {
  installScrollGuard();
  return performance.now() - lastScrollAt < ms;
}

/** A mark to compare later: did anything scroll since this moment? */
export function scrollMark(): number {
  installScrollGuard();
  return scrollCount;
}

export function scrolledSince(mark: number): boolean {
  return scrollCount !== mark;
}

/** Touch travel (px) that turns a list-row press into a scroll. */
export const TOUCH_MOVE_CANCEL_PX = 8;

/**
 * Whether a touch on a list row is still a tap: the finger stayed within
 * TOUCH_MOVE_CANCEL_PX of where it landed and nothing scrolled meanwhile.
 */
export function stillATap(
  start: { x: number; y: number },
  now: { x: number; y: number },
  scrolled: boolean,
): boolean {
  if (scrolled) return false;
  return Math.hypot(now.x - start.x, now.y - start.y) <= TOUCH_MOVE_CANCEL_PX;
}
