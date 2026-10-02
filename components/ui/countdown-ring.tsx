"use client";

/**
 * CountdownRing (BRIEF B10.5 / B10.6 anim 9) — deadline ring.
 * Gold → amber (< 2 min) → ember (< 60 s); gentle scale pulse in the final
 * 10 s. It NEVER shakes. The stroke progress is driven imperatively from a
 * requestAnimationFrame loop (stroke-dashoffset on a ref — no re-render per
 * frame); React state changes only on phase / final / whole-second ticks.
 * Reduced motion: no smooth sweep (1 Hz steps), no pulse — color still changes.
 * Clock: 'now' is injectable via `getNow` for tests and stories.
 */

import { motion, useReducedMotion } from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { durations } from "@/lib/motion";

export type CountdownPhase = "gold" | "amber" | "ember";

export const AMBER_THRESHOLD_MS = 2 * 60_000;
export const EMBER_THRESHOLD_MS = 60_000;
export const PULSE_THRESHOLD_MS = 10_000;

/** Pure phase picker: gold → amber (< 2 min) → ember (< 60 s). */
export function countdownPhase(remainingMs: number): CountdownPhase {
  if (remainingMs < EMBER_THRESHOLD_MS) return "ember";
  if (remainingMs < AMBER_THRESHOLD_MS) return "amber";
  return "gold";
}

/** Pure "m:ss" formatter for the centered time text. */
export function formatCountdown(remainingMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

const PHASE_COLOR: Record<CountdownPhase, string> = {
  gold: "var(--color-gold-500)",
  amber: "var(--color-amber-500)",
  ember: "var(--color-ember-500)",
};

export interface CountdownRingProps {
  /** Deadline, epoch ms. */
  deadlineAt: number;
  /** Full window length, ms — the ring shows remaining/duration. */
  durationMs: number;
  /** Injected clock (epoch ms) for tests/stories; defaults to Date.now. */
  getNow?: () => number;
  /** Outer size in px. */
  size?: number;
  strokeWidth?: number;
  /** Centered slot (time text, `.tnum`); a function receives remainingMs. */
  children?: ReactNode | ((remainingMs: number) => ReactNode);
  /** Accessible label, e.g. "Prazo do DJ". */
  label?: string;
  className?: string;
}

export function CountdownRing({
  deadlineAt,
  durationMs,
  getNow,
  size = 64,
  strokeWidth = 4,
  children,
  label,
  className,
}: CountdownRingProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const arcRef = useRef<SVGCircleElement>(null);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const initialRemaining = Math.max(
    0,
    deadlineAt - (getNow ? getNow() : Date.now()),
  );
  const [phase, setPhase] = useState<CountdownPhase>(() =>
    countdownPhase(initialRemaining),
  );
  const [isFinal, setIsFinal] = useState(
    () => initialRemaining > 0 && initialRemaining <= PULSE_THRESHOLD_MS,
  );
  // Whole-second tick: only consumed when `children` is a render function.
  const [tickSec, setTickSec] = useState(() =>
    Math.ceil(initialRemaining / 1000),
  );

  useEffect(() => {
    const read = getNow ?? Date.now;
    let raf = 0;
    let interval: ReturnType<typeof setInterval> | undefined;

    const apply = (): number => {
      const remaining = Math.max(0, deadlineAt - read());
      const fraction =
        durationMs > 0 ? Math.min(1, Math.max(0, remaining / durationMs)) : 0;
      const el = arcRef.current;
      if (el) {
        // Imperative — no React re-render per frame.
        el.style.strokeDashoffset = String(circumference * (1 - fraction));
      }
      // These bail out when unchanged (React setState same-value bailout).
      setPhase(countdownPhase(remaining));
      setIsFinal(remaining > 0 && remaining <= PULSE_THRESHOLD_MS);
      setTickSec(Math.ceil(remaining / 1000));
      return remaining;
    };

    if (reducedMotion) {
      // Static ring: stepwise 1 Hz updates; color still changes.
      apply();
      interval = setInterval(apply, 1000);
    } else {
      const loop = () => {
        apply();
        raf = requestAnimationFrame(loop);
      };
      apply();
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      if (interval !== undefined) clearInterval(interval);
    };
  }, [deadlineAt, durationMs, getNow, reducedMotion, circumference]);

  const pulsing = isFinal && !reducedMotion;
  const center = size / 2;

  return (
    <motion.div
      className={["relative inline-block", className].filter(Boolean).join(" ")}
      style={{
        width: size,
        height: size,
        color: PHASE_COLOR[phase],
        transition: "color var(--duration-base) var(--ease-standard)",
      }}
      role="timer"
      aria-label={label}
      // Gentle scale pulse in the final 10 s — scale only, never shakes.
      animate={pulsing ? { scale: [1, 1.04, 1] } : { scale: 1 }}
      transition={
        pulsing
          ? { duration: 1, repeat: Infinity, ease: "easeInOut" }
          : { duration: durations.fast }
      }
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--color-line-strong)"
          strokeWidth={strokeWidth}
        />
        <circle
          ref={arcRef}
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          // Initial offset only; the rAF loop owns it after mount. The value
          // depends on the clock, so server/client may differ harmlessly.
          suppressHydrationWarning
          strokeDashoffset={
            circumference *
            (1 - (durationMs > 0 ? Math.min(1, initialRemaining / durationMs) : 0))
          }
        />
      </svg>
      <div className="tnum absolute inset-0 grid place-items-center">
        {typeof children === "function" ? children(tickSec * 1000) : children}
      </div>
    </motion.div>
  );
}
