/**
 * LiveBadge (BRIEF B10.5) — "AO VIVO"-style badge.
 * Ember dot wearing the signature Beat Pulse ring (global `.beat-pulse`
 * class); the ring period follows the set's BPM via --beat-period = 60/BPM s.
 * Text is an uppercase `.label` and comes in via prop (localized by caller).
 * Pure CSS animation — safe as a server component; `.beat-pulse` already
 * freezes under prefers-reduced-motion (globals.css).
 */

import type { CSSProperties } from "react";

export interface LiveBadgeProps {
  /** Uppercase label text, e.g. "AO VIVO". */
  text: string;
  /** Set BPM — Beat Pulse period is 60/bpm seconds. Defaults to 120. */
  bpm?: number;
  className?: string;
}

export function LiveBadge({ text, bpm = 120, className }: LiveBadgeProps) {
  const safeBpm = bpm > 0 ? bpm : 120;
  const dotStyle = {
    "--beat-period": `${(60 / safeBpm).toFixed(3)}s`,
  } as CSSProperties;

  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full border border-line-strong",
        "bg-surface-2 py-1 pl-2.5 pr-3",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        className="beat-pulse block h-2 w-2 rounded-full bg-ember-500"
        style={dotStyle}
        aria-hidden="true"
      />
      <span className="label text-ember-500">{text}</span>
    </span>
  );
}
