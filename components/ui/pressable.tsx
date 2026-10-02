"use client";

/**
 * Pressable — the base interaction primitive (BRIEF B10.6, checklist 1–4).
 *
 * - Feedback on pointer-DOWN: scale 0.97 within 100ms (`durations.instant`).
 * - The action confirms on pointer-UP inside the target + ~10px hit slop.
 * - Pointer capture: dragging away cancels the press, dragging back re-arms it.
 * - Double-tap protection: repeated confirms within 400ms are ignored WITHOUT
 *   delaying the first one (debounce never delays feedback).
 * - Keyboard still works: Enter/Space on a native button produce a click with
 *   `detail === 0`, which confirms through the same guarded path.
 *
 * `usePressable` is the engine; `<Pressable>` is a thin motion.button around
 * it that `Button` (and anything tappable) builds on.
 */

import * as React from "react";
import {
  motion,
  useReducedMotion,
  type HTMLMotionProps,
  type Transition,
} from "motion/react";
import { durations, easeStandard, springDefault } from "@/lib/motion";

/** Tiny class joiner (kept local — no extra deps, no extra files). */
export function cx(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}

export type PressEvent =
  | React.PointerEvent<HTMLElement>
  | React.MouseEvent<HTMLElement>;

export interface UsePressableOptions {
  onPress?: (event: PressEvent) => void;
  disabled?: boolean;
  /** Cancel tolerance around the target before a drag cancels the press (px). */
  hitSlop?: number;
  /** Confirms within this window after a confirmed press are ignored (ms). */
  repeatWindowMs?: number;
}

export interface PressableHandlers {
  onPointerDown: React.PointerEventHandler<HTMLElement>;
  onPointerMove: React.PointerEventHandler<HTMLElement>;
  onPointerUp: React.PointerEventHandler<HTMLElement>;
  onPointerCancel: React.PointerEventHandler<HTMLElement>;
  onClick: React.MouseEventHandler<HTMLElement>;
}

export interface UsePressableResult {
  /** True while the pointer is down inside the target (+ hit slop). */
  pressed: boolean;
  handlers: PressableHandlers;
}

export function usePressable(
  options: UsePressableOptions = {},
): UsePressableResult {
  const { onPress, disabled = false, hitSlop = 10, repeatWindowMs = 400 } =
    options;

  const [pressed, setPressed] = React.useState(false);
  const pointerIdRef = React.useRef<number | null>(null);
  const boundsRef = React.useRef<DOMRect | null>(null);
  // performance.now() is UI plumbing, not domain logic — no injected clock.
  const lastConfirmAtRef = React.useRef(0);

  const confirm = React.useCallback(
    (event: PressEvent) => {
      const now = performance.now();
      // Double-tap protection: the FIRST confirm fires immediately; only
      // repeats inside the window are swallowed. Never a leading delay.
      if (now - lastConfirmAtRef.current < repeatWindowMs) return;
      lastConfirmAtRef.current = now;
      onPress?.(event);
    },
    [onPress, repeatWindowMs],
  );

  const isWithinSlop = React.useCallback(
    (event: React.PointerEvent<HTMLElement>): boolean => {
      const rect = boundsRef.current;
      if (!rect) return false;
      return (
        event.clientX >= rect.left - hitSlop &&
        event.clientX <= rect.right + hitSlop &&
        event.clientY >= rect.top - hitSlop &&
        event.clientY <= rect.bottom + hitSlop
      );
    },
    [hitSlop],
  );

  const reset = React.useCallback(() => {
    pointerIdRef.current = null;
    boundsRef.current = null;
    setPressed(false);
  }, []);

  const onPointerDown = React.useCallback<
    React.PointerEventHandler<HTMLElement>
  >(
    (event) => {
      if (disabled) return;
      // Primary button/touch only.
      if (event.button !== 0) return;
      pointerIdRef.current = event.pointerId;
      boundsRef.current = event.currentTarget.getBoundingClientRect();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Capture can fail on detached nodes; the press still works.
      }
      setPressed(true);
    },
    [disabled],
  );

  const onPointerMove = React.useCallback<
    React.PointerEventHandler<HTMLElement>
  >(
    (event) => {
      if (pointerIdRef.current !== event.pointerId) return;
      // Drag away cancels; drag back re-arms (apple-design §10).
      setPressed(!disabled && isWithinSlop(event));
    },
    [disabled, isWithinSlop],
  );

  const onPointerUp = React.useCallback<
    React.PointerEventHandler<HTMLElement>
  >(
    (event) => {
      if (pointerIdRef.current !== event.pointerId) return;
      const inside = isWithinSlop(event);
      reset();
      if (inside && !disabled) confirm(event);
    },
    [confirm, disabled, isWithinSlop, reset],
  );

  const onPointerCancel = React.useCallback<
    React.PointerEventHandler<HTMLElement>
  >(() => reset(), [reset]);

  const onClick = React.useCallback<React.MouseEventHandler<HTMLElement>>(
    (event) => {
      if (disabled) {
        event.preventDefault();
        return;
      }
      // Pointer presses already confirmed on pointer-up (and the repeat
      // window swallows the synthetic click); only keyboard activation
      // (detail === 0) confirms through click.
      if (event.detail !== 0) return;
      confirm(event);
    },
    [confirm, disabled],
  );

  return {
    pressed,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClick },
  };
}

