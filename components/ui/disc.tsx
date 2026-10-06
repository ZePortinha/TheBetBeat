/**
 * Disc — the decorative record (BetBeat's signature object). Pure CSS,
 * safe as a server component. With `bpm` it wears the Beat Pulse ring
 * (period 60/BPM s); `initials` sit on the red label.
 */

import type { CSSProperties } from "react";

export interface DiscProps {
  initials?: string;
  /** Any string (e.g. a title): gives each record its own stable tilt. */
  seed?: string;
  /** Set BPM — enables the Beat Pulse ring. Omit for a still record. */
  bpm?: number | null;
  className?: string;
  style?: CSSProperties;
}

function tilt(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function Disc({ initials, seed, bpm, className, style }: DiscProps) {
  const pulse =
    bpm && bpm > 0
      ? ({ "--beat-period": `${(60 / bpm).toFixed(3)}s` } as CSSProperties)
      : undefined;

  return (
    <span
      aria-hidden="true"
      className={["disc", pulse ? "beat-pulse" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      style={{ ...(seed ? { rotate: `${tilt(seed)}deg` } : {}), ...pulse, ...style }}
    >
      {initials ? <span className="disc-initials">{initials}</span> : null}
    </span>
  );
}
