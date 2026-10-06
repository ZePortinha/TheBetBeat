"use client";

/**
 * Home, "Agora" (2026-10-06): the track playing now as the hero (album
 * art as the background, who picked it under the title), the live
 * auction one tap from bidding, "A seguir" and the last 3 winners.
 * Realtime on the PUBLIC channel with a 15 s polling fallback.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, Gavel, Disc3, ReceiptText } from "lucide-react";
import { Disc } from "@/components/ui/disc";
import { LiveBadge } from "@/components/ui/live-badge";
import { TrackProgress } from "@/components/ui/now-playing";
import { Pressable } from "@/components/ui/pressable";
import { publicChannel } from "@/lib/realtime/events";
import { useRealtimeChannel } from "@/lib/realtime/client";
import { apiFetch } from "./api";
import { AuctionTeaser, NightWinners } from "./auction-screens";
import { LocaleToggle } from "./locale-toggle";
import { PartyTopBar } from "./party-chrome";
import type { NowPlayingDto, SessionInfo, SessionStateDto } from "./types";

const POLL_MS = 15_000;

/** Deezer serves any square size: ask for a big one for the background. */
function largeCover(url: string): string {
  return url.replace(/\/\d+x\d+-/, "/1000x1000-");
}

function NowPlayingHero({ now, live, djName }: { now: NowPlayingDto | null; live: boolean; djName: string | null }) {
  const t = useTranslations("guest");
  const tc = useTranslations("common");
  const titleId = React.useId();
  const pickedBy = now?.pickedBy;

  return (
    <section aria-labelledby={titleId} className="relative isolate overflow-hidden rounded-sheet bg-surface-1">
      {now?.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- catalog covers come from the provider's CDN
        <img src={largeCover(now.coverUrl)} alt="" className="absolute inset-0 -z-20 size-full object-cover" />
      ) : (
        <div aria-hidden className="absolute inset-0 -z-20 flex items-start justify-center pt-8">
          <div className="ambient-center absolute inset-0 opacity-80" />
          <Disc seed={now?.title ?? "betbeat"} bpm={live ? now?.bpm : null} className="relative size-48" />
        </div>
      )}
      {/* Legibility: the art fades into the page behind the text. */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-linear-to-t from-bg-base via-bg-base/75 to-bg-base/0" />

      <div className="flex min-h-[25rem] flex-col justify-between p-5">
        <div className="flex items-center justify-between gap-3">
          {live ? <LiveBadge text={tc("status.live")} bpm={now?.bpm ?? 120} /> : <span />}
          <p className="label rounded-full bg-bg-base/60 px-2.5 py-1 text-text-secondary backdrop-blur">
            {t("session.nowPlaying")}
          </p>
        </div>

        {now ? (
          <div>
            <h1
              id={titleId}
              className="line-clamp-2 text-[clamp(2rem,9vw,2.75rem)] font-bold leading-[1.02] tracking-[var(--tracking-display)] text-text-primary"
            >
              {now.title}
            </h1>
            <p className="mt-1.5 truncate text-lg text-text-secondary">{now.artist}</p>
            <p className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full bg-bg-base/60 px-3 py-1.5 text-sm font-semibold text-text-primary ring-1 ring-line-strong backdrop-blur">
              {pickedBy ? (
                <Gavel size={14} className="shrink-0 text-accent-400" aria-hidden />
              ) : (
                <Disc3 size={14} className="shrink-0 text-accent-400" aria-hidden />
              )}
              <span className="truncate">
                {pickedBy
                  ? pickedBy.label
                    ? t("auction.pickedBy", { label: pickedBy.label })
                    : t("auction.pickedAnon")
                  : djName
                    ? t("auction.djPickName", { dj: djName })
                    : t("auction.djPick")}
              </span>
            </p>
            {now.durationSec ? (
              <TrackProgress
                className="mt-5"
                startedAt={Date.parse(now.startedAt)}
                durationSec={now.durationSec}
                labelledBy={titleId}
              />
            ) : null}
          </div>
        ) : (
          <h1 id={titleId} className="text-[clamp(1.75rem,8vw,2.25rem)] font-bold leading-[1.05] text-text-primary">
            {t("session.nothingPlaying")}
          </h1>
        )}
      </div>
    </section>
  );
}

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
  const router = useRouter();
  const [state, setState] = React.useState<SessionStateDto>(initialState);

  const refetchState = React.useCallback(async () => {
    const res = await apiFetch<SessionStateDto>(
      `/api/guest/session-state?token=${encodeURIComponent(token)}`,
    );
    if (res.ok) setState(res.data);
  }, [token]);

  // Polling fallback (B6): realtime is a hint, polling is the floor.
  React.useEffect(() => {
    const id = setInterval(() => void refetchState(), POLL_MS);
    return () => clearInterval(id);
  }, [refetchState]);

  useRealtimeChannel(publicChannel(info.sessionId), { private: false }, () => {
    void refetchState();
  });

  const live = state.session.status === "live";
  const dj = state.session.djName;

  return (
    <main className="flex min-h-dvh flex-col gap-5 px-4 pb-[calc(var(--dock-h)+3rem)] pt-4">
      <PartyTopBar />
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm text-text-secondary">
          {info.sessionName}
          {dj ? <span className="text-text-primary"> · {t("session.withDj", { dj })}</span> : null}
        </p>
        <LocaleToggle />
      </div>

      <NowPlayingHero now={state.nowPlaying} live={live} djName={dj} />

      {live ? (
        <>
          <AuctionTeaser token={token} />
          <NightWinners />
        </>
      ) : (
        <p className="rounded-card border border-line-subtle bg-surface-1 px-4 py-4 text-center text-sm text-text-secondary">
          {state.session.status === "ended" ? t("session.sessionEnded") : t("session.requestsClosed")}
        </p>
      )}

      {/* History, receipts and refunds stay one tap away. */}
      <Pressable
        onPress={() => router.push(`/s/${token}/requests`)}
        className="flex min-h-14 w-full items-center gap-4 rounded-card border border-line-subtle bg-surface-1 px-4 text-left data-pressed:bg-surface-2"
      >
        <ReceiptText size={20} strokeWidth={1.75} className="text-accent-400" aria-hidden />
        <span className="flex-1 text-[1.0625rem] text-text-primary">{t("auction.myBidsLink")}</span>
        <ChevronRight size={20} strokeWidth={1.75} className="text-text-tertiary" aria-hidden />
      </Pressable>

      <p className="text-center text-sm font-medium text-text-secondary">{t("session.guarantee")}</p>
    </main>
  );
}
