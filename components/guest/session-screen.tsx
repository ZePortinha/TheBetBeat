"use client";

/**
 * Session screen (B6 screen 1): venue + DJ, now playing with Beat Pulse,
 * the guest's active requests strip, the "Pedir música" CTA and links to
 * the public screens. Realtime on the PUBLIC channel with a 15 s polling
 * fallback; own requests update via the private guest channel.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, ListMusic, Trophy, ReceiptText } from "lucide-react";
import { LiveBadge } from "@/components/ui/live-badge";
import { NowPlaying } from "@/components/ui/now-playing";
import { Button } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEurosDisplay } from "@/components/ui/price-tag";
import { guestChannel, publicChannel } from "@/lib/realtime/events";
import { useRealtimeChannel } from "@/lib/realtime/client";
import { apiFetch } from "./api";
import { useGuest } from "./guest-providers";
import { LocaleToggle } from "./locale-toggle";
import {
  ACTIVE_REQUEST_STATUSES,
  type GuestRequestListItem,
  type SessionInfo,
  type SessionStateDto,
} from "./types";

const POLL_MS = 15_000;

export function SessionScreen({
  token,
  info,
  initialState,
}: {
  token: string;
  info: SessionInfo;
  initialState: SessionStateDto;
}) {
  const t = useTranslations("guest");
  const tc = useTranslations("common");
  const router = useRouter();
  const { guestId, ready } = useGuest();

  const [state, setState] = React.useState<SessionStateDto>(initialState);
  const [mine, setMine] = React.useState<GuestRequestListItem[] | null>(null);

  const refetchState = React.useCallback(async () => {
    const res = await apiFetch<SessionStateDto>(
      `/api/guest/session-state?token=${encodeURIComponent(token)}`,
    );
    if (res.ok) setState(res.data);
  }, [token]);

  const refetchMine = React.useCallback(async () => {
    if (!ready) return;
    const res = await apiFetch<{ requests: GuestRequestListItem[] }>(
      "/api/guest/requests",
    );
    if (res.ok) {
      setMine(
        res.data.requests.filter(
          (r) =>
            r.sessionId === info.sessionId &&
            ACTIVE_REQUEST_STATUSES.includes(r.status),
        ),
      );
    }
  }, [ready, info.sessionId]);

  // Polling fallback (B6): realtime is a hint, polling is the floor.
  React.useEffect(() => {
    const id = setInterval(() => void refetchState(), POLL_MS);
    return () => clearInterval(id);
  }, [refetchState]);

  React.useEffect(() => {
    void refetchMine();
  }, [refetchMine]);

  useRealtimeChannel(publicChannel(info.sessionId), { private: false }, () => {
    void refetchState();
  });
  useRealtimeChannel(ready && guestId ? guestChannel(guestId) : null, { private: true }, () => {
    void refetchMine();
  });

  const now = state.nowPlaying;
  const live = state.session.status === "live";
  const canRequest = live && state.session.requestsOpen;

  const statusLabel = (r: GuestRequestListItem): string => {
    if (r.status === "accepted") return t("status.queued");
    return t(`status.${r.status}`);
  };

  return (
    <main className="flex min-h-dvh flex-col gap-6 px-4 pb-36 pt-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1
            className="truncate text-2xl font-bold text-text-primary"
            style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.01em" }}
          >
            {info.venueName}
          </h1>
          <p className="mt-1 truncate text-sm text-text-secondary">
            {info.sessionName}
            {state.session.djName
              ? ` · ${t("session.withDj", { dj: state.session.djName })}`
              : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {live ? <LiveBadge text={tc("status.live")} bpm={now?.bpm ?? 120} /> : null}
          <LocaleToggle />
        </div>
      </header>

      {/* Now playing */}
      <section aria-label={t("session.nowPlaying")}>
        <p className="label mb-2 text-text-tertiary">{t("session.nowPlaying")}</p>
        {now ? (
          <NowPlaying
            title={now.title}
            artist={now.artist}
            bpm={live ? now.bpm : null}
            startedAt={Date.parse(now.startedAt)}
            durationSec={now.durationSec ?? 0}
          />
        ) : (
          <div className="rounded-card border border-line-subtle bg-surface-1 px-4 py-6 text-center text-sm text-text-secondary">
            {t("session.nothingPlaying")}
          </div>
        )}
      </section>

      {/* Own active requests strip */}
      {mine === null && ready ? (
        <Skeleton height={56} rounded="card" />
      ) : mine && mine.length > 0 ? (
        <section aria-label={t("session.yourRequests")} className="flex flex-col gap-2">
          <p className="label text-text-tertiary">{t("session.yourRequests")}</p>
          {mine.map((r) => (
            <Pressable
              key={r.requestId}
              onPress={() => router.push(`/s/${token}/requests/${r.requestId}`)}
              className="flex w-full items-center gap-3 rounded-card border border-line-subtle bg-surface-1 px-4 py-3 text-left"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-text-primary">
                  {r.trackTitle}
                </p>
                <p className="truncate text-sm text-text-secondary">
                  {statusLabel(r)} · {formatEurosDisplay(r.amountCents)}
                </p>
              </div>
              <ChevronRight size={20} strokeWidth={1.75} className="shrink-0 text-text-tertiary" aria-hidden />
            </Pressable>
          ))}
        </section>
      ) : null}

      {/* Public links */}
      <nav className="flex flex-col gap-2" aria-label={t("session.nowOnFloor")}>
        {[
          { href: `/s/${token}/queue`, icon: ListMusic, label: t("session.nowOnFloor") },
          { href: `/s/${token}/top`, icon: Trophy, label: t("session.topOfNight") },
          { href: `/s/${token}/requests`, icon: ReceiptText, label: t("session.myRequests") },
        ].map(({ href, icon: Icon, label }) => (
          <Pressable
            key={href}
            onPress={() => router.push(href)}
            className="flex w-full items-center gap-3 rounded-card border border-line-subtle bg-surface-1 px-4 py-3.5 text-left"
          >
            <Icon size={20} strokeWidth={1.75} className="text-gold-500" aria-hidden />
            <span className="flex-1 text-base font-medium text-text-primary">{label}</span>
            <ChevronRight size={20} strokeWidth={1.75} className="text-text-tertiary" aria-hidden />
          </Pressable>
        ))}
      </nav>

      <p className="text-center text-sm text-text-tertiary">{t("session.guarantee")}</p>

      {/* Fixed CTA (material, safe area — B10.4) */}
      <div className="material fixed inset-x-0 bottom-0 z-30">
        <div className="mx-auto w-full max-w-md px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3">
          {!live ? (
            <p className="py-3 text-center text-sm text-text-secondary">
              {state.session.status === "ended"
                ? t("session.sessionEnded")
                : t("session.requestsClosed")}
            </p>
          ) : !canRequest ? (
            <p className="py-3 text-center text-sm text-text-secondary">
              {t("session.requestsClosed")}
            </p>
          ) : (
            <Button
              fullWidth
              size="lg"
              onPress={() => router.push(`/s/${token}/search`)}
            >
              {t("session.requestCta")}
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
