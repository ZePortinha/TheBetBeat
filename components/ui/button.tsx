"use client";

/**
 * Button — the BetBeat action primitive (BRIEF B10.5), built on Pressable.
 *
 * Variants: primary (gold), secondary (surface), ghost, destructive (ember).
 * Sizes: md (44px min target) and lg (56px, cockpit gloves-and-dark size).
 * Loading keeps the width (inline spinner over an invisible label).
 *
 * Also exports <HoldButton> — hold-to-confirm ("Terminar set"): an ember
 * fill tracks the hold 1:1 over `holdMs`, recoils with springDefault if
 * released early, and fires `onConfirm` exactly at 100%.
 */

import * as React from "react";
import { LoaderCircle } from "lucide-react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type AnimationPlaybackControls,
  type HTMLMotionProps,
} from "motion/react";
import { durations, springDefault } from "@/lib/motion";
import {
  cx,
  usePressable,
  usePressAnimation,
  type PressEvent,
} from "@/components/ui/pressable";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "md" | "lg";

/** Pressed colors ride the `data-pressed` attribute set by Pressable. */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-gold-500 text-text-on-accent data-pressed:bg-gold-700",
  secondary:
    "border border-line-subtle bg-surface-2 text-text-primary data-pressed:bg-surface-3",
  ghost: "bg-transparent text-text-primary data-pressed:bg-surface-2",
  destructive:
    "bg-ember-500 text-text-on-accent data-pressed:brightness-90",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "min-h-11 px-5 text-base", // 44px minimum touch target
  lg: "min-h-14 px-6 text-xl", // 56px — cockpit
};

const SPINNER_SIZE: Record<ButtonSize, string> = {
  md: "size-5",
  lg: "size-6",
};

export interface ButtonProps
  extends Omit<
    HTMLMotionProps<"button">,
    "onClick" | "animate" | "transition" | "children"
  > {
  children?: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  onPress?: (event: PressEvent) => void;
  disabled?: boolean;
  /** Shows an inline spinner and ignores presses; the width is kept. */
  loading?: boolean;
  fullWidth?: boolean;
  hitSlop?: number;
  repeatWindowMs?: number;
  /** Visual-state override for Storybook/docs only. */
  forcePressed?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  onPress,
  disabled = false,
  loading = false,
  fullWidth = false,
  hitSlop,
  repeatWindowMs,
  forcePressed = false,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
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
        "relative isolate inline-flex touch-manipulation select-none items-center justify-center gap-2 rounded-button font-semibold",
        // Color changes are tweens, never on the gesture path (B10.6).
        "transition-[background-color,filter] duration-100",
        "disabled:cursor-not-allowed disabled:opacity-40",
        // ~10px hit slop around the target (B10.6 checklist #1).
        "after:absolute after:-inset-2.5 after:content-['']",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth && "w-full",
        className,
      )}
      animate={pressAnimation.animate}
      transition={pressAnimation.transition}
      {...rest}
      {...handlers}
    >
      <span className={cx("inline-flex items-center gap-2", loading && "invisible")}>
        {children}
      </span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <LoaderCircle
            aria-hidden
            strokeWidth={1.75}
            className={cx("animate-spin", SPINNER_SIZE[size])}
          />
        </span>
      )}
    </motion.button>
  );
}

/* ────────────────────────────────────────────────────────────────── */

export interface HoldButtonProps {
  /** The label, e.g. the translated "Terminar set". */
  children: React.ReactNode;
  /** Fires exactly once, when the fill reaches 100%. */
  onConfirm: () => void;
  /** How long the hold must last (ms). */
  holdMs?: number;
  size?: ButtonSize;
  disabled?: boolean;
  fullWidth?: boolean;
  /** Cancel tolerance around the button while holding (px). */
  hitSlop?: number;
  className?: string;
  "aria-label"?: string;
  /** Visual fill override (0..1) for Storybook/docs only. */
  forceProgress?: number;
}

/**
 * Hold-to-confirm (B10.6 animation #11). The ember fill follows the hold
 * 1:1 (transform-only), recoils with `springDefault` when released early
 * (a plain short tween under reduced motion) and confirms at 100%.
 */
