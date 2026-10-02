"use client";

/**
 * "Agora na pista" (B6.7) and "Top da noite" (B6.8): small public screens
 * off the session screen. Public data only; amounts are never shown;
 * handles appear only with ranking opt-in.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { ListMusic, Trophy } from "lucide-react";
import { NowPlaying } from "@/components/ui/now-playing";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Chip } from "@/components/ui/fit-chip";
import { Button } from "@/components/ui/button";
import { publicChannel } from "@/lib/realtime/events";
import { useRealtimeChannel } from "@/lib/realtime/client";
import { apiFetch } from "./api";
import { useGuest } from "./guest-providers";
import { BackHeader } from "./back-header";
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
  const tTiers = useTranslations("common.tiers");
  const state = useSessionState(token, sessionId, initialState);

  return (
    <main className="flex min-h-dvh flex-col gap-5 px-4 pb-10 pt-6">
      <BackHeader title={t("title")} backHref={`/s/${token}`} />
      {state.nowPlaying ? (
        <NowPlaying
          title={state.nowPlaying.title}
          artist={state.nowPlaying.artist}
          bpm={state.session.status === "live" ? state.nowPlaying.bpm : null}
          startedAt={Date.parse(state.nowPlaying.startedAt)}
          durationSec={state.nowPlaying.durationSec ?? 0}
        />
      ) : (
        <div className="rounded-card border border-line-subtle bg-surface-1 px-4 py-6 text-center text-sm text-text-secondary">
          {ts("nothingPlaying")}
        </div>
      )}
      <section className="flex flex-col gap-2" aria-label={t("upNext")}>
        <p className="label text-text-tertiary">{t("upNext")}</p>
        {state.upNext.length === 0 ? (
          <EmptyState icon={ListMusic} title={t("empty")} hint={t("emptyHint")} />
        ) : (
          state.upNext.map((item, i) => (
            <div
              key={`${item.title}-${i}`}
              className="flex items-center gap-3 rounded-card border border-line-subtle bg-surface-1 px-4 py-3"
            >
              <span className="tnum w-5 shrink-0 text-sm text-text-tertiary">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-text-primary">{item.title}</p>
                <p className="truncate text-sm text-text-secondary">{item.artist}</p>
              </div>
              <Chip>{tTiers(item.tier)}</Chip>
            </div>
          ))
        )}
      </section>
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
  const { ready } = useGuest();

  const [handle, setHandle] = React.useState("");
  const [joined, setJoined] = React.useState<string | null>(null);
  const [joining, setJoining] = React.useState(false);

  async function join() {
    const clean = handle.trim().toLowerCase().replace(/^@/, "");
    if (clean.length < 2) return;
    setJoining(true);
    const res = await apiFetch("/api/guest/profile", {
      method: "POST",
      body: JSON.stringify({ handle: clean, rankingOptin: true }),
    });
    setJoining(false);
    if (res.ok) setJoined(clean);
  }

  const hasData = state.top.tracks.length > 0 || state.top.guests.length > 0;

  return (
    <main className="flex min-h-dvh flex-col gap-5 px-4 pb-10 pt-6">
      <BackHeader title={t("title")} backHref={`/s/${token}`} />

      {!hasData ? (
        <EmptyState icon={Trophy} title={t("empty")} hint={t("emptyHint")} />
      ) : (
        <>
          {state.top.tracks.length > 0 ? (
            <section className="flex flex-col gap-2">
              <p className="label text-text-tertiary">{t("topTracks")}</p>
              {state.top.tracks.map((track, i) => (
                <div
                  key={`${track.title}-${i}`}
                  className="flex items-center gap-3 rounded-card border border-line-subtle bg-surface-1 px-4 py-3"
                >
                  <span className="tnum w-5 shrink-0 text-sm font-bold text-gold-500">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold text-text-primary">{track.title}</p>
                    <p className="truncate text-sm text-text-secondary">{track.artist}</p>
                  </div>
                  <span className="tnum shrink-0 text-sm text-text-tertiary">
                    {t("requestsCount", { count: track.count })}
                  </span>
                </div>
              ))}
            </section>
          ) : null}

          {state.top.guests.length > 0 ? (
            <section className="flex flex-col gap-2">
              <p className="label text-text-tertiary">{t("topGuests")}</p>
              {state.top.guests.map((guest, i) => (
                <div
                  key={guest.handle}
                  className="flex items-center gap-3 rounded-card border border-line-subtle bg-surface-1 px-4 py-3"
                >
                  <span className="tnum w-5 shrink-0 text-sm font-bold text-gold-500">{i + 1}</span>
                  <p className="min-w-0 flex-1 truncate text-base font-semibold text-text-primary">
                    @{guest.handle}
                  </p>
                  <span className="tnum shrink-0 text-sm text-text-tertiary">
                    {t("requestsCount", { count: guest.count })}
                  </span>
                </div>
              ))}
            </section>
          ) : null}
        </>
      )}

      {/* Opt-in (B6.8): the handle only ever appears with consent. */}
      <section className="rounded-card border border-line-subtle bg-surface-1 px-4 py-4">
        {joined ? (
          <p className="text-sm text-text-primary">{t("joined", { handle: joined })}</p>
        ) : (
          <>
            <p className="text-base font-semibold text-text-primary">{t("joinTitle")}</p>
            <p className="mt-1 text-sm text-text-secondary">{t("joinHint")}</p>
            <div className="mt-3 flex gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1 rounded-button border border-line-subtle bg-surface-3 px-3 py-2.5 focus-within:border-gold-500">
                <span className="text-base text-text-tertiary">@</span>
                <input
                  type="text"
                  value={handle}
                  maxLength={24}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder={t("handlePlaceholder")}
                  aria-label={t("joinTitle")}
                  className="w-full bg-transparent text-base text-text-primary outline-none placeholder:text-text-tertiary"
                />
              </div>
              <Button loading={joining} disabled={!ready || handle.trim().length < 2} onPress={() => void join()}>
                {t("join")}
              </Button>
            </div>
          </>
        )}
        <p className="mt-3 text-xs text-text-tertiary">{t("amountsHidden")}</p>
      </section>
    </main>
  );
}
