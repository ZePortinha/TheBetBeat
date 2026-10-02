"use client";

/**
 * TierCard — tier selection card (BRIEF B6 screen 3 + B10.6 animation 1).
 *
 * Selected: card scales to 1.02 with springDefault, a gold inset outline
 * draws in (fast tween on opacity/scaleX) and the glow-gold shadow enters.
 * Only ONE glow per screen — the parent guarantees a single selected card.
 * Press feedback on pointer-down (scale 0.97, instant tween) through the
 * shared `usePressable` engine (hit slop, drag-away cancel, double-tap guard).
 * Unavailable: grayed out, with the guest-visible reason.
 *
 * Presentation-only: every guest-visible string arrives via props.
 */

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Tier } from "@/lib/domain/types";
import { durations, easeStandard, springDefault } from "@/lib/motion";
import { PriceTag } from "./price-tag";
import { cx, usePressable } from "./pressable";

export interface TierCardProps {
  tier: Tier;
  /** Tier name, e.g. "A Seguir". */
  name: string;
  /** One-line promise, e.g. "Toca nas próximas 2 músicas". */
  promise: string;
  priceCents: number;
  /** Display ETA, e.g. "~6 min". */
  etaLabel: string;
  selected?: boolean;
  available?: boolean;
  /** Guest-visible reason shown when unavailable. */
  unavailableReason?: string;
  onSelect?: () => void;
  className?: string;
}

export function TierCard({
  tier,
  name,
  promise,
  priceCents,
  etaLabel,
  selected = false,
  available = true,
  unavailableReason,
  onSelect,
  className,
}: TierCardProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const { pressed, handlers } = usePressable({
    onPress: onSelect ? () => onSelect() : undefined,
    disabled: !available,
  });

  // Press (0.97) wins over selected (1.02); both start from the current
  // on-screen value and are interruptible (springs).
  const scale = reducedMotion ? 1 : pressed ? 0.97 : selected ? 1.02 : 1;

  return (
    <motion.button
      type="button"
      data-tier={tier}
      data-pressed={pressed || undefined}
      aria-pressed={selected}
      disabled={!available}
      initial={false}
      animate={{ scale, opacity: reducedMotion && pressed ? 0.8 : 1 }}
      transition={
        pressed
          ? { duration: durations.instant, ease: [...easeStandard] }
          : springDefault
      }
      className={cx(
        "relative block w-full touch-manipulation select-none text-left",
        "rounded-card border border-line-subtle p-4",
        "min-h-[88px]",
        selected ? "bg-surface-2 shadow-glow-gold" : "bg-surface-1",
        available ? "cursor-pointer" : "cursor-not-allowed",
        className,
      )}
      style={{ lineHeight: "var(--leading-dense)" }}
      {...handlers}
    >
      {/* Gold outline that draws in on selection (B10.6 animation 1). */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-card border-[1.5px] border-gold-500"
        initial={false}
        animate={{ opacity: selected ? 1 : 0, scaleX: selected || reducedMotion ? 1 : 0.65 }}
        transition={{ duration: durations.fast, ease: [...easeStandard] }}
        style={{ transformOrigin: "left center" }}
      />

      <span className={cx("block", !available && "opacity-45")}>
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-base font-bold text-text-primary">{name}</span>
          <span className="tnum shrink-0 text-sm text-text-secondary">{etaLabel}</span>
        </span>

        <span className="mt-0.5 block text-sm text-text-secondary">{promise}</span>

        <span className="mt-2 block">
          <PriceTag cents={priceCents} size="md" />
        </span>
      </span>

      {!available && unavailableReason ? (
        <span className="mt-2 block text-xs text-text-tertiary">{unavailableReason}</span>
      ) : null}
    </motion.button>
  );
}
