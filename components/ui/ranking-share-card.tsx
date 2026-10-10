/**
 * RankingShareCard — "Top da noite" as an Instagram Story image
 * (1080×1920, 2026-10-08). The podium for the top 3, the next places as a
 * list, the venue, the night and the wordmark.
 *
 * Same contract as ShareCard: static, Satori-safe markup (every element is
 * flex, literal colours mirroring styles/tokens.css), every string via props.
 */

import * as React from "react";

export interface RankingShareEntry {
  /** "@rita", "Mesa 12" or the translated "Anónimo". */
  name: string;
  /** Already formatted ("12 €"). */
  amount: string;
}

export interface RankingShareCardProps {
  eyebrow: string;
  title: string;
  venueName: string;
  dateLabel: string;
  entries: RankingShareEntry[];
  footnote: string;
  wordmark?: string;
}

export const RANKING_CARD_SIZE = { width: 1080, height: 1920 } as const;

const C = {
  bg: "#000000",
  surface1: "#1c1c1e",
  surface2: "#242426",
  textPrimary: "#f5f5f7",
  textSecondary: "#aeaeb2",
  textTertiary: "#8e8e93",
  accent500: "#e8112d",
  accent400: "#ff453a",
  amber: "#ff9f0a",
  gold: "#ffd60a",
  silver: "#d1d1d6",
  bronze: "#d0874f",
  line: "rgba(255, 255, 255, 0.12)",
} as const;

const FONT = '-apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif';

const PLACES = [
  { ring: C.gold, step: 300, avatar: 196, name: 46, amount: 44 },
  { ring: C.silver, step: 210, avatar: 150, name: 38, amount: 36 },
  { ring: C.bronze, step: 150, avatar: 150, name: 38, amount: 36 },
] as const;

function initialOf(name: string): string {
  const letter = name.replace(/^@/, "").trim().charAt(0);
  return letter ? letter.toUpperCase() : "?";
}

function Podium({ entry, place }: { entry: RankingShareEntry | undefined; place: 0 | 1 | 2 }) {
  const look = PLACES[place];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 300 }}>
      {entry ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: look.avatar,
              height: look.avatar,
              borderRadius: look.avatar,
              border: `8px solid ${look.ring}`,
              background: place === 0 ? C.accent500 : C.surface2,
              color: C.textPrimary,
              fontSize: look.avatar * 0.42,
              fontWeight: 800,
              boxShadow: place === 0 ? `0 0 80px rgba(255, 214, 10, 0.45)` : "none",
            }}
          >
            {initialOf(entry.name)}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 24,
              maxWidth: 290,
              overflow: "hidden",
              whiteSpace: "nowrap",
              fontSize: look.name,
              fontWeight: 700,
              color: C.textPrimary,
            }}
          >
            {entry.name}
          </div>
          <div style={{ display: "flex", marginTop: 6, fontSize: look.amount, fontWeight: 800, color: place === 0 ? C.gold : C.textSecondary }}>
            {entry.amount}
          </div>
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginTop: 28,
          width: 280,
          height: look.step,
          paddingTop: 22,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          background:
            place === 0
              ? `linear-gradient(180deg, rgba(232, 17, 45, 0.75) 0%, rgba(232, 17, 45, 0.08) 100%)`
              : `linear-gradient(180deg, ${C.surface2} 0%, rgba(36, 36, 38, 0.2) 100%)`,
          borderTop: `3px solid ${place === 0 ? C.accent400 : C.line}`,
          color: place === 0 ? C.textPrimary : C.textTertiary,
          fontSize: 76,
          fontWeight: 800,
        }}
      >
        {String(place + 1)}
      </div>
    </div>
  );
}

export function RankingShareCard({ eyebrow, title, venueName, dateLabel, entries, footnote, wordmark = "BetBeat" }: RankingShareCardProps) {
  const rest = entries.slice(3, 8);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: RANKING_CARD_SIZE.width,
        height: RANKING_CARD_SIZE.height,
        padding: "96px 80px 80px",
        backgroundColor: C.bg,
        backgroundImage: "linear-gradient(180deg, #000000 0%, #5a0612 34%, #2a030a 58%, #000000 84%)",
        color: C.textPrimary,
        fontFamily: FONT,
      }}
    >
      {/* Heading */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", width: 96, height: 6, background: C.accent500, borderRadius: 3 }} />
        <div style={{ display: "flex", marginTop: 32, fontSize: 38, fontWeight: 700, letterSpacing: "0.08em", color: C.accent400 }}>
          {eyebrow.toUpperCase()}
        </div>
        <div style={{ display: "flex", marginTop: 12, fontSize: 104, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.02 }}>
          {title}
        </div>
        <div style={{ display: "flex", marginTop: 18, fontSize: 40, fontWeight: 600, color: C.textSecondary }}>
          {`${venueName} · ${dateLabel}`}
        </div>
      </div>

      {/* Podium: 2 · 1 · 3 */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", marginTop: 80, gap: 10 }}>
        <Podium entry={entries[1]} place={1} />
        <Podium entry={entries[0]} place={0} />
        <Podium entry={entries[2]} place={2} />
      </div>

      {/* Next places */}
      <div style={{ display: "flex", flexDirection: "column", marginTop: 8, borderTop: `2px solid ${C.line}` }}>
        {rest.map((e, i) => (
          <div
            key={`${e.name}-${i}`}
            style={{
              display: "flex",
              alignItems: "center",
              height: 92,
              borderBottom: `2px solid ${C.line}`,
              fontSize: 38,
            }}
          >
            <div style={{ display: "flex", width: 80, color: C.textTertiary, fontWeight: 700 }}>{String(i + 4)}</div>
            <div style={{ display: "flex", flexGrow: 1, color: C.textPrimary, fontWeight: 600 }}>{e.name}</div>
            <div style={{ display: "flex", color: C.textSecondary, fontWeight: 700 }}>{e.amount}</div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ display: "flex", flexGrow: 1 }} />
      <div style={{ display: "flex", fontSize: 30, color: C.textTertiary }}>{footnote}</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 36,
          paddingTop: 36,
          borderTop: `2px solid ${C.line}`,
        }}
      >
        <div style={{ display: "flex", fontSize: 48, fontWeight: 800, color: C.accent400 }}>{wordmark}</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <div style={{ display: "flex", width: 10, height: 24, background: C.accent500, borderRadius: 5 }} />
          <div style={{ display: "flex", width: 10, height: 44, background: C.accent500, borderRadius: 5 }} />
          <div style={{ display: "flex", width: 10, height: 32, background: C.accent500, borderRadius: 5 }} />
        </div>
      </div>
    </div>
  );
}