export interface PressAnimation {
  animate: { scale: number; opacity: number };
  transition: Transition;
}

/**
 * The shared press feedback: scale 0.97 within 100ms on press, a spring
 * (interruptible, from the current value) on release. Under reduced motion
 * the scale is dropped and a comprehension-aiding opacity dip remains.
 */
export function usePressAnimation(pressed: boolean): PressAnimation {
  const reducedMotion = useReducedMotion() ?? false;
  if (reducedMotion) {
    return {
      animate: { scale: 1, opacity: pressed ? 0.8 : 1 },
      transition: { duration: durations.instant, ease: easeStandard },
    };
  }
  return {
    animate: { scale: pressed ? 0.97 : 1, opacity: 1 },
    transition: pressed
      ? { duration: durations.instant, ease: easeStandard }
      : springDefault,
  };
}

export interface PressableProps
  extends Omit<
    HTMLMotionProps<"button">,
    "onClick" | "animate" | "transition"
  > {
  onPress?: (event: PressEvent) => void;
  disabled?: boolean;
  /** Keeps the element visible and focusable but inert, with aria-busy. */
  loading?: boolean;
  hitSlop?: number;
  repeatWindowMs?: number;
  /** Visual-state override for Storybook/docs only. */
  forcePressed?: boolean;
}

/**
 * Unstyled tappable primitive. Renders a motion.button with press feedback,
 * hit-slop extension (a ~10px pseudo-element halo) and double-tap guarding.
 */
export function Pressable({
  onPress,
  disabled = false,
  loading = false,
  hitSlop,
  repeatWindowMs,
  forcePressed = false,
  className,
  type = "button",
  children,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  ...rest
}: PressableProps) {
  const inert = disabled || loading;
  const { pressed, handlers } = usePressable({
    onPress,
    disabled: inert,
    hitSlop,
    repeatWindowMs,
  });
  const isPressed = forcePressed || pressed;
  const pressAnimation = usePressAnimation(isPressed);

  return (
    <motion.button
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      data-pressed={isPressed || undefined}
      className={cx(
        // The after pseudo-element extends the hit area ~10px (B10.6 #1).
        "relative isolate touch-manipulation select-none after:absolute after:-inset-2.5 after:content-['']",
        className,
      )}
      animate={pressAnimation.animate}
      transition={pressAnimation.transition}
      {...rest}
      onPointerDown={(event) => {
        handlers.onPointerDown(event);
        onPointerDown?.(event);
      }}
      onPointerMove={(event) => {
        handlers.onPointerMove(event);
        onPointerMove?.(event);
      }}
      onPointerUp={(event) => {
        handlers.onPointerUp(event);
        onPointerUp?.(event);
      }}
      onPointerCancel={(event) => {
        handlers.onPointerCancel(event);
        onPointerCancel?.(event);
      }}
      onClick={handlers.onClick}
    >
      {children}
    </motion.button>
  );
}
