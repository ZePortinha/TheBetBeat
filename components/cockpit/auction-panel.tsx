"use client";

/**
 * Slot auctions in the DJ cockpit (2026-10-05, replaces the tier queue):
 *  - AuctionNext (left): the locked winner with its 10-minute play target,
 *    Aceitar / Recusar e reabrir / Pôr a tocar / Tocou, the mic alert
 *    (≥ 150 €, name + track, "Anunciado") and the special moment (≥ 300 €).
 *  - AuctionBoard (right): open auctions live, tonight's schedule with
 *    pause / resume / cancel, and "Abrir leilão agora".
 * Staff channel realtime + 2 s polling; countdowns on the server clock.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { Gavel, Mic, Sparkles, Trophy } from "lucide-react";
import type { PublicAuctionState } from "@/lib/auction/service";
import { staffChannel } from "@/lib/realtime/events";
import { useRealtimeChannel } from "@/lib/realtime/client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cx } from "@/components/ui/pressable";
import { TickingCountdown } from "@/components/ui/ticking-countdown";
import { toast } from "@/components/ui/toast";
import { countdown } from "@/components/guest/use-auction";
import { formatEurosDisplay } from "./format";
import { playTierAlert } from "./sounds";

type SlotAction = "accept" | "reject" | "playing" | "played" | "pause" | "resume" | "cancel" | "announced";

export interface CockpitSlot {
  id: string;
  kind: "regular" | "first_peak" | "last_song";
  phase: string;
  opensAt: string;
  closesAt: string;
  status: "scheduled" | "open" | "paused" | "cancelled" | "closed";
  outcome: "won" | "no_winner" | null;
  playStatus: "locked" | "accepted" | "playing" | "played" | "refunded" | null;
  minPriceCents: number;
  hasBids: boolean;
  recognition: string | null;
  announce: boolean;
  announced: boolean;
  closedAt: string | null;
  winner: {
    trackTitle: string;
    trackArtist: string;
    label: string | null;
    totalCents: number;
    bpm: number | null;
    /** Transition out of what was playing when the bid was made. */
    transition: "easy" | "medium" | "hard" | "unknown" | null;
  } | null;
}

type CockpitAuctionState = PublicAuctionState & { slots: CockpitSlot[] };

