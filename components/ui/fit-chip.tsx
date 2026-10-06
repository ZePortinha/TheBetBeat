/**
 * Chip + FitChip (BRIEF B10.5 / B10.2 rules).
 * Color is NEVER the only signal: a FitChip always carries icon + text.
 * The generic Chip also serves tier chips and library chips.
 * Static — safe as a server component.
 */

import type { ReactNode } from "react";
import { CircleCheck, Shuffle, TriangleAlert } from "lucide-react";
import type { FitLabel } from "@/lib/domain/types";

export type ChipTone = "neutral" | "accent" | "green" | "amber" | "ember";

const TONE_CLASSES: Record<ChipTone, string> = {
  neutral: "border-line-strong bg-surface-2 text-text-secondary",
  accent: "border-accent-500/35 bg-accent-500/10 text-accent-400",
  green: "border-green-500/35 bg-green-500/10 text-green-500",
  amber: "border-amber-500/35 bg-amber-500/10 text-amber-500",
  ember: "border-ember-500/35 bg-ember-500/10 text-ember-500",
};

export interface ChipProps {
  children: ReactNode;
  tone?: ChipTone;
  /** Optional leading icon (pass a sized lucide element). */
  icon?: ReactNode;
  className?: string;
}

/** Generic chip: radius 8 (B10.4), 12px semibold text, icon + text. */
export function Chip({ children, tone = "neutral", icon, className }: ChipProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-chip border px-2 py-1",
        "text-[length:var(--text-12)] font-semibold leading-none",
        "tracking-[var(--tracking-small)]",
        TONE_CLASSES[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {icon}
      <span>{children}</span>
    </span>
  );
}

const FIT_META: Record<
  FitLabel,
  { Icon: typeof CircleCheck; tone: ChipTone }
> = {
  fits: { Icon: CircleCheck, tone: "green" },
  possible: { Icon: Shuffle, tone: "amber" },
  off_style: { Icon: TriangleAlert, tone: "ember" },
};

export interface FitChipProps {
  label: FitLabel;
  /** Localized text, provided by the caller (e.g. "Encaixa"). */
  text: string;
  className?: string;
}

/**
 * Musical-fit chip: fits → green + check-circle, possible → amber + shuffle,
 * off_style → ember + alert-triangle. Icon and text make the state readable
 * without color. Lucide stroke 1.75 (B10.4); 14px fits the 12px chip text.
 */
export function FitChip({ label, text, className }: FitChipProps) {
  const { Icon, tone } = FIT_META[label];
  return (
    <Chip
      tone={tone}
      className={className}
      icon={<Icon size={14} strokeWidth={1.75} aria-hidden="true" />}
    >
      {text}
    </Chip>
  );
}
