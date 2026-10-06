"use client";

/**
 * "Fila ao vivo" (B6.7) and "Rankings" (B6.8), laid out after the
 * 2026-10-05 mockup in the Apple palette. Since the slot auctions the
 * queue is the live auction + "A seguir" + winners, and the ranking is
 * who spent the most (public amounts, @ or "Anónimo", never a name).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { NowPlaying } from "@/components/ui/now-playing";
import { Button } from "@/components/ui/button";
import { publicChannel } from "@/lib/realtime/events";
import { useRealtimeChannel } from "@/lib/realtime/client";
import { apiFetch } from "./api";
import { AuctionLive, RankingBySpend } from "./auction-screens";
import { DockCta, LiveDot, PartyHeading, PartyTopBar } from "./party-chrome";
import type { SessionStateDto } from "./types";

function useSessionState(token: string, sessionId: string, initial: SessionStateDto) {
  const [state, setState] = React.useState(initial);
  const refetch = React.useCallback(async () => {
    const res = await apiFetch<SessionStateDto>(
      `/api/guest/session-state?token=${encodeURIComponent(token)}`,
    );
    if (res.ok) setState(res.data);
  }, [token]);
  React.useEffect(() => {
    const id = setInterval(() => void refetch(), 15_000);
    return () => clearInterval(id);
  }, [refetch]);
  useRealtimeChannel(publicChannel(sessionId), { private: false }, () => void refetch());
  return state;
}

function RequestTrackCta({ token }: { token: string }) {
  const router = useRouter();
  const t = useTranslations("guest.queue");
  return (
    <DockCta>
      <Button fullWidth size="lg" onPress={() => router.push(`/s/${token}/search`)}>
        {t("cta")}
      </Button>
    </DockCta>
  );
}

export function QueueScreen({
  token,
  sessionId,
  initialState,
}: {
  token: string;
  sessionId: string;
  initialState: SessionStateDto;
}) {
  const t = useTranslations("guest.queue");
  const ts = useTranslations("guest.session");
  const tc = useTranslations("common");
  const state = useSessionState(token, sessionId, initialState);
  const live = state.session.status === "live";

  return (
    <main className="flex min-h-dvh flex-col gap-6 px-4 pb-[calc(var(--dock-h)+6rem)] pt-4">
      <PartyTopBar />
      <PartyHeading title={t("title")} />

      <section aria-label={t("now")}>
        <div className="flex items-center justify-between gap-3">
          <p className="label text-text-primary">{t("now")}</p>
          {live ? (
            <p className="label flex items-center gap-1.5 text-accent-400">
              <LiveDot />
              {tc("status.live")}
            </p>
          ) : null}
        </div>
        <div className="mt-3">
          {state.nowPlaying ? (
            <NowPlaying
              title={state.nowPlaying.title}
              artist={state.nowPlaying.artist}
              bpm={live ? state.nowPlaying.bpm : null}
              startedAt={Date.parse(state.nowPlaying.startedAt)}
              durationSec={state.nowPlaying.durationSec ?? 0}
            />
          ) : (
            <div className="rounded-card border border-line-subtle bg-surface-1 px-4 py-6 text-center text-sm text-text-secondary">
              {ts("nothingPlaying")}
            </div>
          )}
        </div>
      </section>

      {live ? <AuctionLive token={token} sessionId={sessionId} showWinners /> : null}

      <RequestTrackCta token={token} />
    </main>
  );
}

export function TopScreen({
  token,
  sessionId,
  initialState,
}: {
  token: string;
  sessionId: string;
  initialState: SessionStateDto;
}) {
  const t = useTranslations("guest.top");
  const state = useSessionState(token, sessionId, initialState);
  const dj = state.session.djName;

  return (
    <main className="flex min-h-dvh flex-col gap-6 px-4 pb-[calc(var(--dock-h)+6rem)] pt-4">
      <PartyTopBar />
      <PartyHeading
        eyebrow={
          <>
            <LiveDot />
            {dj ? t("eyebrowDj", { dj }) : t("eyebrow")}
          </>
        }
        title={t("title")}
        sub={state.session.venueName}
      />
      <RankingBySpend token={token} sessionId={sessionId} />
      <RequestTrackCta token={token} />
    </main>
  );
}
