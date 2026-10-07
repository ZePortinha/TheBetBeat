"use client";

/**
 * TrackRow — search result row (BRIEF B6 screen 2).
 *
 * 48px cover (image or placeholder gradient with initials), truncated
 * title/artist, fit chip, a "desde X €" slot on the right, pressed state
 * on pointer-down, and a grayed unavailable state with its reason.
 *
 * Presentation-only: every guest-visible string arrives via props.
 */

import * as React from "react";
import { motion } from "motion/react";
import type { FitLabel } from "@/lib/domain/types";
import { Disc } from "./disc";
import { FitChip } from "./fit-chip";
import { cx, usePressable, usePressAnimation } from "./pressable";

export interface TrackRowProps {
  title: string;
  artist: string;
  coverUrl?: string | null;
  fit?: FitLabel | null;
  /** Localized fit text, e.g. "Encaixa". Required to show the chip. */
  fitText?: string;
  /** Right-hand price slot, e.g. "desde 10 €". */
  priceSlot?: React.ReactNode;
  available?: boolean;
  /** Guest-visible reason shown when unavailable (replaces the price slot). */
  unavailableReason?: string;
  onSelect?: () => void;
  className?: string;
}

/** Initials for the placeholder cover (first letters of the first 2 words). */
export function coverInitials(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

export function TrackRow({
  title,
  artist,
  coverUrl,
  fit,
  fitText,
  priceSlot,
  available = true,
  unavailableReason,
  onSelect,
  className,
}: TrackRowProps) {
  const { pressed, handlers } = usePressable({
    onPress: onSelect ? () => onSelect() : undefined,
    disabled: !available,
  });
  const pressAnimation = usePressAnimation(pressed);

  return (
    <motion.button
      type="button"
      disabled={!available}
      data-pressed={pressed || undefined}
      initial={false}
      animate={pressAnimation.animate}
      transition={pressAnimation.transition}
      className={cx(
        "flex w-full touch-manipulation select-none items-center gap-3 px-4 py-2 text-left",
        "min-h-16 rounded-cover",
        pressed && "bg-surface-2",
        available ? "cursor-pointer" : "cursor-not-allowed",
        className,
      )}
      style={{ lineHeight: "var(--leading-dense)" }}
      {...handlers}
    >
      <Cover title={title} coverUrl={coverUrl} grayed={!available} />

      <span className={cx("min-w-0 flex-1", !available && "opacity-45")}>
        <span className="block truncate text-base font-semibold text-text-primary">
          {title}
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="truncate text-sm text-text-secondary">{artist}</span>
          {fit && fitText ? <FitChip label={fit} text={fitText} className="shrink-0" /> : null}
        </span>
      </span>

      <span className="shrink-0 text-right">
        {!available && unavailableReason ? (
          <span className="block max-w-32 text-xs text-text-tertiary">
            {unavailableReason}
          </span>
        ) : (
          <span className="tnum text-sm text-text-secondary">{priceSlot}</span>
        )}
      </span>
    </motion.button>
  );
}

function Cover({
  title,
  coverUrl,
  grayed,
}: {
  title: string;
  coverUrl?: string | null;
  grayed: boolean;
}) {
  const tone = grayed ? "opacity-45 grayscale" : "";
  return coverUrl ? (
    <span
      className={cx("relative block size-12 shrink-0 overflow-hidden rounded-cover", tone)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={coverUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
    </span>
  ) : (
    <Disc seed={title} className={cx("size-12 shrink-0", tone)} />
  );
}
