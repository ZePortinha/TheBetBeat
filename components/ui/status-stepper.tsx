"use client";

/**
 * StatusStepper (BRIEF B10.5 / B10.6 anim 5) — request progress:
 * Pago → Aceite → Na fila → A tocar → Tocou (labels come in via props).
 * The gold fill animates CONTINUOUSLY between steps (springDefault on a
 * scaleX track), done checkmarks draw in (pathLength, duration `base`),
 * and the current step pulses subtly. Reduced motion: instant fills.
 */

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { durations, easeStandard, springDefault } from "@/lib/motion";

const EASING: [number, number, number, number] = [...easeStandard];

export interface StatusStepperProps {
  /** Step labels in order, localized by the caller. */
  steps: string[];
  /**
   * Index of the current step (0-based). Steps below it are done; pass
   * `steps.length` to mark every step (e.g. "Tocou") as complete.
   */
  activeIndex: number;
  /** Position / ETA slot rendered under the active step (e.g. "~6 min"). */
  detail?: ReactNode;
  className?: string;
}

type StepState = "done" | "active" | "upcoming";

function DoneCheck({ instant }: { instant: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <motion.path
        d="M5 12.5l4.2 4.2L19 7.5"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={
          instant ? { duration: 0 } : { duration: durations.base, ease: EASING }
        }
      />
    </svg>
  );
}

function StepNode({
  state,
  pulse,
  instant,
}: {
  state: StepState;
  pulse: boolean;
  /** Reduced motion: checkmarks appear instantly instead of drawing in. */
  instant: boolean;
}) {
  if (state === "done") {
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full bg-gold-500 text-text-on-accent">
        <DoneCheck instant={instant} />
      </span>
    );
  }
  if (state === "active") {
    return (
      <motion.span
        className="grid h-6 w-6 place-items-center rounded-full border-2 border-gold-500 bg-surface-2"
        animate={pulse ? { scale: [1, 1.08, 1] } : { scale: 1 }}
        transition={
          pulse
            ? { duration: durations.ambient, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0 }
        }
      >
        <span className="h-2 w-2 rounded-full bg-gold-500" />
      </motion.span>
    );
  }
  return (
    <span className="grid h-6 w-6 place-items-center rounded-full border border-line-strong bg-surface-2">
      <span className="h-1.5 w-1.5 rounded-full bg-surface-3" />
    </span>
  );
}

export function StatusStepper({
  steps,
  activeIndex,
  detail,
  className,
}: StatusStepperProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const count = steps.length;
  if (count === 0) return null;

  const clamped = Math.max(0, Math.min(activeIndex, count));
  // Continuous fill fraction along the track between first and last centers.
  const progress = count > 1 ? Math.min(clamped / (count - 1), 1) : clamped > 0 ? 1 : 0;
  // Half a step-cell on each side so the track spans center-to-center.
  const inset = `${50 / count}%`;

  return (
    <div className={["relative", className].filter(Boolean).join(" ")}>
      {/* Track + continuous gold fill (transform-only animation, B10.6 §8). */}
      <div
        className="absolute top-[11px] h-0.5 overflow-hidden rounded-full bg-surface-3"
        style={{ left: inset, right: inset }}
        aria-hidden="true"
      >
        <motion.div
          className="h-full w-full origin-left rounded-full bg-gold-500"
          initial={false}
          animate={{ scaleX: progress }}
          transition={reducedMotion ? { duration: 0 } : springDefault}
        />
      </div>

      <ol className="relative flex">
        {steps.map((label, i) => {
          const state: StepState =
            i < clamped ? "done" : i === clamped && clamped < count ? "active" : "upcoming";
          const isActive = state === "active";
          return (
            <li
              key={`${i}-${label}`}
              className="flex flex-1 flex-col items-center gap-1.5"
              aria-current={isActive ? "step" : undefined}
            >
              <StepNode
                state={state}
                pulse={isActive && !reducedMotion}
                instant={reducedMotion}
              />
              <span
                className={[
                  "text-center text-[length:var(--text-12)] font-semibold",
                  "tracking-[var(--tracking-small)] leading-[var(--leading-dense)]",
                  state === "upcoming" ? "text-text-tertiary" : "text-text-primary",
                ].join(" ")}
              >
                {label}
              </span>
              {isActive && detail ? (
                <span className="tnum text-center text-[length:var(--text-12)] text-text-secondary">
                  {detail}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
