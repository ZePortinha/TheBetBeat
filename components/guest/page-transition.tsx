"use client";

/**
 * The party screens fade in when you switch tabs (app/(guest)/s/[qrToken]/
 * template.tsx remounts this on every navigation). Not on the first load:
 * server HTML is never shipped invisible (LCP, and the boot intro already
 * covers that moment). Opacity only: a transform here would turn the
 * screens' fixed CTAs into absolutely positioned ones for the length of
 * the animation. The tab bar and the overlays live in the layout and never
 * blink. Reduced motion: the same fade, shorter.
 */

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { durations, easeStandard } from "@/lib/motion";

const noopSubscribe = () => () => undefined;

export function PageTransition({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion() ?? false;
  const hydrating = React.useSyncExternalStore(
    noopSubscribe,
    () => false,
    () => true,
  );
  const [firstLoad] = React.useState(hydrating);
  return (
    <motion.div
      initial={firstLoad ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0.12 : durations.base, ease: [...easeStandard] }}
    >
      {children}
    </motion.div>
  );
}
