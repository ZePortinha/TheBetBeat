"use client";

/**
 * "Ranking" (2026-10-08 redesign): who spent the most tonight on songs that
 * played. The top 3 stand on a lit stage (gold, silver and bronze rings,
 * the steps rise in, the crown drops on the leader, the amounts count up);
 * everyone else follows in a quieter list where a thin bar shows how close
 * they are to the top. "Partilhar ranking" sends the Story image
 * (/api/guest/ranking/card) to the share sheet. Reduced motion: everything
 * is simply there.
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

function PodiumStep({ place, label, cents }: { place: Place; label: string | null; cents: number }) {
  const t = useTranslations("guest.auction");
  const reduced = useReducedMotion() ?? false;
  const look = LOOK[place];
  const name = label ?? t("anonymous");
  const amount = useCountUp(cents, 900, look.delay * 1000 + 250, !reduced);
  const spring = { type: "spring" as const, bounce: 0, duration: 0.55, delay: look.delay };

  return (
    <li
      className={cx("flex min-w-0 flex-col items-center", look.order)}
      aria-label={t("place", { place, name, amount: formatEurosDisplay(cents) })}
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
          <span className={cx("medal flex items-center justify-center rounded-full font-bold text-text-primary", look.ring, look.avatar)}>
            {initialOf(label)}
          </span>
        </span>
        <p className={cx("mt-2.5 w-full max-w-[7.5rem] truncate text-center text-sm font-semibold", place === 1 ? "leader-name-mine" : "text-text-primary")}>
          {name}
        </p>
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
  const file = new File([await res.blob()], "betbeat-ranking.png", { type: "image/png" });
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

/** Top 3 on a lit podium; everyone else below, quieter, with a bar to the top. */
export function RankingPodium({ token }: { token: string }) {
  const t = useTranslations("guest.auction");
  const reduced = useReducedMotion() ?? false;
  const { state } = useAuction();
  const [sharing, setSharing] = React.useState(false);

  if (!state) return <Skeleton height={360} rounded="card" />;
  if (state.ranking.length === 0) {
    return <EmptyState icon={Trophy} title={t("rankingEmpty")} hint={t("rankingEmptyHint")} />;
  }
  const podium = state.ranking.slice(0, 3);
  const rest = state.ranking.slice(3);
  const top = podium[0]?.spentCents ?? 1;

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
            <PodiumStep key={`${r.label ?? "anon"}-${i}`} place={(i + 1) as Place} label={r.label} cents={r.spentCents} />
          ))}
        </ol>
      </div>

      {rest.length > 0 ? (
        <section aria-label={t("rankingRest")}>
          <p className="label text-text-tertiary">{t("rankingRest")}</p>
          <ol start={4} className="mt-2 overflow-hidden rounded-card border border-line-subtle bg-surface-1">
            {rest.map((r, i) => (
              <motion.li
                key={`${r.label ?? "anon"}-${i}`}
                className={cx("flex items-center gap-3 px-4 py-3", i > 0 && "border-t border-line-subtle")}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.6 + Math.min(i, 8) * 0.04 }}
              >
                <span className="tnum w-6 shrink-0 text-sm font-semibold text-text-tertiary">{i + 4}</span>
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-sm font-bold text-text-primary"
                >
                  {initialOf(r.label)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-text-primary">{r.label ?? t("anonymous")}</span>
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

      <Button size="lg" fullWidth variant="secondary" loading={sharing} onPress={() => void share()}>
        <Instagram size={20} aria-hidden />
        {t("shareRanking")}
      </Button>
      <p className="text-center text-xs text-text-tertiary">{t("rankingHint")}</p>
    </section>
  );
}
