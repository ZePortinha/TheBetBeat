"use client";

/**
 * "Vencedor" — the moment a guest's bid wins, built to be filmed: the 3D
 * stage (win-scene: flash, the vinyl with their album art, champagne,
 * confetti, bloom) behind the title flipping in letter by letter in gold
 * and the amount counting up. three.js loads only now. Reduced motion: a
 * still, calm version of the same screen.
 */

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatEurosDisplay } from "@/components/ui/price-tag";

function useCountUp(target: number, ms: number, run: boolean): number {
  const [value, setValue] = React.useState(run ? 0 : target);
  React.useEffect(() => {
    if (!run) return;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      setValue(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, run]);
  return value;
}

export function WinCelebration({
  trackTitle,
  trackArtist,
  totalCents,
  coverUrl,
  onClose,
}: {
  trackTitle: string;
  trackArtist: string;
  totalCents: number;
  coverUrl?: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("guest.auction");
  const reduced = useReducedMotion() ?? false;
  const stage = React.useRef<HTMLDivElement>(null);
  const amount = useCountUp(totalCents, 1100, !reduced);

  React.useEffect(() => {
    if (reduced || !stage.current) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    const el = stage.current;
    void import("./win-scene").then(({ startWinScene }) => {
      if (!cancelled) stop = startWinScene(el, { coverUrl: coverUrl ?? null });
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [reduced, coverUrl]);

  const title = t("winTitle");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 overflow-hidden bg-bg-base text-center"
    >
      {/* Reduced motion: a warm still pool. Otherwise the 3D stage paints the whole room. */}
      <div aria-hidden className="ambient-center absolute inset-0" />
      <div ref={stage} aria-hidden className="absolute inset-0" />

      <div className="relative flex h-full flex-col items-center justify-end gap-5 px-6 pb-[max(env(safe-area-inset-bottom),28px)] [text-shadow:0_2px_18px_rgba(0,0,0,0.85)]">
        <div className="flex flex-col items-center">
          <p className="label flex items-center gap-1.5 text-amber-500">
            <Crown size={16} aria-hidden />
            {t("winEyebrow")}
          </p>
          <h1 className="mt-2 flex text-5xl font-bold [perspective:600px]" aria-label={title}>
            {[...title].map((ch, i) => (
              <motion.span
                key={i}
                aria-hidden
                className="leader-name-mine inline-block"
                initial={reduced ? false : { rotateX: -100, y: 30, opacity: 0 }}
                animate={{ rotateX: 0, y: 0, opacity: 1 }}
                transition={{ type: "spring", bounce: 0.45, duration: 0.7, delay: 0.45 + i * 0.05 }}
              >
                {ch === " " ? " " : ch}
              </motion.span>
            ))}
          </h1>
          <motion.p
            className="tnum mt-3 text-5xl font-bold text-text-primary"
            initial={reduced ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", bounce: 0.5, duration: 0.6, delay: 0.7 }}
          >
            {formatEurosDisplay(amount)}
          </motion.p>
          <motion.div
            initial={reduced ? false : { y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.4, delay: 1.1 }}
          >
            <p className="mt-3 text-xl font-semibold text-text-primary">{trackTitle}</p>
            <p className="text-base text-text-secondary">{trackArtist}</p>
            <p className="mt-3 text-sm text-text-secondary">{t("winHint")}</p>
          </motion.div>
        </div>
        <motion.div
          className="w-full max-w-xs"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 1.4 }}
        >
          <Button size="lg" fullWidth onPress={onClose}>
            {t("winClose")}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
