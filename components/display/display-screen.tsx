"use client";

/**
 * DisplayScreen — the venue screen (BRIEF B8).
 *
 * Fullscreen, zero interaction, works in 16:9 AND 9:16 purely via CSS
 * orientation variants. High contrast, Unbounded display type up to 80px,
 * legible at 15m. The only motion is an 800ms opacity crossfade between
 * rotating content panels; the QR sits in its own stable grid region and
 * NEVER animates, moves or leaves the screen (quiet zone enforced by
 * QRBlock).
 *
 * Live updates: subscribes to the public session broadcast channel and
 * refetches the public state DTO on every event. A 10s poll fallback runs
 * whenever the socket is not connected (plus a 60s safety refresh while
 * connected), so the screen heals itself on flaky venue Wi-Fi. All content
 * timing uses the server clock from the DTO — never the TV's clock.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { LiveBadge } from "@/components/ui/live-badge";
import { QRBlock } from "@/components/ui/qr-block";
import { publicChannel } from "@/lib/realtime/events";
import { useRealtimeChannel } from "@/lib/realtime/client";
import type { DisplayStateDto } from "@/app/api/display/_lib/state";
import { Crossfade } from "./crossfade";

const POLL_MS = 10_000;
const SAFETY_REFRESH_MS = 60_000;
const TOP_PAGE_SIZE = 5;
const TOP_PAGE_ROTATE_MS = 8_000;

export interface DisplayScreenProps {
  sessionId: string;
  /** Raw display token (path segment) for the poll endpoint. */
  token: string;
  initial: DisplayStateDto;
}

const displayFont: CSSProperties = { fontFamily: "var(--font-display)" };

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

