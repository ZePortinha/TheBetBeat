"use client";

/**
 * NumericText: numbers that change in place, the way iOS animates a
 * timer (`contentTransition(.numericText)`). Only the characters that
 * changed move: counting down, the new digit drops in from above while
 * the old one leaves below, with a touch of blur; counting up, the
 * reverse. Tabular figures, so nothing around it shifts.
 *
 * Spring for movement, a short tween for opacity (lib/motion). Reduced
 * motion: a plain cross-fade. Screen readers get the plain value.
 */

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { durations, easeStandard, springDefault } from "@/lib/motion";

const EASE = [...easeStandard] as [number, number, number, number];

function Glyph({ ch, dir, reduced }: { ch: string; dir: 1 | -1; reduced: boolean }) {
  const offset = `${0.42 * dir}em`;
  return (
    <span className="relative inline-flex">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={ch}
          className="inline-block whitespace-pre"
          initial={
            reduced
              ? { opacity: 0, y: 0, filter: "blur(0px)" }
              : { opacity: 0, y: `${-0.42 * dir}em`, filter: "blur(3px)" }
          }
          // Same resting style either way, so server and client markup match.
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={reduced ? { opacity: 0, y: 0, filter: "blur(0px)" } : { opacity: 0, y: offset, filter: "blur(3px)" }}
          transition={{
            opacity: { duration: reduced ? 0.12 : durations.fast, ease: EASE },
            y: springDefault,
            filter: { duration: durations.fast, ease: EASE },
          }}
        >
          {ch}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function NumericText({
  value,
  countsDown = false,
  className,
}: {
  value: string;
  /** A countdown: new digits arrive from above. */
  countsDown?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion() ?? false;
  const chars = Array.from(value);
  const dir = countsDown ? 1 : -1;
  return (
    <span className={["tnum inline-flex", className].filter(Boolean).join(" ")}>
      <span className="sr-only">{value}</span>
      <span aria-hidden className="inline-flex">
        {chars.map((ch, i) => (
          // Keyed from the right: "10:00" → "9:59" keeps the columns.
          <Glyph key={chars.length - i} ch={ch} dir={dir} reduced={reduced} />
        ))}
      </span>
    </span>
  );
}
