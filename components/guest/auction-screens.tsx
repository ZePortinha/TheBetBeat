"use client";

/**
 * Slot auctions in the guest app (2026-10-05, replaces the tiers):
 *  - AuctionLive: wallet, the open auction(s) with server-clock countdown,
 *    "Subir" / "Apoiar" in a sheet, "A seguir", next auction, winners.
 *  - MyBids: my bids tonight + balance and "Devolver saldo".
 *  - BidScreen: a track from search → pick the open auction → bid.
 *  - useRanking: who spent the most tonight (public amounts).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AudioWaveform, Crown, Gavel, Sparkles, Trophy, Wallet } from "lucide-react";
import type { PublicSlot, PublicWinner } from "@/lib/auction/service";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Disc } from "@/components/ui/disc";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cx } from "@/components/ui/pressable";
import { formatEurosDisplay } from "@/components/ui/price-tag";
import { apiFetch } from "./api";
import { BidForm, type BidTargetInput } from "./bid-form";
import { useGuest } from "./guest-providers";
import { WinCelebration } from "./win-celebration";
import { clockTime, countdown, inFinalStretch, useAuction, type AuctionState } from "./use-auction";
import { assessTransition, startingPriceCents, type TransitionAssessment } from "@/lib/auction/transition";

type Me = NonNullable<AuctionState["me"]>;
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

function AuctionCard({
  slot,
  state,
  serverNow,
  onSheet,
  onBidOther,
}: {
  slot: PublicSlot;
  state: AuctionState;
  serverNow: number;
  onSheet: (s: NonNullable<SheetState>) => void;
  onBidOther: () => void;
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
      className={cx("rounded-card border border-line-subtle bg-surface-1 p-4", finalStretch && "auction-flash-card")}
      aria-label={t("openTitle")}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="label flex items-center gap-1.5 text-text-primary">
          <Gavel size={14} className="text-accent-400" aria-hidden />
          {t("openTitle")}
        </p>
        {slot.kind !== "regular" ? <SpecialChip /> : null}
      </div>

      <p
        className={cx(
          "tnum mt-3 text-[clamp(2.5rem,13vw,3.5rem)] font-bold leading-none tracking-[var(--tracking-display)]",
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

      <div className={cx("mt-3 flex flex-col gap-2", ended && "hidden")}>
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
            variant={mine ? "secondary" : "primary"}
            size="lg"
            onPress={() =>
              onSheet({ slot, target: { kind: "back", bidId: top.bidId }, current: top.totalCents, title: t("backTitle") })
            }
          >
            {t("back")}
          </Button>
        ) : null}
        {!mine ? (
          <Button fullWidth variant="secondary" size="lg" onPress={onBidOther}>
            {top ? t("bidOther") : t("bidFirst")}
          </Button>
        ) : null}
      </div>
    </article>
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

function WalletChip({
  token,
  cents,
  keep,
  keepAllowed,
  keepDays,
  onChange,
}: {
  token: string;
  cents: number;
  keep: boolean;
  keepAllowed: boolean;
  keepDays: number;
  onChange: () => void;
}) {
  const t = useTranslations("guest.auction");
  const [busy, setBusy] = React.useState(false);
  if (cents <= 0) return null;
  async function refund() {
    setBusy(true);
    await apiFetch("/api/guest/wallet/refund", { method: "POST", body: JSON.stringify({ token }) });
    setBusy(false);
    onChange();
  }
  async function choose(next: boolean) {
    await apiFetch("/api/guest/wallet/keep", { method: "POST", body: JSON.stringify({ token, keep: next }) });
    onChange();
  }
  const kept = keepAllowed && keep;
  return (
    <section className="rounded-card border border-line-subtle bg-surface-1 px-4 py-3" aria-label={t("wallet")}>
      <div className="flex items-center gap-3">
        <Wallet size={20} className="shrink-0 text-accent-400" aria-hidden />
        <p className="flex-1 text-base text-text-primary">
          {t("wallet")} <span className="tnum font-bold">{formatEurosDisplay(cents)}</span>
        </p>
        <Button size="md" variant="secondary" loading={busy} onPress={() => void refund()}>
          {t("walletRefund")}
        </Button>
      </div>
      {keepAllowed ? (
        <div className="mt-3">
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
      <p className="mt-2 text-xs text-text-tertiary">{kept ? t("walletKeptHint", { days: keepDays }) : t("walletHint")}</p>
    </section>
  );
}

/** Live auctions block: home ("Pedir faixa") and "Fila ao vivo". */
export function AuctionLive({
  token,
  sessionId,
  showWinners = false,
}: {
  token: string;
  sessionId: string;
  showWinners?: boolean;
}) {
  const t = useTranslations("guest.auction");
  const locale = useLocale();
  const router = useRouter();
  const { state, refetch, serverNow, celebrate, dismissCelebration } = useAuction(token, sessionId);
  const [sheet, setSheet] = React.useState<SheetState>(null);
  const buzzed = React.useRef(new Set<string>());
  const flashing = state?.open.filter((s) => inFinalStretch(s.closesAt, serverNow)) ?? [];

  // Entering the last 30 s of an auction you are in: one buzz, once.
  const flashingKey = flashing.map((s) => s.id).join(",");
  React.useEffect(() => {
    for (const id of flashingKey ? flashingKey.split(",") : []) {
      if (buzzed.current.has(id)) continue;
      buzzed.current.add(id);
      if (state?.me?.bids.some((b) => b.slotId === id)) navigator.vibrate?.([120, 80, 120]);
    }
  }, [flashingKey, state]);

  if (!state) return <Skeleton height={220} rounded="card" />;
  const won = celebrate ? state.me?.bids.find((b) => b.slotId === celebrate) : undefined;

  return (
    <>
      {flashing.length > 0 ? <div aria-hidden className="auction-flash-frame" /> : null}
      <WalletChip
        token={token}
        cents={state.me?.walletCents ?? 0}
        keep={state.me?.keepBalance ?? false}
        keepAllowed={state.rules.keepBalanceAllowed}
        keepDays={state.rules.keepBalanceDays}
        onChange={() => void refetch()}
      />

      {state.open.length > 0 ? (
        state.open.map((slot) => (
          <AuctionCard
            key={slot.id}
            slot={slot}
            state={state}
            serverNow={serverNow}
            onSheet={setSheet}
            onBidOther={() => router.push(`/s/${token}/search`)}
          />
        ))
      ) : (
        <section className="rounded-card border border-line-subtle bg-surface-1 px-4 py-5 text-center">
          <p className="text-base font-semibold text-text-primary">{t("noAuction")}</p>
          {state.next ? (
            <>
              <p className="tnum mt-2 text-4xl font-bold text-text-primary">{countdown(state.next.opensAt, serverNow)}</p>
              <p className="mt-1 text-sm text-text-secondary">
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

      {state.upNext ? (
        <section aria-label={t("upNext")}>
          <p className="label mb-2 text-text-primary">{t("upNext")}</p>
          <WinnerRow w={state.upNext} highlight />
        </section>
      ) : null}

      {state.open.length > 0 && state.next ? (
        <p className="text-center text-sm text-text-secondary">
          {t("nextOpens", {
            time: clockTime(state.next.opensAt, locale),
            amount: formatEurosDisplay(state.next.minPriceCents),
          })}
        </p>
      ) : null}

      {showWinners && state.recentWinners.length > 0 ? (
        <section aria-label={t("recentWinners")} className="flex flex-col gap-2">
          <p className="label text-text-primary">{t("recentWinners")}</p>
          {state.recentWinners.map((w) => (
            <WinnerRow key={w.slotId} w={w} />
          ))}
        </section>
      ) : null}

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

      {celebrate && won ? (
        <WinCelebration
          trackTitle={won.trackTitle}
          trackArtist={won.trackArtist}
          totalCents={won.totalCents}
          onClose={dismissCelebration}
        />
      ) : null}
    </>
  );
}

/** "As minhas licitações" + balance (top of /requests). */
export function MyBids({
  token,
  sessionId,
  empty,
}: {
  token: string;
  sessionId: string;
  /** Shown when there is nothing at all (no bids, no balance). */
  empty?: React.ReactNode;
}) {
  const t = useTranslations("guest.auction");
  const { state, refetch } = useAuction(token, sessionId);
  const me: Me | null = state?.me ?? null;
  if (!state) return <Skeleton height={76} rounded="card" />;
  if (!me || (me.bids.length === 0 && me.walletCents <= 0)) return <>{empty ?? null}</>;
  return (
    <>
      <WalletChip
        token={token}
        cents={me.walletCents}
        keep={me.keepBalance}
        keepAllowed={state.rules.keepBalanceAllowed}
        keepDays={state.rules.keepBalanceDays}
        onChange={() => void refetch()}
      />
      {me.bids.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label={t("myBids")}>
          <p className="label text-text-tertiary">{t("myBids")}</p>
          {me.bids.map((b) => (
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
      ) : null}
    </>
  );
}

/** Track chosen in search → bid on the open auction. */
export function BidScreen({
  token,
  sessionId,
  track,
}: {
  token: string;
  sessionId: string;
  track: { id: string; title: string; artist: string; bpm: number | null; camelotKey: string | null; coverUrl: string | null };
}) {
  const t = useTranslations("guest.auction");
  const locale = useLocale();
  const router = useRouter();
  const { ready } = useGuest();
  const { state, serverNow } = useAuction(token, sessionId);
  const [slotId, setSlotId] = React.useState<string | null>(null);

  if (!state || !ready) return <Skeleton height={320} rounded="card" />;
  const slot = state.open.find((s) => s.id === slotId) ?? state.open[0] ?? null;
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
            <div className="flex gap-2" role="radiogroup" aria-label={t("chooseSlot")}>
              {state.open.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={s.id === slot.id}
                  onClick={() => setSlotId(s.id)}
                  className={cx(
                    "tnum min-h-11 flex-1 rounded-button border px-3 text-sm font-semibold",
                    s.id === slot.id ? "border-accent-500 bg-surface-2 text-text-primary" : "border-line-subtle bg-surface-1 text-text-secondary",
                  )}
                >
                  {s.kind !== "regular" ? t("special") : t("closesAt", { time: clockTime(s.closesAt, locale) })}
                </button>
              ))}
            </div>
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
              onDone={() => router.push(`/s/${token}`)}
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

/** Who spent the most tonight (only money behind winners that played). */
export function RankingBySpend({ token, sessionId }: { token: string; sessionId: string }) {
  const t = useTranslations("guest.auction");
  const { state } = useAuction(token, sessionId);
  if (!state) return <Skeleton height={160} rounded="card" />;
  if (state.ranking.length === 0) {
    return <EmptyState icon={Trophy} title={t("rankingEmpty")} hint={t("rankingEmptyHint")} />;
  }
  return (
    <section aria-label={t("rankingTitle")}>
      <p className="label flex items-center gap-1.5 text-text-primary">
        <Crown size={14} strokeWidth={1.75} className="text-accent-400" aria-hidden />
        {t("rankingTitle")}
      </p>
      <ol className="mt-3 flex flex-col gap-2">
        {state.ranking.map((r, i) => (
          <li
            key={`${r.label ?? "anon"}-${i}`}
            className={cx(
              "flex items-center gap-3 rounded-card border px-4 py-3",
              i === 0 ? "border-accent-500/60 bg-surface-2" : "border-line-subtle bg-surface-1",
            )}
          >
            <span className={cx("tnum w-6 shrink-0 text-base font-bold", i === 0 ? "text-accent-400" : "text-text-tertiary")}>
              {i + 1}
            </span>
            <p className="min-w-0 flex-1 truncate text-base font-semibold text-text-primary">{r.label ?? t("anonymous")}</p>
            <span className="tnum shrink-0 text-base font-bold text-accent-400">{formatEurosDisplay(r.spentCents)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-text-tertiary">{t("rankingHint")}</p>
    </section>
  );
}
