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
import { BrandLockup } from "@/components/ui/brand-mark";
import { Disc } from "@/components/ui/disc";
import { LiveBadge } from "@/components/ui/live-badge";
import { QRBlock } from "@/components/ui/qr-block";
import { publicChannel } from "@/lib/realtime/events";
import { useRealtimeChannel } from "@/lib/realtime/client";
import type { DisplayStateDto } from "@/app/api/display/_lib/state";
import { countdown, inFinalStretch } from "@/components/guest/use-auction";
import { formatEurosDisplay } from "@/components/ui/price-tag";
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

export function DisplayScreen({ sessionId, token, initial }: DisplayScreenProps) {
  const t = useTranslations("display");
  const tc = useTranslations("common");
  const [state, setState] = useState<DisplayStateDto>(initial);
  // Auction countdowns run on the server clock (offset), ticking each second.
  const [offsetMs, setOffsetMs] = useState(0);
  const [clockNow, setClockNow] = useState(() => Date.parse(initial.serverNow));
  useEffect(() => {
    const id = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const serverNow = clockNow + offsetMs;
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
      setOffsetMs(Date.parse(dto.serverNow) - Date.now());
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

  const auction = state.auction;
  const ranking = auction?.ranking ?? [];
  const showAmounts = auction?.rules.showAmountOnScreen ?? false;
  const money = (cents: number) => (showAmounts ? formatEurosDisplay(cents) : null);
  const open = auction?.open[0] ?? null;
  const upNext = auction?.upNext ?? null;

  // Ranking page rotation (crossfaded panels).
  const topPages = Math.max(1, Math.ceil(ranking.length / TOP_PAGE_SIZE));
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
  const topSlice = ranking.slice(
    (topPage % topPages) * TOP_PAGE_SIZE,
    (topPage % topPages) * TOP_PAGE_SIZE + TOP_PAGE_SIZE,
  );

  const { now, session } = state;

  return (
    <main
      className={[
        "fixed inset-0 isolate grid overflow-hidden bg-bg-base text-text-primary",
        "gap-[4vmin] p-[5vmin]",
        "landscape:grid-cols-[minmax(0,1fr)_auto] landscape:items-center",
        "portrait:grid-rows-[minmax(0,1fr)_auto] portrait:justify-items-stretch",
      ].join(" ")}
    >
      <div aria-hidden className="ambient absolute inset-0 -z-10" />
      {open && inFinalStretch(open.closesAt, serverNow) ? <div aria-hidden className="auction-flash-frame" /> : null}

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
              {now ? <Disc bpm={now.bpm} className="size-[15vmin] shrink-0" /> : null}
              <div className="min-w-0">
                <p
                  className="label text-accent-400"
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
                      <span className="text-accent-400"> · {now.handle}</span>
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

        {/* Leilão aberto: the countdown is the show (ember in the last minute) */}
        {session.live && auction ? (
          <Crossfade contentKey={open ? `open-${open.id}` : "no-auction"}>
            <div className="min-w-0 border-t border-line-subtle pt-[2.5vmin]">
              <p className="label text-accent-400" style={{ fontSize: "clamp(0.875rem, 2vmin, 1.25rem)" }}>
                {open ? t("auction.open") : t("auction.nextTitle")}
              </p>
              {open ? (
                <div className="flex items-baseline gap-[3vmin]">
                  <span
                    className={
                      inFinalStretch(open.closesAt, serverNow)
                        ? "tnum shrink-0 auction-flash-text"
                        : Date.parse(open.closesAt) - serverNow <= auction.rules.lastMinuteWarningSec * 1000
                          ? "tnum shrink-0 text-ember-500"
                          : "tnum shrink-0 text-text-primary"
                    }
                    style={{ ...displayFont, fontSize: "clamp(2.5rem, 9vmin, var(--text-80))", fontWeight: 800 }}
                  >
                    {countdown(open.closesAt, serverNow)}
                  </span>
                  <p className="min-w-0 truncate" style={{ fontSize: "clamp(1.25rem, 3.4vmin, var(--text-40))", fontWeight: 700 }}>
                    {open.top ? (
                      <>
                        {open.top.trackTitle}
                        {open.top.label ? <span className="text-accent-400"> · {open.top.label}</span> : null}
                        {money(open.top.totalCents) ? (
                          <span className="tnum text-accent-400"> · {money(open.top.totalCents)}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-text-secondary">
                        {t("auction.noBids", { amount: formatEurosDisplay(open.minPriceCents) })}
                      </span>
                    )}
                  </p>
                </div>
              ) : auction.next ? (
                <p className="tnum" style={{ ...displayFont, fontSize: "clamp(2rem, 7vmin, var(--text-80))", fontWeight: 800 }}>
                  {countdown(auction.next.opensAt, serverNow)}
                </p>
              ) : null}
            </div>
          </Crossfade>
        ) : null}

        {/* A seguir: the winner waiting for the DJ */}
        {session.live ? (
          <Crossfade contentKey={upNext ? upNext.slotId : "none"}>
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
                {upNext ? (
                  <>
                    {upNext.trackTitle}
                    <span className="text-text-secondary"> - {upNext.trackArtist}</span>
                    {upNext.label ? <span className="text-accent-400"> · {upNext.label}</span> : null}
                    {money(upNext.totalCents) ? (
                      <span className="tnum text-accent-400"> · {money(upNext.totalCents)}</span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-text-secondary">{t("nextEmpty")}</span>
                )}
              </p>
            </div>
          </Crossfade>
        ) : null}

        {/* Quem mais gastou: @ or table, amounts per the club setting */}
        {ranking.length > 0 ? (
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
                    key={`${entry.label ?? "anon"}-${i}`}
                    className="flex items-baseline gap-[1.6vmin]"
                    style={{ fontSize: "clamp(1.25rem, 3vmin, var(--text-32))" }}
                  >
                    <span
                      className="tnum text-accent-400"
                      style={{ ...displayFont, fontWeight: 700 }}
                    >
                      {(topPage % topPages) * TOP_PAGE_SIZE + i + 1}
                    </span>
                    <span className="truncate font-semibold">{entry.label ?? t("auction.anonymous")}</span>
                    {money(entry.spentCents) ? (
                      <span className="tnum ml-auto shrink-0 text-text-secondary">{money(entry.spentCents)}</span>
                    ) : null}
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

      {/* Subtle lockup (static: only the crossfade moves on this screen) */}
      <span
        className="pointer-events-none absolute bottom-[2vmin] right-[2.5vmin] opacity-70"
        aria-hidden="true"
      >
        <BrandLockup name={tc("appName")} size="sm" />
      </span>
    </main>
  );
}
