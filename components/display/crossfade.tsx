"use client";

/**
 * Crossfade (BRIEF B8 / B10.6 anim 13) — the ONLY motion allowed on the
 * venue screen: an 800ms opacity tween between rotating content panels.
 * Old and new panels overlap in the same grid cell so nothing shifts.
 * Reduced motion: instant content swap (duration 0).
 * The QR must NEVER be rendered inside a Crossfade.
 */

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export const CROSSFADE_SECONDS = 0.8;

export interface CrossfadeProps {
  /** Changing this key triggers the crossfade. */
  contentKey: string;
  children: ReactNode;
  className?: string;
}

export function Crossfade({ contentKey, children, className }: CrossfadeProps) {
  const reduced = useReducedMotion();
  return (
    <div className={["grid", className].filter(Boolean).join(" ")}>
      <AnimatePresence initial={false}>
        <motion.div
          key={contentKey}
          className="col-start-1 row-start-1 min-w-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            type: "tween",
            ease: "linear",
            duration: reduced ? 0 : CROSSFADE_SECONDS,
          }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
