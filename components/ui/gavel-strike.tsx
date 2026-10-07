"use client";

/**
 * The hammer comes down when an auction closes: the gavel swings from
 * raised to struck (a physical blow, so it may overshoot — springMomentum),
 * a ring spreads from the point of impact and, for a guest who is in the
 * auction, one firm buzz lands on the same frame. Reduced motion: the
 * gavel simply appears struck.
 */

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { Gavel } from "lucide-react";
import { durations, springMomentum } from "@/lib/motion";

export function GavelStrike({ buzz = false, className }: { buzz?: boolean; className?: string }) {
  const reduced = useReducedMotion() ?? false;

  React.useEffect(() => {
    if (!buzz) return;
    // The blow lands ~0.2 s in; the buzz waits for it.
    const id = setTimeout(() => navigator.vibrate?.(40), reduced ? 0 : 200);
    return () => clearTimeout(id);
  }, [buzz, reduced]);

  return (
    <span aria-hidden className={["relative inline-flex size-[1em] items-center justify-center", className].filter(Boolean).join(" ")}>
      {/* Same markup with and without reduced motion (no hydration mismatch). */}
      <motion.span
        className="absolute inset-[-10%] rounded-full border-2 border-accent-500"
        initial={{ scale: 0.3, opacity: 0 }}
        animate={reduced ? { opacity: 0 } : { scale: [0.3, 1.6], opacity: [0.9, 0] }}
        transition={{ delay: 0.2, duration: durations.slow, ease: "easeOut" }}
      />
      <motion.span
        className="inline-flex origin-bottom-right"
        initial={reduced ? false : { rotate: -55, y: "-0.1em" }}
        animate={{ rotate: 0, y: 0 }}
        transition={{ ...springMomentum, delay: 0.05 }}
      >
        <Gavel className="size-[0.8em]" strokeWidth={2.25} />
      </motion.span>
    </span>
  );
}