export function HoldButton({
  children,
  onConfirm,
  holdMs = 2000,
  size = "lg",
  disabled = false,
  fullWidth = false,
  hitSlop = 10,
  className,
  "aria-label": ariaLabel,
  forceProgress,
}: HoldButtonProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const progress = useMotionValue(forceProgress ?? 0);
  // Label crossfade as the fill passes under it (opacity only).
  const overlayOpacity = useTransform(progress, [0.35, 0.65], [0, 1]);
  const baseOpacity = useTransform(overlayOpacity, (value) => 1 - value);

  const controlsRef = React.useRef<AnimationPlaybackControls | null>(null);
  const pointerIdRef = React.useRef<number | null>(null);
  const boundsRef = React.useRef<DOMRect | null>(null);
  const keyHeldRef = React.useRef(false);
  const confirmedRef = React.useRef(false);
  const [holding, setHolding] = React.useState(false);
  const pressAnimation = usePressAnimation(holding);

  const onConfirmRef = React.useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  React.useEffect(() => {
    if (forceProgress !== undefined) progress.set(forceProgress);
  }, [forceProgress, progress]);

  // Stop any running fill animation on unmount.
  React.useEffect(() => () => controlsRef.current?.stop(), []);

  const startHold = React.useCallback(() => {
    if (disabled || confirmedRef.current) return;
    setHolding(true);
    controlsRef.current?.stop();
    // Resume from the current fill — interruptible, never restarts (B10.6 #3).
    const remainingSeconds = ((1 - progress.get()) * holdMs) / 1000;
    controlsRef.current = animate(progress, 1, {
      duration: Math.max(remainingSeconds, 0),
      ease: "linear",
      onComplete: () => {
        if (confirmedRef.current) return;
        confirmedRef.current = true;
        onConfirmRef.current();
      },
    });
  }, [disabled, holdMs, progress]);

  const releaseHold = React.useCallback(() => {
    setHolding(false);
    controlsRef.current?.stop();
    controlsRef.current = null;
    if (confirmedRef.current) {
      // Confirmed: settle the fill back quietly and re-arm.
      confirmedRef.current = false;
      controlsRef.current = animate(progress, 0, {
        duration: durations.base,
        ease: "linear",
      });
    } else {
      // Released early: recoil with a spring (tween under reduced motion).
      controlsRef.current = animate(
        progress,
        0,
        reducedMotion
          ? { duration: durations.fast, ease: "linear" }
          : springDefault,
      );
    }
  }, [progress, reducedMotion]);

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

  return (
    <motion.button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      className={cx(
        "relative isolate inline-flex touch-none select-none items-center justify-center overflow-hidden rounded-button border border-line-strong bg-surface-2 font-semibold",
        "disabled:cursor-not-allowed disabled:opacity-40",
        SIZE_CLASSES[size],
        fullWidth && "w-full",
        className,
      )}
      style={{ WebkitTouchCallout: "none" }}
      animate={pressAnimation.animate}
      transition={pressAnimation.transition}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        pointerIdRef.current = event.pointerId;
        boundsRef.current = event.currentTarget.getBoundingClientRect();
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Capture can fail on detached nodes; the hold still works.
        }
        startHold();
      }}
      onPointerMove={(event) => {
        if (pointerIdRef.current !== event.pointerId) return;
        // Drag away cancels (recoil); drag back re-arms from where it is.
        if (!isWithinSlop(event)) {
          if (holding) releaseHold();
        } else if (!holding) {
          startHold();
        }
      }}
      onPointerUp={(event) => {
        if (pointerIdRef.current !== event.pointerId) return;
        pointerIdRef.current = null;
        boundsRef.current = null;
        releaseHold();
      }}
      onPointerCancel={() => {
        pointerIdRef.current = null;
        boundsRef.current = null;
        releaseHold();
      }}
      onKeyDown={(event) => {
        if (event.repeat || keyHeldRef.current) return;
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          keyHeldRef.current = true;
          startHold();
        }
      }}
      onKeyUp={(event) => {
        if (!keyHeldRef.current) return;
        if (event.key === " " || event.key === "Enter") {
          keyHeldRef.current = false;
          releaseHold();
        }
      }}
      onBlur={() => {
        if (keyHeldRef.current) {
          keyHeldRef.current = false;
          releaseHold();
        }
      }}
    >
      {/* Ember fill tracks the hold 1:1 — transform-only (B10.6 #8). */}
      <motion.span
        aria-hidden
        className="absolute inset-0 -z-10 origin-left bg-ember-500"
        style={{ scaleX: progress }}
      />
      <motion.span className="relative text-ember-500" style={{ opacity: baseOpacity }}>
        {children}
      </motion.span>
      <motion.span
        aria-hidden
        className="absolute inset-0 flex items-center justify-center text-text-on-accent"
        style={{ opacity: overlayOpacity }}
      >
        {children}
      </motion.span>
    </motion.button>
  );
}
