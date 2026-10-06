"use client";

/**
 * Slot auctions in the guest app (2026-10-06 layout, auction-first):
 *  - AuctionScreen (centre tab "Leilão"): pick the auction, then its
 *    options (bid with a track, raise, back the leader); next auctions.
 *  - AuctionTeaser + NightWinners on the home: the live auction one tap
 *    away, "A seguir" and the last 3 winners.
 *  - AuctionContextBar: which auction the guest is choosing a track for.
 *  - WalletPill: the balance, small, top right, only when there is one.
 *  - AuctionOverlays: last-30-s flash, buzz and the winner celebration on
 *    every tab.
 *  - BidScreen: a track from search → bid on the chosen auction.
 *  - RankingPodium: the top 3 on a podium, everyone else below, quieter.
 *  - MyBids: my bids tonight.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AudioWaveform, Crown, Gavel, Sparkles, Trophy, Wallet } from "lucide-react";
import type { PublicSlot, PublicWinner, UpcomingSlot } from "@/lib/auction/service";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Disc } from "@/components/ui/disc";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Pressable, cx } from "@/components/ui/pressable";
import { formatEurosDisplay } from "@/components/ui/price-tag";
import { apiFetch } from "./api";
import { BidForm, type BidTargetInput } from "./bid-form";
import { useGuest } from "./guest-providers";
import { PushPrompt } from "./push-prompt";
import { WinCelebration } from "./win-celebration";
import { clockTime, countdown, inFinalStretch, useAuction, type AuctionState } from "./use-auction";
import { assessTransition, startingPriceCents, type TransitionAssessment } from "@/lib/auction/transition";

type SheetState = { slot: PublicSlot; target: BidTargetInput; current: number; title: string } | null;

function SpecialChip() {
  const t = useTranslations("guest.auction");
  return (
    <span className="inline-flex items-center gap-1 rounded-chip bg-accent-500 px-2 py-1 text-xs font-semibold text-text-on-accent">
      <Sparkles size={12} aria-hidden />
      {t("special")}
    </span>
  );
}

/** "Leilão das 23:30" (or "Especial"): how an auction is named everywhere. */
function slotName(slot: { kind: string; opensAt: string }, t: (key: string, v?: Record<string, string>) => string, locale: string) {
  return slot.kind !== "regular" ? t("special") : t("slotAt", { time: clockTime(slot.opensAt, locale) });
}

/* ------------------------------------------------------------------ */
/* Leilão tab                                                          */
/* ------------------------------------------------------------------ */

