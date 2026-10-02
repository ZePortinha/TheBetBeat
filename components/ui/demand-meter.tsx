"use client";

/**
 * DemandMeter (BRIEF B10.5) — demand level as 4 ascending bars.
 * The heat gradient (--gradient-heat, the ONLY place gradients are allowed
 * besides progress) spans the whole 4-bar strip and is masked to the active
 * fraction: each lit bar shows its own slice of the gradient. Ambient subtle
 * breathing (duration `ambient`) only on very_high; reduced motion: static.
 * Color is never the only signal — the text label is required.
 */

import { motion, useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";
import { durations } from "@/lib/motion";
import type { DemandLevel } from "@/lib/domain/types";

export const DEMAND_BARS: Record<DemandLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  very_high: 4,
};

const BAR_HEIGHTS = [8, 12, 16, 20] as const;
const BAR_COUNT = BAR_HEIGHTS.length;

export interface DemandMeterProps {
  level: DemandLevel;
  /** Localized label, e.g. "Procura alta" — required (B10.2: not color-only). */
  label: string;
  className?: string;
}

export function DemandMeter({ level, label, className }: DemandMeterProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const lit = DEMAND_BARS[level];
  const breathing = level === "very_high" && !reducedMotion;

  return (
    <div
      className={["inline-flex items-center gap-2", className]
        .filter(Boolean)
        .join(" ")}
      role="meter"
      aria-valuemin={1}
      aria-valuemax={BAR_COUNT}
      aria-valuenow={lit}
      aria-valuetext={label}
    >
      <motion.div
        className="flex items-end gap-[3px]"
        aria-hidden="true"
        animate={breathing ? { opacity: [1, 0.7, 1] } : { opacity: 1 }}
        transition={
          breathing
            ? { duration: durations.ambient, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0 }
        }
      >
        {BAR_HEIGHTS.map((height, i) => {
          const active = i < lit;
          // Slice the shared heat gradient per bar: image spans 4 bars.
          const style: CSSProperties = active
            ? {
                height,
                backgroundImage: "var(--gradient-heat)",
                backgroundSize: `${BAR_COUNT * 100}% 100%`,
                backgroundPosition: `${(i / (BAR_COUNT - 1)) * 100}% 0`,
              }
            : { height };
          return (
            <span
              key={i}
              className={[
                "w-1.5 rounded-full",
                active ? "" : "bg-surface-3",
              ].join(" ")}
              style={style}
            />
          );
        })}
      </motion.div>
      <span className="text-[length:var(--text-14)] font-medium text-text-secondary">
        {label}
      </span>
    </div>
  );
}
