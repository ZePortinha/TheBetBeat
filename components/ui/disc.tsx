/**
 * Disc — the decorative record (Discontrol's signature object). Pure CSS,
 * safe as a server component. With `bpm` it wears the Beat Pulse ring
 * (period 60/BPM s); with `knob` its red label is the mark's mixer knob
 * (pointer turned up, no spindle hole), so the record reads as the logo.
 */

import type { CSSProperties } from "react";

export interface DiscProps {
  /** Draw the brand mark's knob pointer on the label. */
  knob?: boolean;
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

export function Disc({ knob, seed, bpm, className, style }: DiscProps) {
  const pulse =
    bpm && bpm > 0
      ? ({ "--beat-period": `${(60 / bpm).toFixed(3)}s` } as CSSProperties)
      : undefined;

  return (
    <span
      aria-hidden="true"
      className={["disc", knob ? "disc-has-knob" : "", pulse ? "beat-pulse" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      style={{ ...(seed ? { rotate: `${tilt(seed)}deg` } : {}), ...pulse, ...style }}
    >
      {knob ? <span className="disc-knob" /> : null}
    </span>
  );
}
