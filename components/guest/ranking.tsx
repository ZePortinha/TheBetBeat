"use client";

/**
 * "Ranking" (2026-10-08 redesign): who spent the most tonight on songs that
 * played. The top 3 stand on a lit stage (gold, silver and bronze rings,
 * the steps rise in, the crown drops on the leader, the amounts count up);
 * everyone else follows in a quieter list where a thin bar shows how close
 * they are to the top. "Partilhar ranking" sends the Story image
 * (/api/guest/ranking/card) to the share sheet. Reduced motion: everything
 * is simply there.
 *
 * The guest's own row is marked "Tu" (2026-11-06), at the place they land
 * once the songs they won play (lib/auction/ranking). Coming from the
 * winner's screen (?me=1), the list first plays as usual, then moves to
 * that row and lights it up.
 */

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { Crown, Instagram, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cx } from "@/components/ui/pressable";
import { formatEurosDisplay } from "@/components/ui/price-tag";
import { toast } from "@/components/ui/toast";
import { personalRanking, type RankRow } from "@/lib/auction/ranking";
import { useAuction } from "./use-auction";

type Place = 1 | 2 | 3;

const LOOK: Record<Place, { order: string; step: string; avatar: string; amount: string; ring: string; delay: number }> = {
  1: { order: "order-2", step: "h-36", avatar: "size-24 text-3xl", amount: "text-2xl", ring: "medal-1", delay: 0.32 },
  2: { order: "order-1", step: "h-24", avatar: "size-16 text-xl", amount: "text-lg", ring: "medal-2", delay: 0.16 },
  3: { order: "order-3", step: "h-16", avatar: "size-16 text-xl", amount: "text-lg", ring: "medal-3", delay: 0 },
};

/** "@rita" → "R", "Mesa 12" → "M", anonymous → "?". */
function initialOf(label: string | null): string {
  const letter = label?.replace(/^@/, "").trim().charAt(0);
  return letter ? letter.toUpperCase() : "?";
}

function useCountUp(target: number, ms: number, delayMs: number, run: boolean): number {
  const [value, setValue] = React.useState(run ? 0 : target);
  React.useEffect(() => {
    if (!run) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now() + delayMs;
    const step = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / ms));
      setValue(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, delayMs, run]);
  return value;
}

/** "Tu": the guest's own row. */
function MePill({ spot }: { spot: boolean }) {
  const t = useTranslations("guest.auction");
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.span
      className="inline-flex shrink-0 items-center rounded-full bg-accent-500 px-2 py-0.5 text-[0.6875rem] font-bold leading-none text-text-on-accent"
      animate={spot && !reduced ? { scale: [1, 1.35, 1] } : undefined}
      transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
    >
      {t("rankYou")}
    </motion.span>
  );
}

/** How long the ranking takes to arrive before it moves to the guest's row. */
const SPOT_AFTER_MS = 1300;

