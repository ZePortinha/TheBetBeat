"use client";

/**
 * "Vencedor": the moment a guest's bid wins, built to be filmed. The 3D
 * stage (win-scene: flash, the vinyl with their album art, champagne,
 * confetti, bloom) behind the title materializing in one sweep of gold,
 * the amount counting up and a scrim that keeps the words legible over
 * the confetti. The haptic fires with the flash (same frame). three.js is
 * fetched ahead while the guest leads (AuctionOverlays), so the moment
 * lands on time. Reduced motion: a still, calm version of the same screen.
 */

import * as React from "react";
import { animate, motion, useIsPresent, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { Crown, Instagram } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatEurosDisplay } from "@/components/ui/price-tag";
import { toast } from "@/components/ui/toast";
import { springDefault } from "@/lib/motion";

/** Counts up whole euros straight into the DOM (no React render per frame), lands on the exact amount. */
function CountUp({ cents, delay, run }: { cents: number; delay: number; run: boolean }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!run || !el) return;
    const controls = animate(0, cents, {
      duration: 1.2,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        el.textContent = formatEurosDisplay(v >= cents ? cents : Math.floor(v / 100) * 100);
      },
    });
    return () => controls.stop();
  }, [cents, delay, run]);
  return <span ref={ref}>{formatEurosDisplay(run ? 0 : cents)}</span>;
}

// Celebration: a strong double tap then a long swell.
const WIN_HAPTIC = [40, 40, 40, 40, 220];

/**
 * "Partilhar no Instagram": the story image (1080×1920) into the phone's
 * share sheet, where Instagram Stories / Feed live. No share sheet (desktop):
 * the image is saved instead.
 */
async function shareWin(slotId: string, title: string): Promise<"shared" | "saved"> {
  const res = await fetch(`/api/guest/auction/${slotId}/card?format=story`);
  if (!res.ok) throw new Error("card");
  const blob = await res.blob();
  const file = new File([blob], "betbeat-vencedor.png", { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title });
    return "shared";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "saved";
}

export function WinCelebration({
  slotId,
  trackTitle,
  trackArtist,
  totalCents,
  coverUrl,
  onClose,
}: {
  slotId: string;
  trackTitle: string;
  trackArtist: string;
  totalCents: number;
  coverUrl?: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("guest.auction");
  const reduced = useReducedMotion() ?? false;
  const stage = React.useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = React.useState(false);
  // Leaving: taps go straight through to the page underneath.
  const present = useIsPresent();

  async function share() {
    setSharing(true);
    try {
      if ((await shareWin(slotId, t("shareTitle"))) === "saved") toast({ title: t("shareSaved") });
    } catch (error) {
      // Closing the share sheet is not an error.
      if ((error as Error).name !== "AbortError") toast({ title: t("shareError"), variant: "error" });
    } finally {
      setSharing(false);
    }
  }

  React.useEffect(() => {
    if (reduced || !stage.current) {
      navigator.vibrate?.(WIN_HAPTIC);
      return;
    }
    let stop: (() => void) | null = null;
    let cancelled = false;
    const el = stage.current;
    void import("./win-scene")
      .then(({ startWinScene }) => {
        if (cancelled) return;
        // Harmony: the buzz and the scene's flash start on the same frame.
        navigator.vibrate?.(WIN_HAPTIC);
        stop = startWinScene(el, { coverUrl: coverUrl ?? null });
      })
      .catch(() => navigator.vibrate?.(WIN_HAPTIC));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [reduced, coverUrl]);

  const title = t("winTitle");

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className={`fixed inset-0 z-50 overflow-hidden bg-bg-base text-center${present ? "" : " pointer-events-none"}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.03 }}
      transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
    >
      {/* Reduced motion: a warm still pool. Otherwise the 3D stage paints the whole room. */}
      <div aria-hidden className="ambient-center absolute inset-0" />
      <div ref={stage} aria-hidden className="absolute inset-0" />
      {/* Legibility: the lower half darkens under the words, the stage stays bright above. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-[58%] bg-linear-to-t from-bg-base via-bg-base/80 to-transparent" />

      <div className="relative flex h-full flex-col items-center justify-end gap-6 px-6 pb-[max(env(safe-area-inset-bottom),28px)] [text-shadow:0_2px_14px_rgba(0,0,0,0.7)]">
        <div className="flex flex-col items-center">
          <motion.p
            className="label flex items-center gap-1.5 text-amber-500"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springDefault, delay: 0.25 }}
          >
            <Crown size={16} aria-hidden />
            {t("winEyebrow")}
          </motion.p>
          {/* One word, one gradient: it materializes (scale + focus) and the gold keeps shining. */}
          <motion.h1
            className="leader-name-mine mt-2 pb-1 text-6xl font-bold leading-[1.05] tracking-[-0.03em]"
            initial={reduced ? false : { opacity: 0, scale: 0.8, filter: "blur(14px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            transition={{
              scale: { type: "spring", bounce: 0.25, duration: 0.8, delay: 0.35 },
              opacity: { duration: 0.3, delay: 0.35 },
              filter: { duration: 0.5, delay: 0.35 },
            }}
          >
            {title}
          </motion.h1>
          <motion.p
            className="tnum mt-2 text-5xl font-bold text-text-primary"
            initial={reduced ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springDefault, delay: 0.65 }}
          >
            <span className="sr-only">{formatEurosDisplay(totalCents)}</span>
            <span aria-hidden>
              <CountUp cents={totalCents} delay={0.7} run={!reduced} />
            </span>
          </motion.p>
          <motion.div
            initial={reduced ? false : { y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ ...springDefault, delay: 1.05 }}
          >
            <p className="mt-4 text-xl font-semibold text-text-primary">{trackTitle}</p>
            <p className="text-base text-text-secondary">{trackArtist}</p>
            <p className="mx-auto mt-3 max-w-xs text-sm text-text-secondary">{t("winHint")}</p>
          </motion.div>
        </div>
        <motion.div
          className="flex w-full max-w-xs flex-col gap-2 [text-shadow:none]"
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springDefault, delay: 1.3 }}
        >
          <Button size="lg" fullWidth loading={sharing} onPress={() => void share()}>
            <Instagram size={20} aria-hidden />
            {t("shareInstagram")}
          </Button>
          <Button size="lg" variant="secondary" fullWidth onPress={onClose}>
            {t("winClose")}
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
}
