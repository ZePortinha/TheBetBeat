"use client";

/**
 * TrackHero — selected track header (BRIEF B6 screen 3).
 *
 * 96px cover, title in the UI font at weight 700, artist, and a
 * genre · BPM · key meta row with tabular numerals. The optional 30s
 * preview button arrives as `children` (a slot — this component stays
 * presentation-only and plays nothing itself).
 */

import * as React from "react";
import { coverInitials } from "./track-row";

export interface TrackHeroProps {
  title: string;
  artist: string;
  coverUrl?: string | null;
  genre?: string | null;
  bpm?: number | null;
  /** Camelot notation, e.g. "8A". */
  camelotKey?: string | null;
  /** Optional preview button slot (30s preview — B6 screen 3). */
  children?: React.ReactNode;
  className?: string;
}

export function TrackHero({
  title,
  artist,
  coverUrl,
  genre,
  bpm,
  camelotKey,
  children,
  className,
}: TrackHeroProps) {
  const metaParts: string[] = [];
  if (genre) metaParts.push(genre);
  if (bpm != null) metaParts.push(`${Math.round(bpm)} BPM`);
  if (camelotKey) metaParts.push(camelotKey);

  return (
    <div className={["flex items-center gap-4", className ?? ""].join(" ")}>
      <span className="relative block size-24 shrink-0 overflow-hidden rounded-cover">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt="" className="size-full object-cover" />
        ) : (
          <span
            className="flex size-full items-center justify-center text-xl font-semibold text-text-secondary"
            style={{
              background:
                "linear-gradient(135deg, var(--color-surface-3), var(--color-surface-1))",
            }}
          >
            {coverInitials(title)}
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <h2
          className="truncate text-2xl font-bold text-text-primary"
          style={{
            letterSpacing: "var(--tracking-heading)",
            lineHeight: "var(--leading-title)",
          }}
          title={`${title} — ${artist}`}
        >
          {title}
        </h2>
        <p className="mt-0.5 truncate text-base text-text-secondary">{artist}</p>
        {metaParts.length > 0 ? (
          <p className="tnum mt-1 truncate text-sm text-text-tertiary">
            {metaParts.join(" · ")}
          </p>
        ) : null}
        {children ? <div className="mt-2">{children}</div> : null}
      </div>
    </div>
  );
}
