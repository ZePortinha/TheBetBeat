/**
 * ShareCard — the "A minha música tocou" shareable visual (BRIEF B6 screen 6).
 *
 * Fixed-size composition rendered at 1080×1920 (story) or 1080×1080 (square).
 * Pure static markup — NO "use client", no motion, no state — so an og/image
 * route can rasterize it later (e.g. with Satori/@vercel/og).
 *
 * Rasterizers cannot resolve CSS custom properties, so colors are literal
 * values mirroring styles/tokens.css (kept in the TOKENS map below — if a
 * token changes there, change it here too). Every visible string arrives via
 * props; only the brand wordmark has a default.
 */

import * as React from "react";

export type ShareCardFormat = "story" | "square";

export interface ShareCardProps {
  /** "story" = 1080×1920 · "square" = 1080×1080. */
  format: ShareCardFormat;
  /** Headline, e.g. "A minha música tocou". */
  headline: string;
  trackTitle: string;
  trackArtist: string;
  coverUrl?: string | null;
  venueName: string;
  /** e.g. "Sáb · 21 Set · 01:24". */
  dateTimeLabel: string;
  /** Brand wordmark. */
  wordmark?: string;
}

/** Literal mirrors of styles/tokens.css (rasterizer-safe — no var()). */
const TOKENS = {
  bgBase: "#000000",
  surface1: "#1c1c1e",
  surface3: "#2c2c2e",
  textPrimary: "#f5f5f7",
  textSecondary: "#aeaeb2",
  textTertiary: "#8e8e93",
  accent500: "#e8112d",
  accent400: "#ff453a",
  accent300: "#ff6961",
  lineStrong: "rgba(255, 255, 255, 0.14)",
} as const;

const FONT_DISPLAY = '-apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif';
const FONT_UI = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const SHARE_CARD_SIZES: Record<
  ShareCardFormat,
  { width: number; height: number }
> = {
  story: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

export function ShareCard({
  format,
  headline,
  trackTitle,
  trackArtist,
  coverUrl,
  venueName,
  dateTimeLabel,
  wordmark = "BetBeat",
}: ShareCardProps) {
  const { width, height } = SHARE_CARD_SIZES[format];
  const story = format === "story";

  const coverSize = story ? 560 : 400;
  const titleSize = story ? 96 : 72;
  const padding = story ? 96 : 80;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width,
        height,
        padding,
        background: `linear-gradient(180deg, ${TOKENS.bgBase} 0%, ${TOKENS.bgBase} 55%, ${TOKENS.surface1} 100%)`,
        color: TOKENS.textPrimary,
        fontFamily: FONT_UI,
      }}
    >
      {/* Headline */}
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", width: 96, height: 4, background: TOKENS.accent500 }} />
        <div
          style={{
            display: "flex",
            fontSize: story ? 40 : 34,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: TOKENS.accent400,
          }}
        >
          {headline}
        </div>
      </div>

      {/* Track */}
      <div
        style={{
          display: "flex",
          flexDirection: story ? "column" : "row",
          alignItems: story ? "flex-start" : "center",
          gap: story ? 56 : 64,
        }}
      >
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt=""
            width={coverSize}
            height={coverSize}
            style={{
              width: coverSize,
              height: coverSize,
              borderRadius: 48,
              objectFit: "cover",
            }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: coverSize,
              height: coverSize,
              borderRadius: 48,
              background: `linear-gradient(135deg, ${TOKENS.surface3}, ${TOKENS.surface1})`,
              color: TOKENS.accent300,
              fontFamily: FONT_DISPLAY,
              fontSize: coverSize / 4,
              fontWeight: 700,
            }}
          >
            {shareInitials(trackTitle)}
          </div>
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
            minWidth: 0,
            // Satori throws on an explicit `flex: undefined`.
            ...(story ? {} : { flex: 1 }),
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: FONT_DISPLAY,
              fontSize: titleSize,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              color: TOKENS.textPrimary,
            }}
          >
            {trackTitle}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: story ? 48 : 40,
              fontWeight: 500,
              color: TOKENS.textSecondary,
            }}
          >
            {trackArtist}
          </div>
        </div>
      </div>

      {/* Venue, date/time + wordmark */}
      <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              display: "flex",
              fontSize: story ? 44 : 38,
              fontWeight: 600,
              color: TOKENS.textPrimary,
            }}
          >
            {venueName}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: story ? 36 : 32,
              color: TOKENS.textTertiary,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {dateTimeLabel}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1px solid ${TOKENS.lineStrong}`,
            paddingTop: 40,
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: FONT_DISPLAY,
              fontSize: story ? 44 : 38,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: TOKENS.accent400,
            }}
          >
            {wordmark}
          </div>
          {/* Beat mark — three static bars echoing the Beat Pulse signature. */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <div style={{ display: "flex", width: 10, height: 24, background: TOKENS.accent500, borderRadius: 5 }} />
            <div style={{ display: "flex", width: 10, height: 44, background: TOKENS.accent500, borderRadius: 5 }} />
            <div style={{ display: "flex", width: 10, height: 32, background: TOKENS.accent500, borderRadius: 5 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function shareInitials(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}
