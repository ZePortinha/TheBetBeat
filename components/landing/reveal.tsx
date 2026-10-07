"use client";

/**
 * Reveal — one-shot entrance for landing blocks. Opacity is a tween,
 * movement is a spring (lib/motion); both are transform/opacity only.
 * Under reduced motion it is a plain short fade.
 */

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { durations, easeStandard, springDefault } from "@/lib/motion";

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** Stagger offset in seconds. */
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion() ?? false;

  return (
    <motion.div
      className={className}
      // One initial style for everyone (the server cannot know the
      // preference); reduced motion just skips the movement.
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{
        opacity: { duration: durations.base, ease: easeStandard, delay },
        y: reduced ? { duration: 0 } : { ...springDefault, delay },
      }}
    >
      {children}
    </motion.div>
  );
}