export function useCockpitAuction(sessionId: string | null) {
  const t = useTranslations("cockpit.auction");
  const [state, setState] = React.useState<CockpitAuctionState | null>(null);
  const [offsetMs, setOffsetMs] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const [busy, setBusy] = React.useState<string | null>(null);
  // null until the first load, so opening the cockpit never beeps.
  const seenLocked = React.useRef<Set<string> | null>(null);

  const refetch = React.useCallback(async () => {
    if (!sessionId) return;
    const res = await fetch(`/api/cockpit/auction?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as CockpitAuctionState;
    setOffsetMs(Date.parse(data.serverNow) - Date.now());
    setState(data);
    // A new winner waiting for the DJ: sound (or flash in silent mode).
    const locked = data.slots.filter((s) => s.playStatus === "locked").map((s) => s.id);
    if (seenLocked.current && locked.some((id) => !seenLocked.current!.has(id))) playTierAlert("NEXT");
    seenLocked.current = new Set(locked);
  }, [sessionId]);

  React.useEffect(() => {
    void refetch();
    const poll = setInterval(() => void refetch(), 2000);
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refetch]);
  useRealtimeChannel(sessionId ? staffChannel(sessionId) : null, { private: true }, (envelope) => {
    if (envelope.event === "auction.updated") void refetch();
  });

  const post = async (url: string, body: unknown, key: string) => {
    setBusy(key);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null);
    if (!res.ok) toast({ title: t("error"), variant: "error" });
    void refetch();
  };

  return {
    state,
    serverNow: now + offsetMs,
    busy,
    act: (slotId: string, action: SlotAction) => post(`/api/cockpit/auction/${slotId}`, { action }, `${slotId}:${action}`),
    openNow: () => post("/api/cockpit/auction", { sessionId }, "open-now"),
  };
}

type CockpitAuction = ReturnType<typeof useCockpitAuction>;

function clock(iso: string): string {
  return new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" }).format(
    new Date(iso),
  );
}

/** Left column: the winner waiting for the DJ (and the mic / special alerts). */
export function AuctionNext({ a }: { a: CockpitAuction }) {
  const t = useTranslations("cockpit.auction");
  const slot = a.state?.slots.find((s) => s.playStatus === "locked" || s.playStatus === "accepted" || s.playStatus === "playing");
  const w = slot?.winner;
  if (!slot || !w) {
    return (
      <p className="rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-tertiary">
        {t("upNextEmpty")}
      </p>
    );
  }
  const playBy = a.state?.upNext?.slotId === slot.id ? a.state.upNext.playBy : null;
  const late = playBy !== null && Date.parse(playBy) <= a.serverNow;
  const busy = (action: SlotAction) => a.busy === `${slot.id}:${action}`;

  return (
    <div className="flex flex-col gap-3">
      {slot.announce && !slot.announced ? (
        <div role="alert" className="rounded-card border border-accent-500 bg-surface-2 p-4">
          <p className="label flex items-center gap-1.5 text-accent-400">
            <Mic size={14} aria-hidden />
            {t("micTitle")}
          </p>
          <p className="mt-2 text-lg font-bold text-text-primary">
            {t("micBody", { label: w.label ?? t("anonymous"), amount: formatEurosDisplay(w.totalCents), track: w.trackTitle })}
          </p>
          <Button className="mt-3" variant="secondary" loading={busy("announced")} onPress={() => void a.act(slot.id, "announced")}>
            {t("announced")}
          </Button>
        </div>
      ) : null}
      {slot.recognition === "special_moment" ? (
        <p className="flex items-center gap-2 rounded-card bg-accent-500 px-4 py-3 text-sm font-semibold text-text-on-accent">
          <Sparkles size={16} aria-hidden />
          {t("special")}
        </p>
      ) : null}

      <div className="rounded-card border border-accent-500/60 bg-surface-1 p-4">
        <p className="label text-text-tertiary">{slot.playStatus === "playing" ? t("nowPlayingWinner") : t("upNextTitle")}</p>
        <p className="mt-2 truncate text-xl font-bold text-text-primary">{w.trackTitle}</p>
        <p className="truncate text-base text-text-secondary">{w.trackArtist}</p>
        {w.bpm !== null || w.transition ? (
          <p className="tnum mt-1 text-sm text-text-secondary">
            {w.bpm !== null ? `${Math.round(w.bpm)} BPM` : ""}
            {w.bpm !== null && w.transition ? " · " : ""}
            {w.transition ? t(`transition.${w.transition}`) : ""}
          </p>
        ) : null}
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <span className="truncate text-sm text-text-secondary">{w.label ?? t("anonymous")}</span>
          <span className="tnum text-2xl font-bold text-accent-400">{formatEurosDisplay(w.totalCents)}</span>
        </div>
        {playBy && slot.playStatus !== "playing" ? (
          <p className={cx("tnum mt-3 text-sm font-semibold", late ? "text-ember-500" : "text-text-primary")}>
            {late ? t("late") : t("playIn", { time: countdown(playBy, a.serverNow) })}
          </p>
        ) : null}
      </div>

      {slot.playStatus === "playing" ? (
        <Button size="lg" fullWidth loading={busy("played")} onPress={() => void a.act(slot.id, "played")}>
          {t("played")}
        </Button>
      ) : (
        <div className="flex gap-2">
          {slot.playStatus === "locked" ? (
            <Button size="lg" variant="secondary" className="flex-1" loading={busy("accept")} onPress={() => void a.act(slot.id, "accept")}>
              {t("accept")}
            </Button>
          ) : null}
          <Button size="lg" className="flex-1" loading={busy("playing")} onPress={() => void a.act(slot.id, "playing")}>
            {t("playing")}
          </Button>
        </div>
      )}
      {slot.playStatus !== "playing" ? (
        <Button variant="ghost" className="text-ember-500" loading={busy("reject")} onPress={() => void a.act(slot.id, "reject")}>
          {t("reject")}
        </Button>
      ) : null}
    </div>
  );
}

/** Right side: open auctions, the night's schedule and "Abrir leilão agora". */
export function AuctionBoard({ a }: { a: CockpitAuction }) {
  const t = useTranslations("cockpit.auction");
  const state = a.state;
  if (!state) return null;
  const upcoming = state.slots.filter((s) => s.status === "scheduled" || s.status === "paused").slice(0, 8);
  const winners = state.slots.filter((s) => s.playStatus === "played").reverse().slice(0, 5);
  const kind = (k: CockpitSlot["kind"]) => (k === "regular" ? null : t(`kinds.${k}`));

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-text-secondary">{t("openTitle")}</h2>
          <Button size="md" variant="secondary" loading={a.busy === "open-now"} onPress={() => void a.openNow()}>
            <Gavel size={16} aria-hidden />
            {t("openNow")}
          </Button>
        </div>
        {state.open.length === 0 ? (
          <EmptyState icon={Gavel} title={t("noneOpen")} hint={state.next ? t("nextAt", { time: clock(state.next.opensAt) }) : t("scheduleEmpty")} />
        ) : (
          state.open.map((s) => {
            const lastMinute = Date.parse(s.closesAt) - a.serverNow <= state.rules.lastMinuteWarningSec * 1000;
            return (
              <article key={s.id} className="rounded-card border border-line-subtle bg-surface-1 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="label text-text-tertiary">{kind(s.kind) ?? t("closesAt", { time: clock(s.closesAt) })}</span>
                  <TickingCountdown
                    value={countdown(s.closesAt, a.serverNow)}
                    className={cx("text-3xl font-bold", lastMinute ? "text-ember-500" : "text-text-primary")}
                  />
                </div>
                {s.top ? (
                  <div className="mt-3 flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold text-text-primary">{s.top.trackTitle}</p>
                      <p className="truncate text-sm text-text-secondary">
                        {s.top.trackArtist} · {t("bids", { count: s.bids })}
                      </p>
                    </div>
                    <TickingCountdown
                      timer={false}
                      value={formatEurosDisplay(s.top.totalCents)}
                      className="shrink-0 text-2xl font-bold text-accent-400"
                    />
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-text-secondary">{t("noBids", { amount: formatEurosDisplay(s.minPriceCents) })}</p>
                )}
                {!s.top ? (
                  <div className="mt-3 flex gap-2">
                    <Button variant="secondary" loading={a.busy === `${s.id}:pause`} onPress={() => void a.act(s.id, "pause")}>
                      {t("pause")}
                    </Button>
                    <Button variant="ghost" className="text-ember-500" loading={a.busy === `${s.id}:cancel`} onPress={() => void a.act(s.id, "cancel")}>
                      {t("cancel")}
                    </Button>
                  </div>
                ) : null}
              </article>
            );
          })
        )}

        {winners.length > 0 ? (
          <>
            <h2 className="mt-2 flex items-center gap-1.5 text-base font-bold text-text-secondary">
              <Trophy size={16} aria-hidden />
              {t("winners")}
            </h2>
            {winners.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-card bg-surface-1 px-4 py-2">
                <span className="truncate text-sm text-text-primary">
                  {s.winner?.trackTitle} · {s.winner?.label ?? t("anonymous")}
                </span>
                <span className="tnum shrink-0 text-sm font-semibold text-accent-400">
                  {formatEurosDisplay(s.winner?.totalCents ?? 0)}
                </span>
              </div>
            ))}
          </>
        ) : null}
      </div>

      <div className="flex w-[42%] min-w-0 flex-col gap-3 overflow-y-auto pb-2">
        <h2 className="text-base font-bold text-text-secondary">{t("schedule")}</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-text-tertiary">{t("scheduleEmpty")}</p>
        ) : (
          upcoming.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-card border border-line-subtle bg-surface-1 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="tnum text-base font-semibold text-text-primary">
                  {clock(s.closesAt)}
                  {kind(s.kind) ? <span className="ml-2 text-xs text-accent-400">{kind(s.kind)}</span> : null}
                </p>
                <p className="tnum text-xs text-text-tertiary">
                  {s.status === "paused" ? t("paused") : t("minPrice", { amount: formatEurosDisplay(s.minPriceCents) })}
                </p>
              </div>
              {s.status === "paused" ? (
                <Button size="md" variant="secondary" loading={a.busy === `${s.id}:resume`} onPress={() => void a.act(s.id, "resume")}>
                  {t("resume")}
                </Button>
              ) : (
                <Button size="md" variant="ghost" loading={a.busy === `${s.id}:pause`} onPress={() => void a.act(s.id, "pause")}>
                  {t("pause")}
                </Button>
              )}
              <Button size="md" variant="ghost" className="text-ember-500" loading={a.busy === `${s.id}:cancel`} onPress={() => void a.act(s.id, "cancel")}>
                {t("cancel")}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