function PodiumStep({ place, row, spot }: { place: Place; row: RankRow; spot: boolean }) {
  const t = useTranslations("guest.auction");
  const reduced = useReducedMotion() ?? false;
  const look = LOOK[place];
  const label = row.label;
  const cents = row.spentCents;
  const name = label ?? t("anonymous");
  const amount = useCountUp(cents, 900, look.delay * 1000 + 250, !reduced);
  const spring = { type: "spring" as const, bounce: 0, duration: 0.55, delay: look.delay };

  return (
    <li
      data-mine={row.mine || undefined}
      className={cx("flex min-w-0 flex-col items-center", look.order)}
      aria-label={t("place", { place, name, amount: formatEurosDisplay(cents) })}
      aria-current={row.mine ? "true" : undefined}
    >
      <motion.div
        aria-hidden
        className="flex flex-col items-center"
        initial={reduced ? false : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: look.delay + 0.15 }}
      >
        <span className="relative">
          {place === 1 ? (
            <motion.span
              className="absolute -top-7 left-1/2 -translate-x-1/2 text-amber-500"
              initial={reduced ? false : { opacity: 0, y: -18, rotate: -12 }}
              animate={{ opacity: 1, y: 0, rotate: 0 }}
              transition={{ type: "spring", bounce: 0.35, duration: 0.6, delay: 0.85 }}
            >
              <Crown size={26} strokeWidth={2.25} />
            </motion.span>
          ) : null}
          <motion.span
            className={cx(
              "medal flex items-center justify-center rounded-full font-bold text-text-primary",
              look.ring,
              look.avatar,
              row.mine && "shadow-glow-accent",
            )}
            animate={spot && !reduced ? { scale: [1, 1.14, 1, 1.08, 1] } : undefined}
            transition={{ duration: 1.1, ease: "easeInOut" }}
          >
            {initialOf(label)}
          </motion.span>
        </span>
        <p className={cx("mt-2.5 w-full max-w-[7.5rem] truncate text-center text-sm font-semibold", place === 1 ? "leader-name-mine" : "text-text-primary")}>
          {name}
        </p>
        {row.mine ? (
          <span className="mt-1">
            <MePill spot={spot} />
          </span>
        ) : null}
        <p className={cx("tnum text-center font-bold", look.amount, place === 1 ? "text-text-primary" : "text-text-secondary")}>
          {formatEurosDisplay(amount)}
        </p>
      </motion.div>
      <motion.div
        aria-hidden
        className={cx(
          "rank-step mt-3 flex w-full origin-bottom justify-center rounded-t-card pt-2",
          look.step,
          place === 1 && "rank-step-1",
        )}
        initial={reduced ? false : { scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={spring}
      >
        <span className={cx("tnum text-3xl font-bold", place === 1 ? "text-text-primary" : "text-text-tertiary")}>{place}</span>
      </motion.div>
    </li>
  );
}

/** Ranking image → share sheet (Instagram Stories), or a download. */
async function shareRanking(token: string, title: string): Promise<"shared" | "saved"> {
  const res = await fetch(`/api/guest/ranking/card?token=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error("card");
  const file = new File([await res.blob()], "discontrol-ranking.png", { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title });
    return "shared";
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "saved";
}

/** The accent edge of the guest's row, and the light that runs over it once. */
function MineGlow({ spot }: { spot: boolean }) {
  const reduced = useReducedMotion() ?? false;
  return (
    <>
      <span aria-hidden className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-accent-500/50" />
      {spot && !reduced ? (
        <>
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-accent-500"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0.35, 1, 0.6] }}
            transition={{ duration: 1.6, ease: "easeInOut" }}
          />
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent"
            initial={{ x: "-100%" }}
            animate={{ x: "300%" }}
            transition={{ duration: 0.9, ease: [0.4, 0, 0.2, 1], delay: 0.15 }}
          />
        </>
      ) : null}
    </>
  );
}

/**
 * Arriving from the winner's screen (?me=1): once the ranking has played
 * in, scroll to the guest's row and light it up (true from then on). The
 * flag leaves the address, so a reload or Back does not play it again.
 */
function useSpotlight(hasMine: boolean, reduced: boolean): boolean {
  const [spot, setSpot] = React.useState(false);
  const [asked] = React.useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("me") === "1",
  );
  React.useEffect(() => {
    if (!asked || !hasMine) return;
    const timer = setTimeout(
      () => {
        document.querySelector("[data-mine]")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
        setSpot(true);
        const url = new URL(window.location.href);
        url.searchParams.delete("me");
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      },
      reduced ? 0 : SPOT_AFTER_MS,
    );
    return () => clearTimeout(timer);
  }, [asked, hasMine, reduced]);
  return spot;
}

/** Top 3 on a lit podium; everyone else below, quieter, with a bar to the top. */
export function RankingPodium({ token }: { token: string }) {
  const t = useTranslations("guest.auction");
  const reduced = useReducedMotion() ?? false;
  const { state } = useAuction();
  const [sharing, setSharing] = React.useState(false);
  const rows = React.useMemo(() => (state ? personalRanking(state.ranking, state.me?.rank) : []), [state]);
  const spot = useSpotlight(rows.some((r) => r.mine), reduced);

  if (!state) return <Skeleton height={360} rounded="card" />;
  if (rows.length === 0) {
    return <EmptyState icon={Trophy} title={t("rankingEmpty")} hint={t("rankingEmptyHint")} />;
  }
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  const top = podium[0]?.spentCents ?? 1;
  const minePending = rows.find((r) => r.mine && r.pendingCents > 0);

  async function share() {
    setSharing(true);
    try {
      if ((await shareRanking(token, t("shareRankingTitle"))) === "saved") toast({ title: t("shareSaved") });
    } catch (error) {
      if ((error as Error).name !== "AbortError") toast({ title: t("shareError"), variant: "error" });
    } finally {
      setSharing(false);
    }
  }

  return (
    <section aria-label={t("rankingTitle")} className="flex flex-col gap-6">
      <div className="rank-stage relative isolate overflow-hidden rounded-sheet border border-line-subtle bg-surface-1 px-3 pt-12">
        <ol className="grid grid-cols-3 items-end gap-2">
          {podium.map((r, i) => (
            <PodiumStep key={`${r.mine ? "me" : (r.label ?? "anon")}-${i}`} place={(i + 1) as Place} row={r} spot={spot && r.mine} />
          ))}
        </ol>
      </div>
      {minePending && minePending.place <= 3 ? (
        <p className="-mt-3 text-center text-xs font-medium text-accent-400">{t("rankPending")}</p>
      ) : null}

      {rest.length > 0 ? (
        <section aria-label={t("rankingRest")}>
          <p className="label text-text-tertiary">{t("rankingRest")}</p>
          <ol start={4} className="mt-2 overflow-hidden rounded-card border border-line-subtle bg-surface-1">
            {rest.map((r, i) => (
              <motion.li
                key={`${r.mine ? "me" : (r.label ?? "anon")}-${i}`}
                data-mine={r.mine || undefined}
                aria-current={r.mine ? "true" : undefined}
                className={cx(
                  "relative flex items-center gap-3 px-4 py-3",
                  i > 0 && "border-t border-line-subtle",
                  r.mine && "overflow-hidden bg-accent-500/10",
                )}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.6 + Math.min(i, 8) * 0.04 }}
              >
                {r.mine ? <MineGlow spot={spot} /> : null}
                <span className={cx("tnum w-6 shrink-0 text-sm font-semibold", r.mine ? "text-accent-400" : "text-text-tertiary")}>
                  {r.place}
                </span>
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-sm font-bold text-text-primary"
                >
                  {initialOf(r.label)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-text-primary">{r.label ?? t("anonymous")}</span>
                    {r.mine ? <MePill spot={spot} /> : null}
                  </span>
                  {r.mine && r.pendingCents > 0 ? (
                    <span className="mt-0.5 block text-xs font-medium text-accent-400">{t("rankPending")}</span>
                  ) : null}
                  <span aria-hidden className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-3">
                    <motion.span
                      className="block h-full origin-left rounded-full bg-heat"
                      initial={reduced ? false : { scaleX: 0 }}
                      animate={{ scaleX: Math.max(0.04, r.spentCents / top) }}
                      transition={{ type: "spring", bounce: 0, duration: 0.7, delay: 0.7 + Math.min(i, 8) * 0.04 }}
                    />
                  </span>
                </span>
                <span className="tnum shrink-0 text-sm font-semibold text-text-secondary">{formatEurosDisplay(r.spentCents)}</span>
              </motion.li>
            ))}
          </ol>
        </section>
      ) : null}

      <Button size="lg" fullWidth variant="secondary" loading={sharing} activateOn="release" onPress={() => void share()}>
        <Instagram size={20} aria-hidden />
        {t("shareRanking")}
      </Button>
      <p className="text-center text-xs text-text-tertiary">{t("rankingHint")}</p>
    </section>
  );
}
