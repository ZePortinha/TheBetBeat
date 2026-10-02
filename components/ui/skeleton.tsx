/**
 * Skeleton — loading placeholders with the shared `.skeleton` shimmer
 * (1.4s, defined in app/globals.css; static under reduced motion).
 * Never full-screen spinners (BRIEF B10.6 animation #14).
 *
 * Server-component friendly: no hooks, no client boundary.
 */

import * as React from "react";

/** Local class joiner — keeps this module server-component safe. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type SkeletonRounded = "chip" | "button" | "card" | "full";

const ROUNDED_CLASSES: Record<SkeletonRounded, string> = {
  chip: "rounded-chip",
  button: "rounded-button",
  card: "rounded-card",
  full: "rounded-full",
};

export interface SkeletonProps {
  /** Number = px; string passes through (e.g. "100%", "3rem"). */
  width?: number | string;
  height?: number | string;
  rounded?: SkeletonRounded;
  className?: string;
}

export function Skeleton({
  width,
  height,
  rounded = "chip",
  className,
}: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cx("skeleton h-4 w-full", ROUNDED_CLASSES[rounded], className)}
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
      }}
    />
  );
}

export interface SkeletonTextProps {
  /** Number of text lines; the last one is shorter when there are several. */
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div aria-hidden className={cx("flex flex-col gap-2", className)}>
      {Array.from({ length: Math.max(lines, 1) }, (_, index) => (
        <div
          key={index}
          className={cx(
            "skeleton h-4",
            index === lines - 1 && lines > 1 ? "w-3/5" : "w-full",
          )}
        />
      ))}
    </div>
  );
}
