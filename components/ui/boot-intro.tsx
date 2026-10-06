"use client";

/**
 * Boot intro: the BetBeat mark beats twice like a heart (lub-dub at
 * 120 BPM), each beat sends a ring out like a sound wave, the name lands,
 * and the splash dissolves into the page (~2 s, tap to skip).
 *
 * Haptics: browsers only allow vibration after the person has touched the
 * page, so the beat pattern plays at once when that already happened and
 * otherwise on the first tap during the intro. iOS has no vibration API.
 * Reduced motion: a short fade, no scale or rings.
 */

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";

const BEAT_S = 0.5; // 120 BPM
const FIRST_BEAT_S = 0.35;
const TOTAL_MS = 2000;
// lub (strong) — dub (soft), twice, in step with the visual beats.
const HAPTIC = [35, 90, 20, 355, 35, 90, 20];

function canVibrate(): boolean {
  const nav = navigator as Navigator & { userActivation?: { hasBeenActive: boolean } };
  return typeof nav.vibrate === "function" && Boolean(nav.userActivation?.hasBeenActive);
}

export function BootIntro() {
  const tc = useTranslations("common");
  const reduced = useReducedMotion() ?? false;
  const [show, setShow] = React.useState(true);
  const buzzed = React.useRef(false);

  const buzz = React.useCallback(() => {
    if (buzzed.current) return;
    buzzed.current = true;
    navigator.vibrate?.(HAPTIC);
  }, []);

  React.useEffect(() => {
    const done = setTimeout(() => setShow(false), reduced ? 900 : TOTAL_MS);
    const haptic = setTimeout(() => {
      if (canVibrate()) buzz();
    }, FIRST_BEAT_S * 1000);
    return () => {
      clearTimeout(done);
      clearTimeout(haptic);
    };
  }, [reduced, buzz]);

  // Two beats: quick swell, settle, smaller swell, settle.
  const beatTimes = (start: number) => [start, start + 0.08, start + 0.18, start + 0.26, start + 0.36];
  const t1 = beatTimes(FIRST_BEAT_S);
  const t2 = beatTimes(FIRST_BEAT_S + BEAT_S);
  const duration = t2[4]!;
  const times = [0, 0.25, ...t1, ...t2].map((x) => x / duration);

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="boot-intro"
          aria-hidden
          data-testid="boot-intro"
          className="boot-intro fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-bg-base"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: reduced ? 0.25 : 0.35 } }}
          onPointerDown={() => {
            buzz();
            setShow(false);
          }}
        >
          <div className="relative size-40">
            {/* Same markup with and without reduced motion (no hydration
                mismatch): the rings simply stay invisible when reduced. */}
            {[FIRST_BEAT_S, FIRST_BEAT_S + BEAT_S].map((delay) => (
              <motion.span
                key={delay}
                className="absolute inset-0 rounded-full border-2 border-accent-500"
                initial={{ scale: 0.55, opacity: 0 }}
                animate={reduced ? { opacity: 0 } : { scale: [0.55, 1.9], opacity: [0.7, 0] }}
                transition={{ duration: 0.9, delay, ease: "easeOut" }}
              />
            ))}
            <motion.svg
              viewBox="0 0 512 512"
              className="absolute inset-0 size-full"
              initial={{ opacity: 0 }}
              animate={
                reduced
                  ? { opacity: 1 }
                  : { opacity: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], scale: [0.6, 1, 1, 1.14, 1, 1.07, 1, 1, 1.14, 1, 1.07, 1] }
              }
              transition={reduced ? { duration: 0.4 } : { duration, times, ease: "easeInOut" }}
            >
              <circle cx="256" cy="256" r="150" fill="none" className="stroke-accent-500" strokeWidth="22" opacity="0.35" />
              <circle cx="256" cy="256" r="104" fill="none" className="stroke-accent-500" strokeWidth="24" opacity="0.7" />
              <circle cx="256" cy="256" r="58" className="fill-accent-500" />
              <circle cx="256" cy="256" r="20" className="fill-bg-base" />
            </motion.svg>
          </div>
          <motion.p
            className="text-[2rem] font-bold leading-none tracking-[var(--tracking-display)] text-text-primary"
            initial={{ opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: [12, 0] }}
            transition={{ delay: reduced ? 0.2 : 1.15, duration: 0.4, ease: "easeOut" }}
          >
            {tc("appName")}
          </motion.p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