export function DisplayScreen({ sessionId, token, initial }: DisplayScreenProps) {
  const t = useTranslations("display");
  const [state, setState] = useState<DisplayStateDto>(initial);
  const lastFetchRef = useRef(Date.now());
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/display/${encodeURIComponent(token)}/state`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const dto = (await res.json()) as DisplayStateDto;
      lastFetchRef.current = Date.now();
      setState(dto);
    } catch {
      // Keep showing the last good state; the poll loop retries.
    }
  }, [token]);

  // Realtime: any public session event → debounced refetch of the DTO.
  const connection = useRealtimeChannel(
    publicChannel(sessionId),
    { private: false },
    () => {
      if (refetchTimer.current) return;
      refetchTimer.current = setTimeout(() => {
        refetchTimer.current = null;
        void refetch();
      }, 300);
    },
  );
  useEffect(
    () => () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    },
    [],
  );

  // Poll fallback — ALWAYS armed: every 10s while not connected, and a
  // slow safety refresh even when the socket looks healthy.
  useEffect(() => {
    const id = setInterval(() => {
      const stale = Date.now() - lastFetchRef.current;
      if (connection !== "connected" || stale >= SAFETY_REFRESH_MS) {
        void refetch();
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [connection, refetch]);

  // Top-of-night page rotation (crossfaded panels).
  const topPages = Math.max(1, Math.ceil(state.top.length / TOP_PAGE_SIZE));
  const [topPage, setTopPage] = useState(0);
  useEffect(() => {
    if (topPages <= 1) {
      setTopPage(0);
      return;
    }
    const id = setInterval(
      () => setTopPage((p) => (p + 1) % topPages),
      TOP_PAGE_ROTATE_MS,
    );
    return () => clearInterval(id);
  }, [topPages]);
  const topSlice = state.top.slice(
    (topPage % topPages) * TOP_PAGE_SIZE,
    (topPage % topPages) * TOP_PAGE_SIZE + TOP_PAGE_SIZE,
  );

  const { now, next, session } = state;
  const beatPeriod =
    now?.bpm && now.bpm > 0 ? `${(60 / now.bpm).toFixed(3)}s` : undefined;

  return (
    <main
      className={[
        "fixed inset-0 grid overflow-hidden bg-bg-base text-text-primary",
        "gap-[4vmin] p-[5vmin]",
        "landscape:grid-cols-[minmax(0,1fr)_auto] landscape:items-center",
        "portrait:grid-rows-[minmax(0,1fr)_auto] portrait:justify-items-stretch",
      ].join(" ")}
    >
      {/* ── Content column (the only region that ever crossfades) ──── */}
      <section className="flex min-w-0 flex-col justify-center gap-[4.5vmin]">
        <header className="flex items-center gap-[2vmin]">
          {session.live ? (
            <LiveBadge text={t("live")} bpm={now?.bpm ?? undefined} />
          ) : null}
          <p
            className="truncate text-text-secondary"
            style={{ fontSize: "clamp(1rem, 2.4vmin, 1.5rem)", fontWeight: 600 }}
          >
            {session.venueName}
            {session.name ? ` · ${session.name}` : ""}
          </p>
        </header>

        {/* Now playing hero */}
        {session.live ? (
          <Crossfade contentKey={now ? `${now.title}—${now.artist}` : "idle"}>
            <div className="flex items-center gap-[3vmin]">
              {now ? (
                <span
                  className={["grid shrink-0 place-items-center rounded-full", beatPeriod ? "beat-pulse" : ""].join(" ")}
                  style={
                    {
                      width: "12vmin",
                      height: "12vmin",
                      background:
                        "linear-gradient(135deg, var(--color-surface-3), var(--color-surface-1))",
                      ...(beatPeriod ? { "--beat-period": beatPeriod } : {}),
                    } as CSSProperties
                  }
                  aria-hidden="true"
                >
                  <span
                    className="text-text-secondary"
                    style={{ ...displayFont, fontSize: "4vmin", fontWeight: 700 }}
                  >
                    {initials(now.title)}
                  </span>
                </span>
              ) : null}
              <div className="min-w-0">
                <p
                  className="label text-gold-500"
                  style={{ fontSize: "clamp(0.875rem, 2vmin, 1.25rem)" }}
                >
                  {t("nowPlaying")}
                </p>
                <h1
                  data-testid="display-now-title"
                  className="truncate"
                  style={{
                    ...displayFont,
                    fontSize: "clamp(2rem, 8vmin, var(--text-80))",
                    fontWeight: 800,
                    lineHeight: 1.05,
                    letterSpacing: "var(--tracking-display)",
                  }}
                >
                  {now ? now.title : t("nowEmpty")}
                </h1>
                {now ? (
                  <p
                    className="truncate text-text-secondary"
                    style={{
                      fontSize: "clamp(1.25rem, 4vmin, var(--text-40))",
                      fontWeight: 600,
                      letterSpacing: "var(--tracking-heading)",
                    }}
                  >
                    {now.artist}
                    {now.handle ? (
                      <span className="text-gold-500"> · @{now.handle}</span>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </div>
          </Crossfade>
        ) : (
          <div>
            <h1
              style={{
                ...displayFont,
                fontSize: "clamp(2rem, 7vmin, var(--text-80))",
                fontWeight: 800,
                lineHeight: 1.1,
              }}
            >
              {t("paused.title")}
            </h1>
            <p
              className="mt-[1.5vmin] text-text-secondary"
              style={{ fontSize: "clamp(1.25rem, 3vmin, var(--text-32))" }}
            >
              {t("paused.subtitle")}
            </p>
          </div>
        )}

        {/* A seguir */}
        {session.live ? (
          <Crossfade contentKey={next ? `${next.title}—${next.artist}` : "none"}>
            <div className="min-w-0 border-t border-line-subtle pt-[2.5vmin]">
              <p
                className="label text-text-secondary"
                style={{ fontSize: "clamp(0.875rem, 2vmin, 1.25rem)" }}
              >
                {t("next")}
              </p>
              <p
                className="truncate"
                style={{
                  fontSize: "clamp(1.5rem, 3.6vmin, var(--text-40))",
                  fontWeight: 700,
                }}
              >
                {next ? (
                  <>
                    {next.title}
                    <span className="text-text-secondary"> — {next.artist}</span>
                    {next.handle ? (
                      <span className="text-gold-500"> · @{next.handle}</span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-text-secondary">{t("nextEmpty")}</span>
                )}
              </p>
            </div>
          </Crossfade>
        ) : null}

        {/* Top da noite — handles only, no amounts (B8) */}
        {state.top.length > 0 ? (
          <div className="min-w-0 border-t border-line-subtle pt-[2.5vmin]">
            <p
              className="label text-text-secondary"
              style={{ fontSize: "clamp(0.875rem, 2vmin, 1.25rem)" }}
            >
              {t("top.title")}
            </p>
            <Crossfade contentKey={`top-${topPage % topPages}`}>
              <ol className="mt-[1vmin] flex flex-col gap-[1vmin]">
                {topSlice.map((entry, i) => (
                  <li
                    key={entry.handle}
                    className="flex items-baseline gap-[1.6vmin]"
                    style={{ fontSize: "clamp(1.25rem, 3vmin, var(--text-32))" }}
                  >
                    <span
                      className="tnum text-gold-500"
                      style={{ ...displayFont, fontWeight: 700 }}
                    >
                      {(topPage % topPages) * TOP_PAGE_SIZE + i + 1}
                    </span>
                    <span className="truncate font-semibold">@{entry.handle}</span>
                    <span className="tnum ml-auto shrink-0 text-text-secondary">
                      {t("top.requests", { count: entry.requests })}
                    </span>
                  </li>
                ))}
              </ol>
            </Crossfade>
          </div>
        ) : null}
      </section>

      {/* ── QR region — stable in both orientations, NEVER animates ── */}
      <aside className="flex items-center justify-center">
        <div data-testid="display-qr" data-qr-url={state.qrUrl}>
          <QRBlock
            url={state.qrUrl}
            size={400}
            alt={t("qrCaption")}
            caption={
              <span
                className="block text-text-primary"
                style={{
                  fontSize: "clamp(1.25rem, 3vmin, var(--text-32))",
                  fontWeight: 700,
                }}
              >
                {t("qrCaption")}
              </span>
            }
          />
        </div>
      </aside>

      {/* Subtle wordmark */}
      <span
        className="pointer-events-none absolute bottom-[2vmin] right-[2.5vmin] text-text-tertiary"
        style={{ ...displayFont, fontSize: "clamp(0.75rem, 1.6vmin, 1rem)", fontWeight: 600 }}
        aria-hidden="true"
      >
        BetBeat
      </span>
    </main>
  );
}
