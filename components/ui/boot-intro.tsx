"use client";

/**
 * Boot intro: the BetBeat mark is cut like a record (the two grooves trace
 * round from twelve o'clock in opposite directions, the label lands), it
 * beats twice like a heart (lub-dub at 120 BPM) with a soft wave and a
 * pulse of red light on each beat, the name rises letter by letter, and the
 * splash lifts off into the page (~2 s, tap to skip).
 *
 * The timeline is CSS keyframes (`.bi-*` in app/globals.css) so it starts
 * with the first paint, before JavaScript: a slow phone never shows a
 * frozen splash. Transform and opacity only, plus two short SVG stroke
 * draws. JavaScript adds the haptics, tap-to-skip and the exit.
 *
 * Once per browser tab: entering a party from "/" or moving between pages
 * never replays it; a reload gets out of the way at once.
 *
 * Haptics: browsers only allow vibration after the person has touched the
 * page, so the beat pattern plays in step when that already happened and
 * otherwise on the first tap during the intro. iOS has no vibration API.
 * Reduced motion: the mark and the name fade in, then out.
 */

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { useTranslations } from "next-intl";
import { MARK } from "./brand-mark";

const SEEN_KEY = "betbeat:intro";
/** From the first paint: when the splash starts to leave. */
const TOTAL_MS = 2000;
const TOTAL_REDUCED_MS = 900;
/** First beat (matches `.bi-mark` animation-delay); the second is 500 ms later. */
const FIRST_BEAT_MS = 850;
// lub (strong) - dub (soft), twice, landing on the visual peaks of `bi-beat`.
const HAPTIC = [35, 145, 25, 295, 35, 145, 25];

const overlay: Variants = {
  show: { opacity: 1 },
  leave: { opacity: 0, transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] } },
};
// The mark lifts towards the viewer as the room fades in behind it.
const lift: Variants = {
  show: { scale: 1, opacity: 1 },
  leave: { scale: 1.14, opacity: 0, transition: { duration: 0.42, ease: [0.4, 0, 1, 1] } },
};
// Same shape as `lift` (the server cannot know the preference: identical markup).
const liftReduced: Variants = {
  show: { scale: 1, opacity: 1 },
  leave: { scale: 1, opacity: 0, transition: { duration: 0.2 } },
};

function seen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Private mode: the intro simply plays again next time.
  }
}

function canVibrate(): boolean {
  const nav = navigator as Navigator & { userActivation?: { hasBeenActive: boolean } };
  return typeof nav.vibrate === "function" && Boolean(nav.userActivation?.hasBeenActive);
}

/** When the CSS timeline started: the first paint (server HTML) or now (client mount). */
function paintStart(fromServer: boolean): number {
  if (!fromServer) return performance.now();
  const fcp = performance.getEntriesByName("first-contentful-paint")[0];
  return fcp ? fcp.startTime : 0;
}

const noopSubscribe = () => () => undefined;

export function BootIntro() {
  const tc = useTranslations("common");
  const reduced = useReducedMotion() ?? false;
  // True only while hydrating server HTML: a client-side mount (moving
  // between pages) knows at once whether the intro was already seen.
  const hydrating = React.useSyncExternalStore(noopSubscribe, () => false, () => true);
  const [origin] = React.useState<"server" | "client-new" | "client-seen">(() =>
    hydrating ? "server" : seen() ? "client-seen" : "client-new",
  );
  const [show, setShow] = React.useState(origin !== "client-seen");
  const buzzed = React.useRef(false);

  const buzz = React.useCallback(() => {
    if (buzzed.current) return;
    buzzed.current = true;
    navigator.vibrate?.(HAPTIC);
  }, []);

  React.useEffect(() => {
    if (origin === "client-seen") return;
    // A reload in the same tab: the splash already showed once, leave now.
    if (origin === "server" && seen()) {
      setShow(false);
      return;
    }
    markSeen();
    const elapsed = performance.now() - paintStart(origin === "server");
    const total = reduced ? TOTAL_REDUCED_MS : TOTAL_MS;
    const done = setTimeout(() => setShow(false), Math.max(0, total - elapsed));
    const toBeat = FIRST_BEAT_MS - elapsed;
    // Harmony: buzz only if it can land on the beat (never late).
    const haptic =
      !reduced && toBeat > -40
        ? setTimeout(() => {
            if (canVibrate()) buzz();
          }, Math.max(0, toBeat))
        : undefined;
    return () => {
      clearTimeout(done);
      if (haptic) clearTimeout(haptic);
    };
  }, [origin, reduced, buzz]);

  const name = tc("appName");

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="boot-intro"
          aria-hidden
          data-testid="boot-intro"
          className="boot-intro fixed inset-0 z-[60] grid place-items-center overflow-hidden bg-bg-base"
          variants={overlay}
          initial={false}
          animate="show"
          exit="leave"
          onPointerDown={() => {
            buzz();
            setShow(false);
          }}
        >
          {/* Steady red light behind the mark, and the flash on each beat. */}
          <span className="bi-bloom pointer-events-none absolute inset-0" />
          <span className="bi-flash pointer-events-none absolute inset-0" />

          <motion.div variants={reduced ? liftReduced : lift} className="bi-content relative flex flex-col items-center">
            <div className="relative size-28">
              <span className="bi-wave" />
              <span className="bi-wave bi-wave-2" />
              <svg viewBox={MARK.viewBox} className="bi-mark absolute inset-0 size-full text-accent-500">
                <g fill="none" stroke="currentColor" transform="rotate(-90 256 256)">
                  <circle
                    className="bi-groove"
                    cx="256"
                    cy="256"
                    r={MARK.outer.r}
                    strokeWidth={MARK.outer.width}
                    opacity={MARK.outer.opacity}
                    pathLength={1}
                  />
                  <circle
                    className="bi-groove bi-groove-ccw"
                    cx="256"
                    cy="256"
                    r={MARK.inner.r}
                    strokeWidth={MARK.inner.width}
                    opacity={MARK.inner.opacity}
                    pathLength={1}
                  />
                </g>
                <circle
                  className="bi-label"
                  cx="256"
                  cy="256"
                  r={MARK.label.r}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={MARK.label.width}
                />
              </svg>
            </div>
            <p className="mt-7 flex overflow-hidden pb-1 text-[2.125rem] font-semibold leading-[1.15] tracking-[-0.024em] text-text-primary">
              {Array.from(name).map((ch, i) => (
                <span key={i} className="bi-letter inline-block" style={{ "--i": i } as React.CSSProperties}>
                  {ch}
                </span>
              ))}
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