/** The selected live auction: countdown, who leads, and what I can do. */
function AuctionCard({
  slot,
  state,
  serverNow,
  onSheet,
  onPickTrack,
}: {
  slot: PublicSlot;
  state: AuctionState;
  serverNow: number;
  onSheet: (s: NonNullable<SheetState>) => void;
  onPickTrack: () => void;
}) {
  const t = useTranslations("guest.auction");
  const locale = useLocale();
  const left = Date.parse(slot.closesAt) - serverNow;
  const lastMinute = left <= state.rules.lastMinuteWarningSec * 1000;
  const finalStretch = inFinalStretch(slot.closesAt, serverNow);
  const ended = left <= 0;
  const mine = state.me?.bids.find((b) => b.slotId === slot.id && b.owner);
  const leading = mine?.status === "leading";
  const top = slot.top;

  return (
    <article
      className={cx(
        "rounded-sheet border border-accent-500/40 bg-surface-1 p-5 shadow-glow-accent",
        finalStretch && "auction-flash-card",
      )}
      aria-label={t("openTitle")}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="label flex items-center gap-1.5 text-accent-400">
          <Gavel size={14} aria-hidden />
          {t("openTitle")}
        </p>
        {slot.kind !== "regular" ? <SpecialChip /> : null}
      </div>

      <p
        className={cx(
          "tnum mt-3 text-[clamp(3rem,16vw,4.25rem)] font-bold leading-none tracking-[var(--tracking-display)]",
          finalStretch ? "auction-flash-text" : lastMinute ? "text-ember-500 motion-safe:animate-pulse" : "text-text-primary",
        )}
        aria-live="off"
      >
        {countdown(slot.closesAt, serverNow)}
      </p>
      <p className={cx("mt-1 text-sm", lastMinute ? "font-semibold text-ember-500" : "text-text-secondary")}>
        {ended ? t("closing") : lastMinute ? t("lastMinute") : t("closesAt", { time: clockTime(slot.closesAt, locale) })}
      </p>

      <div className="mt-4 flex items-center gap-3 rounded-card bg-surface-2 p-3">
        {top ? (
          <>
            <Disc seed={top.trackTitle} className="size-14 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-text-primary">{top.trackTitle}</p>
              <p className="truncate text-sm text-text-secondary">{top.trackArtist}</p>
              <p className="truncate text-xs text-text-tertiary">
                {top.label ?? t("leader")} · {t("backers", { count: top.backers })}
              </p>
            </div>
            <p className="tnum shrink-0 text-2xl font-bold text-accent-400">{formatEurosDisplay(top.totalCents)}</p>
          </>
        ) : (
          <p className="w-full py-2 text-center text-sm text-text-secondary">
            {t("noBids", { amount: formatEurosDisplay(slot.minPriceCents) })}
          </p>
        )}
      </div>

      {mine ? (
        <p className={cx("mt-3 text-sm font-semibold", leading ? "text-accent-400" : "text-ember-500")}>
          {leading ? t("youLead") : t("youOutbid")}
        </p>
      ) : null}

      <div className={cx("mt-4 flex flex-col gap-2", ended && "hidden")}>
        {!mine ? (
          <Button fullWidth size="lg" onPress={onPickTrack}>
            {top ? t("bidOther") : t("bidFirst")}
          </Button>
        ) : null}
        {mine?.libraryTrackId ? (
          <Button
            fullWidth
            size="lg"
            onPress={() =>
              onSheet({
                slot,
                target: { kind: "own", trackId: mine.libraryTrackId! },
                current: leading ? (top?.totalCents ?? 0) : 0,
                title: t("raiseTitle"),
              })
            }
          >
            {t("raise", { amount: formatEurosDisplay(slot.minNextCents) })}
          </Button>
        ) : null}
        {top && !leading ? (
          <Button
            fullWidth
            variant="secondary"
            size="lg"
            onPress={() =>
              onSheet({ slot, target: { kind: "back", bidId: top.bidId }, current: top.totalCents, title: t("backTitle") })
            }
          >
            {t("back")}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

/** Several auctions open at once (a special next to the regular one): pick one. */
function SlotPicker({ slots, selectedId, serverNow, onPick }: { slots: PublicSlot[]; selectedId: string; serverNow: number; onPick: (id: string) => void }) {
  const t = useTranslations("guest.auction");
  const locale = useLocale();
  return (
    <div className="grid grid-flow-col auto-cols-fr gap-2" role="radiogroup" aria-label={t("chooseSlot")}>
      {slots.map((s) => (
        <button
          key={s.id}
          type="button"
          role="radio"
          aria-checked={s.id === selectedId}
          onClick={() => onPick(s.id)}
          className={cx(
            "flex min-h-16 flex-col items-start justify-center rounded-card border px-3 py-2 text-left transition-colors",
            s.id === selectedId ? "border-accent-500 bg-surface-2" : "border-line-subtle bg-surface-1",
          )}
        >
          <span className="truncate text-sm font-semibold text-text-primary">{slotName(s, t, locale)}</span>
          <span className="tnum text-xs text-text-secondary">{countdown(s.closesAt, serverNow)}</span>
        </button>
      ))}
    </div>
  );
}

function UpcomingList({ slots, serverNow }: { slots: UpcomingSlot[]; serverNow: number }) {
  const t = useTranslations("guest.auction");
  const locale = useLocale();
  if (slots.length === 0) return null;
  return (
    <section aria-label={t("upcomingTitle")} className="flex flex-col gap-2">
      <p className="label text-text-tertiary">{t("upcomingTitle")}</p>
      <ul className="overflow-hidden rounded-card border border-line-subtle bg-surface-1">
        {slots.map((s, i) => (
          <li key={s.id} className={cx("flex items-center gap-3 px-4 py-3", i > 0 && "border-t border-line-subtle")}>
            <span className="tnum w-14 shrink-0 text-lg font-bold text-text-primary">{clockTime(s.opensAt, locale)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-text-secondary">
                {t("opensIn", { time: countdown(s.opensAt, serverNow) })}
              </span>
              <span className="block truncate text-xs text-text-tertiary">
                {t("from", { amount: formatEurosDisplay(s.minPriceCents) })}
              </span>
            </span>
            {s.kind !== "regular" ? <SpecialChip /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Centre tab: choose the auction first, then the options appear. */
export function AuctionScreen({ token }: { token: string }) {
  const t = useTranslations("guest.auction");
  const locale = useLocale();
  const router = useRouter();
  const { state, refetch, serverNow, chosenSlotId, chooseSlot } = useAuction();
  const [sheet, setSheet] = React.useState<SheetState>(null);

  if (!state) return <Skeleton height={360} rounded="card" />;
  const selected = state.open.find((s) => s.id === chosenSlotId) ?? state.open[0] ?? null;
  // With nothing open the next one is the big countdown; the list shows the rest.
  const later = selected ? state.upcoming : state.upcoming.slice(1);

  return (
    <>
      {state.open.length > 1 && selected ? (
        <SlotPicker slots={state.open} selectedId={selected.id} serverNow={serverNow} onPick={chooseSlot} />
      ) : null}

      {selected ? (
        <AuctionCard
          slot={selected}
          state={state}
          serverNow={serverNow}
          onSheet={setSheet}
          onPickTrack={() => {
            chooseSlot(selected.id);
            router.push(`/s/${token}/search`);
          }}
        />
      ) : (
        <section className="rounded-sheet border border-line-subtle bg-surface-1 px-5 py-7 text-center">
          <Gavel size={28} className="mx-auto text-accent-400" aria-hidden />
          <p className="mt-3 text-lg font-semibold text-text-primary">{t("noAuction")}</p>
          {state.next ? (
            <>
              <p className="tnum mt-3 text-5xl font-bold text-text-primary">{countdown(state.next.opensAt, serverNow)}</p>
              <p className="mt-2 text-sm text-text-secondary">
                {t("nextOpens", {
                  time: clockTime(state.next.opensAt, locale),
                  amount: formatEurosDisplay(state.next.minPriceCents),
                })}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-text-secondary">{t("noAuctionHint")}</p>
          )}
        </section>
      )}

      <PushPrompt token={token} show={(state.me?.bids.length ?? 0) > 0} />
      <UpcomingList slots={later} serverNow={serverNow} />
      <p className="text-center text-xs text-text-tertiary">{t("rulesNote")}</p>

      <BottomSheet
        open={sheet !== null}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
        title={sheet?.title ?? ""}
        description={sheet?.target.kind === "back" ? t("backHint") : undefined}
      >
        {sheet ? (
          <BidForm
            token={token}
            // Live slot (new minimum) while the sheet is open.
            slot={state.open.find((s) => s.id === sheet.slot.id) ?? sheet.slot}
            rules={state.rules}
            target={sheet.target}
            currentBidTotal={sheet.current}
            walletCents={state.me?.walletCents ?? 0}
            methods={state.paymentMethods}
            onDone={() => {
              setSheet(null);
              void refetch();
            }}
          />
        ) : null}
      </BottomSheet>
    </>
  );
}

/** Top of search: the auction this track is for (or when the next opens). */
export function AuctionContextBar({ token }: { token: string }) {
  const t = useTranslations("guest.auction");
  const locale = useLocale();
  const { state, serverNow, chosenSlotId } = useAuction();
  if (!state) return <Skeleton height={56} rounded="card" />;
  const slot = state.open.find((s) => s.id === chosenSlotId) ?? state.open[0] ?? null;
  return (
    <Link
      href={`/s/${token}/auction`}
      className={cx(
        "flex min-h-14 items-center gap-3 rounded-card border px-4 py-2",
        slot ? "border-accent-500/40 bg-surface-1" : "border-line-subtle bg-surface-1",
        slot && inFinalStretch(slot.closesAt, serverNow) && "auction-flash-card",
      )}
    >
      <Gavel size={20} className="shrink-0 text-accent-400" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text-primary">
          {slot ? t("biddingIn", { name: slotName(slot, t, locale) }) : t("noAuction")}
        </span>
        <span className="block truncate text-xs text-text-secondary">
          {slot
            ? slot.top
              ? t("topNowLine", { amount: formatEurosDisplay(slot.top.totalCents) })
              : t("from", { amount: formatEurosDisplay(slot.minPriceCents) })
            : state.next
              ? t("nextOpens", { time: clockTime(state.next.opensAt, locale), amount: formatEurosDisplay(state.next.minPriceCents) })
              : t("noAuctionHint")}
        </span>
      </span>
      {slot ? <span className="tnum shrink-0 text-xl font-bold text-text-primary">{countdown(slot.closesAt, serverNow)}</span> : null}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

/** The live auction, one tap from bidding (or when the next one opens). */
export function AuctionTeaser({ token }: { token: string }) {
  const t = useTranslations("guest.auction");
  const locale = useLocale();
  const router = useRouter();
  const { state, serverNow, chooseSlot } = useAuction();
  if (!state) return <Skeleton height={148} rounded="card" />;
  const slot = state.open[0];

  if (!slot) {
    if (!state.next) return null;
    return (
      <Link
        href={`/s/${token}/auction`}
        className="flex min-h-16 items-center gap-3 rounded-card border border-line-subtle bg-surface-1 px-4 py-3 active:scale-[0.99]"
      >
        <Gavel size={20} className="shrink-0 text-accent-400" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text-primary">{t("noAuction")}</span>
          <span className="block truncate text-xs text-text-secondary">
            {t("nextOpens", { time: clockTime(state.next.opensAt, locale), amount: formatEurosDisplay(state.next.minPriceCents) })}
          </span>
        </span>
        <span className="tnum shrink-0 text-lg font-bold text-text-primary">{countdown(state.next.opensAt, serverNow)}</span>
      </Link>
    );
  }

  const mine = state.me?.bids.find((b) => b.slotId === slot.id && b.owner);
  const finalStretch = inFinalStretch(slot.closesAt, serverNow);
  return (
    <section
      aria-label={t("liveTeaser")}
      className={cx("rounded-card border border-accent-500/40 bg-surface-1 p-4", finalStretch && "auction-flash-card")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label flex items-center gap-1.5 text-accent-400">
            <Gavel size={14} aria-hidden />
            {t("liveTeaser")}
          </p>
          <p className="mt-1 truncate text-sm text-text-secondary">
            {slot.top
              ? t("topNowLine", { amount: formatEurosDisplay(slot.top.totalCents) })
              : t("from", { amount: formatEurosDisplay(slot.minPriceCents) })}
          </p>
          {mine ? (
            <p className={cx("mt-0.5 text-sm font-semibold", mine.status === "leading" ? "text-accent-400" : "text-ember-500")}>
              {mine.status === "leading" ? t("youLead") : t("youOutbidShort")}
            </p>
          ) : null}
        </div>
        <p className={cx("tnum shrink-0 text-3xl font-bold", finalStretch ? "auction-flash-text" : "text-text-primary")}>
          {countdown(slot.closesAt, serverNow)}
        </p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {mine ? (
          <Button size="md" className="col-span-2" onPress={() => router.push(`/s/${token}/auction`)}>
            {t("enterAuction")}
          </Button>
        ) : (
          <>
            <Button
              size="md"
              onPress={() => {
                chooseSlot(slot.id);
                router.push(`/s/${token}/search`);
              }}
            >
              {t("dockCta")}
            </Button>
            <Button size="md" variant="secondary" onPress={() => router.push(`/s/${token}/auction`)}>
              {t("enterAuction")}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

function WinnerRow({ w, highlight }: { w: PublicWinner; highlight?: boolean }) {
  const t = useTranslations("guest.auction");
  const locale = useLocale();
  return (
    <div
      className={cx(
        "flex items-center gap-3 rounded-card border p-3",
        highlight ? "border-accent-500/60 bg-surface-2" : "border-line-subtle bg-surface-1",
      )}
    >
      <Disc seed={w.trackTitle} className="size-12 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold text-text-primary">{w.trackTitle}</p>
        <p className="truncate text-sm text-text-secondary">{w.trackArtist}</p>
        <p className="truncate text-xs text-text-tertiary">
          {w.label ?? t("anonymous")}
          {highlight ? ` · ${t("playBy", { time: clockTime(w.playBy, locale) })}` : ""}
        </p>
      </div>
      <p className="tnum shrink-0 text-base font-bold text-accent-400">{formatEurosDisplay(w.totalCents)}</p>
    </div>
  );
}

/** "A seguir" and only the last 3 winners: the home stays short. */
export function NightWinners() {
  const t = useTranslations("guest.auction");
  const { state } = useAuction();
  if (!state) return null;
  const last = state.recentWinners.slice(0, 3);
  return (
    <>
      {state.upNext ? (
        <section aria-label={t("upNext")} className="flex flex-col gap-2">
          <p className="label text-text-primary">{t("upNext")}</p>
          <WinnerRow w={state.upNext} highlight />
        </section>
      ) : null}
      {last.length > 0 ? (
        <section aria-label={t("recentWinners")} className="flex flex-col gap-2">
          <p className="label text-text-tertiary">{t("recentWinners")}</p>
          {last.map((w) => (
            <WinnerRow key={w.slotId} w={w} />
          ))}
        </section>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Every tab                                                           */
/* ------------------------------------------------------------------ */

/** Last 30 s flash (and one buzz if I am in it), the winner celebration. */
export function AuctionOverlays() {
  const { state, serverNow, celebrate, dismissCelebration } = useAuction();
  const buzzed = React.useRef(new Set<string>());
  const flashing = state?.open.filter((s) => inFinalStretch(s.closesAt, serverNow)) ?? [];
  const flashingKey = flashing.map((s) => s.id).join(",");
  React.useEffect(() => {
    for (const id of flashingKey ? flashingKey.split(",") : []) {
      if (buzzed.current.has(id)) continue;
      buzzed.current.add(id);
      if (state?.me?.bids.some((b) => b.slotId === id)) navigator.vibrate?.([120, 80, 120]);
    }
  }, [flashingKey, state]);
  const won = celebrate ? state?.me?.bids.find((b) => b.slotId === celebrate) : undefined;
  return (
    <>
      {flashing.length > 0 ? <div aria-hidden className="auction-flash-frame" /> : null}
      {celebrate && won ? (
        <WinCelebration trackTitle={won.trackTitle} trackArtist={won.trackArtist} totalCents={won.totalCents} onClose={dismissCelebration} />
      ) : null}
    </>
  );
}

/**
 * The balance, small, top right — only while there is one (outbid money,
 * a late MB WAY). Tap: refund it now, or the end-of-night choice.
 */
export function WalletPill({ token }: { token: string }) {
  const t = useTranslations("guest.auction");
  const { state, refetch } = useAuction();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const cents = state?.me?.walletCents ?? 0;
  if (cents <= 0 && !open) return null;
  const keepAllowed = state?.rules.keepBalanceAllowed ?? false;
  const kept = keepAllowed && (state?.me?.keepBalance ?? false);

  async function refund() {
    setBusy(true);
    await apiFetch("/api/guest/wallet/refund", { method: "POST", body: JSON.stringify({ token }) });
    setBusy(false);
    setOpen(false);
    void refetch();
  }
  async function choose(next: boolean) {
    await apiFetch("/api/guest/wallet/keep", { method: "POST", body: JSON.stringify({ token, keep: next }) });
    void refetch();
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        aria-label={`${t("wallet")} ${formatEurosDisplay(cents)}`}
        className="flex h-8 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-sm font-semibold text-text-primary ring-1 ring-line-strong data-pressed:bg-surface-3"
      >
        <Wallet size={14} className="text-accent-400" aria-hidden />
        <span className="tnum">{formatEurosDisplay(cents)}</span>
      </Pressable>
      <BottomSheet open={open} onOpenChange={setOpen} title={t("walletTitle")}>
        <div className="flex flex-col gap-4 pt-1">
          <p className="tnum text-5xl font-bold text-text-primary">{formatEurosDisplay(cents)}</p>
          <p className="text-sm text-text-secondary">
            {kept ? t("walletKeptHint", { days: state?.rules.keepBalanceDays ?? 30 }) : t("walletHint")}
          </p>
          {keepAllowed ? (
            <div>
              <p className="text-xs text-text-secondary">{t("endOfNight")}</p>
              <div className="mt-1.5 grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("endOfNight")}>
                {[false, true].map((option) => (
                  <button
                    key={String(option)}
                    type="button"
                    role="radio"
                    aria-checked={kept === option}
                    onClick={() => void choose(option)}
                    className={cx(
                      "min-h-11 rounded-button border px-3 text-sm font-semibold",
                      kept === option
                        ? "border-accent-500 bg-surface-2 text-text-primary"
                        : "border-line-subtle bg-surface-1 text-text-secondary",
                    )}
                  >
                    {option ? t("keepForNext") : t("refundAtEnd")}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <Button fullWidth variant="secondary" loading={busy} disabled={cents <= 0} onPress={() => void refund()}>
            {t("walletRefundNow")}
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* My bids, bidding with a track                                       */
/* ------------------------------------------------------------------ */

/** "As minhas licitações" (top of /requests). */
export function MyBids({ empty }: { empty?: React.ReactNode }) {
  const t = useTranslations("guest.auction");
  const { state } = useAuction();
  if (!state) return <Skeleton height={76} rounded="card" />;
  const bids = state.me?.bids ?? [];
  if (bids.length === 0) return <>{empty ?? null}</>;
  return (
    <section className="flex flex-col gap-2" aria-label={t("myBids")}>
      <p className="label text-text-tertiary">{t("myBids")}</p>
      {bids.map((b) => (
        <div key={b.bidId} className="flex items-center gap-3 rounded-card border border-line-subtle bg-surface-1 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-text-primary">{b.trackTitle}</p>
            <p className="truncate text-sm text-text-secondary">
              {t(`bidStatus.${b.status}`)}
              {b.owner ? "" : ` · ${t("backed")}`}
            </p>
          </div>
          <p className="tnum shrink-0 text-sm font-semibold text-text-primary">
            {b.myCents > 0 ? formatEurosDisplay(b.myCents) : "—"}
          </p>
        </div>
      ))}
    </section>
  );
}

/** Track chosen in search → bid on the auction picked on the Leilão tab. */
export function BidScreen({
  token,
  track,
}: {
  token: string;
  track: { id: string; title: string; artist: string; bpm: number | null; camelotKey: string | null; coverUrl: string | null };
}) {
  const t = useTranslations("guest.auction");
  const locale = useLocale();
  const router = useRouter();
  const { ready } = useGuest();
  const { state, serverNow, chosenSlotId, chooseSlot } = useAuction();

  if (!state || !ready) return <Skeleton height={320} rounded="card" />;
  const slot = state.open.find((s) => s.id === chosenSlotId) ?? state.open[0] ?? null;
  const mine = slot ? state.me?.bids.find((b) => b.slotId === slot.id && b.owner) : undefined;
  // Same rules as the server (lib/auction/transition): harder transitions start higher.
  const assessment = assessTransition(track, state.nowPlaying, state.rules.transition);
  const trackFloorCents = slot && !mine ? startingPriceCents(slot.minPriceCents, assessment.multiplierBps) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        {track.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- catalog covers come from the provider's CDN
          <img src={track.coverUrl} alt="" className="size-[5.5rem] shrink-0 rounded-card object-cover" />
        ) : (
          <Disc seed={track.title} className="size-[5.5rem] shrink-0" />
        )}
        <div className="min-w-0">
          <p className="label truncate text-accent-400">{track.artist}</p>
          <p className="truncate text-2xl font-bold text-text-primary">{track.title}</p>
        </div>
      </div>

      <TransitionAssistant
        bpm={track.bpm}
        nowPlaying={state.nowPlaying}
        assessment={assessment}
        startingCents={slot ? startingPriceCents(slot.minPriceCents, assessment.multiplierBps) : null}
      />

      {!slot ? (
        <EmptyState
          icon={Gavel}
          title={t("noAuction")}
          hint={
            state.next
              ? t("nextOpens", {
                  time: clockTime(state.next.opensAt, locale),
                  amount: formatEurosDisplay(state.next.minPriceCents),
                })
              : t("noAuctionHint")
          }
        />
      ) : (
        <>
          {state.open.length > 1 ? (
            <SlotPicker slots={state.open} selectedId={slot.id} serverNow={serverNow} onPick={chooseSlot} />
          ) : null}

          <div className="flex items-baseline justify-between rounded-card border border-line-subtle bg-surface-1 px-4 py-3">
            <div>
              <p className="text-sm text-text-secondary">{slot.top ? t("topNow") : t("startsAt")}</p>
              <p className="tnum text-2xl font-bold text-text-primary">
                {formatEurosDisplay(slot.top?.totalCents ?? slot.minPriceCents)}
              </p>
            </div>
            <p className="tnum text-xl font-semibold text-text-primary">{countdown(slot.closesAt, serverNow)}</p>
          </div>

          {mine && mine.libraryTrackId !== track.id ? (
            <p role="alert" className="text-sm text-ember-500">
              {t("trackFixed", { title: mine.trackTitle })}
            </p>
          ) : (
            <BidForm
              key={slot.id}
              token={token}
              slot={slot}
              rules={state.rules}
              target={{ kind: "own", trackId: track.id }}
              currentBidTotal={mine?.status === "leading" ? mine.totalCents : 0}
              walletCents={state.me?.walletCents ?? 0}
              methods={state.paymentMethods}
              trackFloorCents={trackFloorCents}
              onDone={() => router.push(`/s/${token}/auction`)}
            />
          )}
        </>
      )}
    </div>
  );
}

const LEVEL_TONE = {
  easy: "border-green-500/35 bg-green-500/10 text-green-500",
  medium: "border-amber-500/35 bg-amber-500/10 text-amber-500",
  hard: "border-ember-500/35 bg-ember-500/10 text-ember-500",
  unknown: "border-line-strong bg-surface-2 text-text-secondary",
} as const;

/**
 * "Assistente de transição": the track's BPM against what is playing, how
 * hard the mix is, and what that does to the starting price.
 */
function TransitionAssistant({
  bpm,
  nowPlaying,
  assessment,
  startingCents,
}: {
  bpm: number | null;
  nowPlaying: AuctionState["nowPlaying"];
  assessment: TransitionAssessment;
  startingCents: number | null;
}) {
  const t = useTranslations("guest.auction.assistant");
  const fmtBpm = (v: number) => String(Math.round(v * 10) / 10).replace(".", ",");
  const detail = assessment.nothingPlaying
    ? t("nothingPlaying")
    : bpm === null
      ? t("unknownBpm")
      : nowPlaying?.bpm == null
        ? t("unknownPlaying")
        : assessment.mode === "half"
          ? t("half", { delta: String(assessment.deltaPct).replace(".", ",") })
          : assessment.mode === "double"
            ? t("double", { delta: String(assessment.deltaPct).replace(".", ",") })
            : t("delta", { delta: String(assessment.deltaPct).replace(".", ",") });
  return (
    <section className="rounded-card border border-line-subtle bg-surface-1 p-4" aria-label={t("title")}>
      <div className="flex items-center justify-between gap-3">
        <p className="label flex items-center gap-1.5 text-text-primary">
          <AudioWaveform size={14} className="text-accent-400" aria-hidden />
          {t("title")}
        </p>
        <span className={cx("rounded-chip border px-2 py-0.5 text-xs font-semibold", LEVEL_TONE[assessment.level])}>
          {t(`levels.${assessment.level}`)}
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <p className="tnum text-3xl font-bold text-text-primary">{bpm === null ? "—" : fmtBpm(bpm)}</p>
        <p className="text-sm text-text-secondary">BPM</p>
      </div>
      {nowPlaying ? (
        <p className="mt-1 truncate text-sm text-text-secondary">
          {t("playing", { title: nowPlaying.title, bpm: nowPlaying.bpm === null ? "—" : fmtBpm(nowPlaying.bpm) })}
        </p>
      ) : null}
      <p className="mt-2 text-sm text-text-secondary">
        {detail}
        {assessment.keyMatch === true ? ` ${t("keyMatch")}` : assessment.keyMatch === false ? ` ${t("keyClash")}` : ""}
      </p>
      {startingCents !== null ? (
        <p className="mt-2 text-sm text-text-primary">
          {t("startingPrice", { amount: formatEurosDisplay(startingCents) })}
          {assessment.multiplierBps > 10_000 ? <span className="text-text-tertiary"> {t("why")}</span> : null}
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Ranking                                                             */
/* ------------------------------------------------------------------ */

const PODIUM = {
  1: { order: "order-2", step: "h-32", avatar: "size-20 text-2xl bg-accent-500 text-text-on-accent shadow-glow-accent", amount: "text-xl text-accent-400" },
  2: { order: "order-1", step: "h-24", avatar: "size-14 text-lg bg-surface-3 text-text-primary ring-1 ring-line-strong", amount: "text-base text-text-primary" },
  3: { order: "order-3", step: "h-16", avatar: "size-14 text-lg bg-surface-3 text-text-primary ring-1 ring-line-strong", amount: "text-base text-text-primary" },
} as const;

/** "@rita" → "R", "Mesa 12" → "M", anonymous → "?". */
function initialOf(label: string | null): string {
  const letter = label?.replace(/^@/, "").trim().charAt(0);
  return letter ? letter.toUpperCase() : "?";
}

function PodiumStep({ place, label, cents }: { place: 1 | 2 | 3; label: string | null; cents: number }) {
  const t = useTranslations("guest.auction");
  const look = PODIUM[place];
  const name = label ?? t("anonymous");
  return (
    <li className={cx("flex min-w-0 flex-col items-center", look.order)} aria-label={t("place", { place, name, amount: formatEurosDisplay(cents) })}>
      {place === 1 ? <Crown size={22} className="mb-1 text-amber-500" aria-hidden /> : null}
      <span aria-hidden className={cx("flex items-center justify-center rounded-full font-bold", look.avatar)}>
        {initialOf(label)}
      </span>
      <p aria-hidden className="mt-2 w-full truncate text-center text-sm font-semibold text-text-primary">
        {name}
      </p>
      <p aria-hidden className={cx("tnum text-center font-bold", look.amount)}>
        {formatEurosDisplay(cents)}
      </p>
      <div
        aria-hidden
        className={cx(
          "mt-2 flex w-full justify-center rounded-t-card border-x border-t pt-2",
          look.step,
          place === 1 ? "border-accent-500/50 bg-linear-to-b from-accent-500/40 to-accent-500/5" : "border-line-subtle bg-surface-2",
        )}
      >
        <span className="tnum text-2xl font-bold text-text-secondary">{place}</span>
      </div>
    </li>
  );
}

/** Top 3 on a podium; everyone else below, smaller and quieter. */
export function RankingPodium() {
  const t = useTranslations("guest.auction");
  const { state } = useAuction();
  if (!state) return <Skeleton height={280} rounded="card" />;
  if (state.ranking.length === 0) {
    return <EmptyState icon={Trophy} title={t("rankingEmpty")} hint={t("rankingEmptyHint")} />;
  }
  const podium = state.ranking.slice(0, 3);
  const rest = state.ranking.slice(3);
  return (
    <section aria-label={t("rankingTitle")} className="flex flex-col gap-6">
      <ol className="grid grid-cols-3 items-end gap-2 pt-2">
        {podium.map((r, i) => (
          <PodiumStep key={`${r.label ?? "anon"}-${i}`} place={(i + 1) as 1 | 2 | 3} label={r.label} cents={r.spentCents} />
        ))}
      </ol>
      {rest.length > 0 ? (
        <section aria-label={t("rankingRest")}>
          <p className="label text-text-tertiary">{t("rankingRest")}</p>
          <ol start={4} className="mt-1">
            {rest.map((r, i) => (
              <li
                key={`${r.label ?? "anon"}-${i}`}
                className="flex items-center gap-3 border-b border-line-subtle py-2.5 text-sm last:border-b-0"
              >
                <span className="tnum w-6 shrink-0 text-text-tertiary">{i + 4}</span>
                <span className="min-w-0 flex-1 truncate text-text-secondary">{r.label ?? t("anonymous")}</span>
                <span className="tnum shrink-0 text-text-tertiary">{formatEurosDisplay(r.spentCents)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <p className="text-xs text-text-tertiary">{t("rankingHint")}</p>
    </section>
  );
}
