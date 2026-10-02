"use client";

/**
 * NowPlaying — the "Agora" panel (BRIEF B7 left column / B6 screen 1).
 *
 * Cover with the signature Beat Pulse ring tied to the set's BPM, track
 * title/artist, a smooth rAF-driven progress bar (startedAt + durationSec +
 * injected getNow), elapsed/total times in tabular numerals, and the amount
 * with the requester's optional handle.
 *
 * The progress bar animates `transform: scaleX` only (compositor-friendly)
 * and uses the heat gradient — allowed exclusively on progress indicators
 * (B10.2). Presentation-only: strings arrive via props.
 */

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { PriceTag } from "./price-tag";

export interface NowPlayingProps {
  title: string;
  artist: string;
  coverUrl?: string | null;
  /** Set BPM — drives the Beat Pulse ring (period 60/BPM s). Omit to disable. */
  bpm?: number | null;
  /** Track start, epoch ms. */
  startedAt: number;
  durationSec: number;
  /** Injected clock (epoch ms). Defaults to Date.now in the browser. */
  getNow?: () => number;
  amountCents?: number | null;
  /** Requester handle (opt-in), e.g. "@rita". */
  handle?: string | null;
  className?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const min = Math.floor(sec / 60);
  return `${min}:${String(sec % 60).padStart(2, "0")}`;
}

export function NowPlaying({
  title,
  artist,
  coverUrl,
  bpm,
  startedAt,
  durationSec,
  getNow,
  amountCents,
  handle,
  className,
}: NowPlayingProps) {
  const now = getNow ?? (() => Date.now());
  const getNowRef = useRef(now);
  getNowRef.current = now;

  const fillRef = useRef<HTMLDivElement>(null);
  const [elapsedSec, setElapsedSec] = useState(() =>
    clamp((getNowRef.current() - startedAt) / 1000, 0, durationSec),
  );

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const sec = clamp((getNowRef.current() - startedAt) / 1000, 0, durationSec);
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${durationSec > 0 ? sec / durationSec : 0})`;
      }
      // Re-render only when the displayed second changes.
      setElapsedSec((prev) => (Math.floor(sec) === Math.floor(prev) ? prev : sec));
      if (sec < durationSec) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startedAt, durationSec]);

  const fraction = durationSec > 0 ? clamp(elapsedSec / durationSec, 0, 1) : 0;
  const beatPeriod = bpm && bpm > 0 ? `${(60 / bpm).toFixed(3)}s` : undefined;

  return (
    <div
      className={[
        "rounded-card border border-line-subtle bg-surface-1 p-4",
        className ?? "",
      ].join(" ")}
      style={{ lineHeight: "var(--leading-dense)" }}
    >
      <div className="flex items-center gap-4">
        <span
          className={[
            "relative block size-16 shrink-0 overflow-hidden rounded-cover",
            beatPeriod ? "beat-pulse" : "",
          ].join(" ")}
          style={
            beatPeriod
              ? ({ "--beat-period": beatPeriod } as React.CSSProperties)
              : undefined
          }
        >
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <span
              className="flex size-full items-center justify-center text-base font-semibold text-text-secondary"
              style={{
                background:
                  "linear-gradient(135deg, var(--color-surface-3), var(--color-surface-1))",
              }}
            >
              {title
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((word) => word.charAt(0).toUpperCase())
                .join("")}
            </span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p
            className="truncate text-base font-bold text-text-primary"
            title={`${title} — ${artist}`}
          >
            {title}
          </p>
          <p className="truncate text-sm text-text-secondary">{artist}</p>
          {amountCents != null || handle ? (
            <p className="mt-1 flex items-baseline gap-2">
              {amountCents != null ? <PriceTag cents={amountCents} size="md" /> : null}
              {handle ? (
                <span className="truncate text-sm text-text-tertiary">{handle}</span>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>

      {/* Progress: heat gradient, scaleX-only animation via rAF. */}
      <div className="mt-3">
        <div
          className="h-1.5 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={Math.round(durationSec)}
          aria-valuenow={Math.round(elapsedSec)}
        >
          <div
            ref={fillRef}
            className="h-full w-full origin-left will-change-transform"
            style={{
              background: "var(--gradient-heat)",
              transform: `scaleX(${fraction})`,
            }}
          />
        </div>
        <div className="tnum mt-1 flex justify-between text-xs text-text-tertiary">
          <span>{formatClock(elapsedSec)}</span>
          <span>{formatClock(durationSec)}</span>
        </div>
      </div>
    </div>
  );
}
