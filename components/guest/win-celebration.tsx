"use client";

/**
 * "Vencedor" — the moment a guest's bid wins, built to be filmed: the
 * record rises with three beat rings, the amount and the track land on
 * the same frame as the vibration (caller). Reduced motion: static.
 */

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { Disc } from "@/components/ui/disc";
import { Button } from "@/components/ui/button";
import { formatEurosDisplay } from "@/components/ui/price-tag";

export function WinCelebration({
  trackTitle,
  trackArtist,
  totalCents,
  onClose,
}: {
  trackTitle: string;
  trackArtist: string;
  totalCents: number;
  onClose: () => void;
}) {
  const t = useTranslations("guest.auction");
  const reduced = useReducedMotion() ?? false;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("winTitle")}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-bg-base px-6 text-center"
    >
      <div aria-hidden className="ambient-center absolute inset-0 -z-10" />
      <div className="relative flex size-56 items-center justify-center">
        {!reduced
          ? [0, 1, 2].map((i) => (
              <motion.span
                key={i}
                aria-hidden
                className="absolute inset-0 rounded-full border-2 border-accent-500"
                initial={{ scale: 0.6, opacity: 0.8 }}
                animate={{ scale: 1.6 + i * 0.3, opacity: 0 }}
                transition={{ duration: 1.2, delay: i * 0.15, repeat: 2, ease: "easeOut" }}
              />
            ))
          : null}
        <motion.div
          className="size-48"
          initial={reduced ? false : { scale: 0.4, rotate: -40, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: "spring", bounce: 0.35, duration: 0.8 }}
        >
          <Disc initials="BB" className="size-48" />
        </motion.div>
      </div>
      <motion.div
        initial={reduced ? false : { y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", bounce: 0, duration: 0.5, delay: 0.2 }}
      >
        <p className="label text-accent-400">{t("winEyebrow")}</p>
        <h1 className="mt-2 text-[clamp(2.75rem,14vw,4rem)] font-bold leading-none tracking-[var(--tracking-display)] text-text-primary">
          {t("winTitle")}
        </h1>
        <p className="tnum mt-4 text-4xl font-bold text-accent-400">{formatEurosDisplay(totalCents)}</p>
        <p className="mt-3 text-xl font-semibold text-text-primary">{trackTitle}</p>
        <p className="text-base text-text-secondary">{trackArtist}</p>
        <p className="mt-4 text-sm text-text-secondary">{t("winHint")}</p>
      </motion.div>
      <Button size="lg" onPress={onClose}>
        {t("winClose")}
      </Button>
    </div>
  );
}
