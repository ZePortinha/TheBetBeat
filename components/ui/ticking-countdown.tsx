"use client";

/**
 * A countdown whose digits roll like a mechanical clock: each changed
 * digit drops in from above while the old one falls out below; digits that
 * did not change stay still. On `beat` (the final stretch) the whole number
 * also ticks — a short critically damped scale, in step with the frame
 * glow and the haptic tick. Reduced motion: digits cross-fade, no tick.
 */

import * as React from "react";
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { durations, springDefault } from "@/lib/motion";

export function TickingCountdown({
  value,
  beat = false,
  timer = true,
  className,
  style,
}: {
  /** Already formatted, e.g. "0:29" (or an amount, with `timer={false}`). */
  value: string;
  /** A countdown (role="timer", never announced). False for amounts. */
  timer?: boolean;
  /** Tick the whole number on every change (final stretch). */
  beat?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const reduced = useReducedMotion() ?? false;
  const [scope, animate] = useAnimate<HTMLSpanElement>();
  const chars = [...value];

  React.useEffect(() => {
    if (!beat || reduced || !scope.current) return;
    animate(scope.current, { scale: [1.08, 1] }, springDefault);
  }, [value, beat, reduced, animate, scope]);

  return (
    <span
      ref={scope}
      role={timer ? "timer" : undefined}
      className={["tnum inline-flex origin-center", className].filter(Boolean).join(" ")}
      style={style}
    >
      <span className="sr-only">{value}</span>
      {chars.map((ch, i) => (
        // Keyed from the right so "10:00" → "9:59" keeps the seconds in place.
        <span key={chars.length - i} aria-hidden className="inline-grid overflow-hidden">
          <AnimatePresence initial={false}>
            <motion.span
              key={ch}
              className="col-start-1 row-start-1"
              initial={reduced ? { opacity: 0 } : { y: "-0.7em", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { y: "0.7em", opacity: 0 }}
              transition={reduced ? { duration: durations.fast } : springDefault}
            >
              {ch}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}
