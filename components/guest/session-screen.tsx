"use client";

/**
 * Session screen (B6 screen 1): venue + DJ, now playing with Beat Pulse,
 * tonight's slot auctions (AuctionLive: open auction, "A seguir", wallet)
 * and the "Licitar" CTA. Realtime on the PUBLIC channel with a 15 s
 * polling fallback.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, ReceiptText } from "lucide-react";
import { LiveBadge } from "@/components/ui/live-badge";
import { NowPlaying } from "@/components/ui/now-playing";
import { Button } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { publicChannel } from "@/lib/realtime/events";
import { useRealtimeChannel } from "@/lib/realtime/client";
import { apiFetch } from "./api";
import { AuctionLive } from "./auction-screens";
import { LocaleToggle } from "./locale-toggle";
import { DockCta, PartyHeading, PartyTopBar } from "./party-chrome";
import type { SessionInfo, SessionStateDto } from "./types";

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

  const now = state.nowPlaying;
  const live = state.session.status === "live";
  const canRequest = live && state.session.requestsOpen;

  return (
    <main className="flex min-h-dvh flex-col gap-7 px-4 pb-[calc(var(--dock-h)+6rem)] pt-4">
      <PartyTopBar />
      <div className="flex items-center justify-between gap-3">
        {live ? <LiveBadge text={tc("status.live")} bpm={now?.bpm ?? 120} /> : <span />}
        <LocaleToggle />
      </div>
      <PartyHeading
        eyebrow={info.sessionName}
        title={info.venueName}
        sub={
          state.session.djName ? (
            <span className="font-medium text-text-primary">
              {t("session.withDj", { dj: state.session.djName })}
            </span>
          ) : undefined
        }
      />

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

      {live ? <AuctionLive token={token} sessionId={info.sessionId} /> : null}

      {/* Queue and top live in the tab bar; history stays one tap away. */}
      <Pressable
        onPress={() => router.push(`/s/${token}/requests`)}
        className="flex min-h-14 w-full items-center gap-4 rounded-card border border-line-subtle bg-surface-1 px-4 text-left data-pressed:bg-surface-2"
      >
        <ReceiptText size={20} strokeWidth={1.75} className="text-accent-400" aria-hidden />
        <span className="flex-1 text-[1.0625rem] text-text-primary">{t("auction.myBidsLink")}</span>
        <ChevronRight size={20} strokeWidth={1.75} className="text-text-tertiary" aria-hidden />
      </Pressable>

      <p className="text-center text-base font-medium text-text-secondary">
        {t("session.guarantee")}
      </p>

      <DockCta>
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
            {t("auction.dockCta")}
          </Button>
        )}
      </DockCta>
    </main>
  );
}
