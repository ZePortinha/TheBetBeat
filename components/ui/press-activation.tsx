"use client";

/**
 * Press activation for every plain button and link (owner, 2026-10-11:
 * any button on the site acts the moment it is pressed, not when the
 * finger lifts).
 *
 * `Button`, `Pressable` and `TrackRow` do this themselves (usePressable,
 * marked `data-pressable`). Everything else (native <button>, links,
 * switches, checkboxes) is handled here, once for the whole page: on a
 * primary pointer-down the element is clicked right away, and the click
 * the browser sends when the finger lifts is dropped, so nothing runs
 * twice and nothing under the finger gets a stray tap.
 *
 * Left on release (the browser's normal tap):
 *   - anything inside `[data-press="release"]` (share sheet, clipboard,
 *     downloads: browsers allow those only from a finished tap on touch
 *     screens) or `[data-pressable]` (handled by its component);
 *   - links that open a new tab or download, and clicks with a modifier
 *     key (new tab, new window);
 *   - disabled elements, form fields and editable text.
 */

import * as React from "react";

const ACTIVATABLE = [
  "button",
  "a[href]",
  "summary",
  '[role="button"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  'input[type="submit"]',
  'input[type="button"]',
  'input[type="reset"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
].join(",");

/** How long after the finger lifts the browser's own click may still arrive. */
const CLICK_AFTER_UP_MS = 600;

/** The element a pointer-down should click now, or null to leave it alone. */
export function pressTarget(event: PointerEvent): HTMLElement | null {
  if (event.button !== 0 || !event.isPrimary || event.defaultPrevented) return null;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return null;
  const start = event.target instanceof Element ? event.target : null;
  const el = start?.closest<HTMLElement>(ACTIVATABLE);
  if (!el) return null;
  if (el.closest('[data-pressable], [data-press="release"], [contenteditable="true"]')) return null;
  if (el.matches(":disabled") || el.getAttribute("aria-disabled") === "true") return null;
  if (el instanceof HTMLAnchorElement) {
    if (el.hasAttribute("download")) return null;
    const target = el.getAttribute("target");
    if (target && target !== "_self") return null;
  }
  return el;
}

export function PressActivation() {
  React.useEffect(() => {
    // The press we already acted on; its own click (when the finger lifts) is dropped.
    let pending: { pointerId: number; upAt: number | null } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      pending = null;
      const el = pressTarget(event);
      if (!el) return;
      pending = { pointerId: event.pointerId, upAt: null };
      el.click();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (pending && pending.pointerId === event.pointerId) pending.upAt = performance.now();
    };
    const onPointerCancel = (event: PointerEvent) => {
      // A cancelled touch (it became a scroll) sends no click.
      if (pending && pending.pointerId === event.pointerId) pending = null;
    };
    const onClick = (event: MouseEvent) => {
      // Keyboard clicks (detail 0) and our own el.click() are never dropped.
      if (!pending || !event.isTrusted || event.detail === 0) return;
      const fresh = pending.upAt === null || performance.now() - pending.upAt < CLICK_AFTER_UP_MS;
      pending = null;
      if (!fresh) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    // Bubble phase on the document: components that handle the press
    // themselves (and call preventDefault) run first.
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerCancel, true);
    // Capture on window: runs before React's own listeners at the root.
    window.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("click", onClick, true);
    };
  }, []);
  return null;
}
