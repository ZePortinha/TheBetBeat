"use client";

/**
 * Boot intro (2026-10-29, owner's brief): "Control the disco" lands word by
 * word, "the" steps out, "disco" and "Control" swap places, then slide into
 * each other so the "co" they share becomes one and the name reads
 * Discontrol. The mark arrives beside it with its knob turning up, the
 * slogan settles under it and the splash dissolves into the page
 * (~3.6 s, tap to skip).
 *
 * The words are the brand itself, so they live here (like the bottle label)
 * rather than in messages. Decorative: hidden from screen readers.
 *
 * Every move is a critically damped spring on position only (no overshoot:
 * nothing was flicked), so text never squashes. The knob turn alone has a
 * little bounce, as a real knob does when let go.
 *
 * Haptics: one short click when the two words lock together. Browsers only
 * allow vibration after the person has touched the page, so it fires then
 * or on the first tap. iOS has no vibration API.
 * Reduced motion: the finished lockup fades in, holds, fades out.
 * Plays once per tab: later loads skip it before first paint.
 */

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import { useTranslations } from "next-intl";
import { MarkGrooves, MarkKnob } from "./brand-mark";

type Stage = "phrase" | "split" | "merge" | "lockup";

/** When each stage starts, ms from mount. */
const AT = { split: 1250, merge: 2000, lockup: 2550, done: 3600 } as const;
const HAPTIC = [14, 50, 22];

const move: Transition = { type: "spring", bounce: 0, duration: 0.6 };
const turn: Transition = { type: "spring", bounce: 0.25, duration: 0.7 };

function canVibrate(): boolean {
  const nav = navigator as Navigator & { userActivation?: { hasBeenActive: boolean } };
  return typeof nav.vibrate === "function" && Boolean(nav.userActivation?.hasBeenActive);
}

/** One piece of the words; the same element moves between stages. */
function Piece({
  children,
  className = "",
  delay = 0,
  style,
  pieceRef,
  arc = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  style?: React.CSSProperties;
  pieceRef?: React.Ref<HTMLSpanElement>;
  /** While the words swap: -1 passes over, 1 passes under, 0 stays level. */
  arc?: number;
}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.span
      ref={pieceRef}
      layout="position"
      className={`inline-block ${className}`}
      style={style}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: "0.25em", filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 0.85, filter: "blur(6px)", transition: { duration: 0.2 } }}
      transition={{ layout: move, default: { duration: 0.55, delay, ease: [0.2, 0, 0, 1] } }}
    >
      {/* The arc lives on its own layer: the outer one belongs to layout. */}
      <motion.span
        className="inline-block"
        animate={
          arc && !reduced
            ? { y: ["0em", `${0.5 * arc}em`, `${0.5 * arc}em`, "0em"], opacity: [1, arc < 0 ? 1 : 0.45, arc < 0 ? 1 : 0.45, 1] }
            : { y: 0, opacity: 1 }
        }
        // Up (or down) before the words meet, level again once they have passed.
        transition={{ duration: 0.65, times: [0, 0.2, 0.45, 1], ease: "easeInOut" }}
      >
        {children}
      </motion.span>
    </motion.span>
  );
}

function Lockup({ stage }: { stage: Stage }) {
  const merged = stage === "merge" || stage === "lockup";
  // Control's "Co" lands exactly on Disco's "co": it takes that piece's
  // width and pulls back by it, so "ntrol" closes up behind it.
  const coRef = React.useRef<HTMLSpanElement>(null);
  const [coWidth, setCoWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    if (stage === "split" && coRef.current) setCoWidth(coRef.current.offsetWidth);
  }, [stage]);

  const pieces: React.ReactNode[] = [];
  if (stage === "lockup") {
    pieces.push(
      <motion.span
        key="mark"
        layout="position"
        className="relative mr-[0.3em] inline-block size-[1.15em]"
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ layout: move, default: move }}
      >
        <svg viewBox="0 0 512 512" className="absolute inset-0 size-full">
          <MarkGrooves />
        </svg>
        <motion.svg
          viewBox="0 0 512 512"
          className="absolute inset-0 size-full"
          initial={{ rotate: -130 }}
          animate={{ rotate: 0 }}
          transition={{ ...turn, delay: 0.08 }}
        >
          <MarkKnob />
        </motion.svg>
      </motion.span>,
    );
  }
  // DOM order never changes (AnimatePresence would remount moved children);
  // the phrase order comes from flex `order`, and layout animates the swap.
  const phrase = stage === "phrase";
  const order = (n: number): React.CSSProperties | undefined => (phrase ? { order: n } : undefined);
  // Disco passes over, Control under, so the words never cut through each other.
  const swapping = stage === "split";
  const dis = (
    <Piece key="dis" delay={0.3} style={order(3)} arc={swapping ? -1 : 0}>
      {stage === "phrase" ? "dis" : "Dis"}
    </Piece>
  );
  const co1 = (
    <Piece key="co-1" delay={0.3} pieceRef={coRef} style={order(4)} arc={swapping ? -1 : 0}>
      <motion.span
        className="inline-block"
        animate={merged ? { color: ["#f5f5f7", "#ff453a", "#ff453a", "#f5f5f7"] } : undefined}
        transition={{ duration: 1.1, times: [0, 0.2, 0.6, 1] }}
      >
        co
      </motion.span>
    </Piece>
  );
  const co2 = (
    <Piece
      key="co-2"
      arc={swapping ? 1 : 0}
      className={stage === "split" ? "ml-[0.28em]" : ""}
      style={merged ? { width: coWidth, marginLeft: -coWidth } : order(0)}
    >
      <motion.span
        className="inline-block"
        animate={merged ? { opacity: 0, filter: "blur(4px)" } : { opacity: 1 }}
        transition={{ duration: 0.45, delay: merged ? 0.2 : 0 }}
      >
        Co
      </motion.span>
    </Piece>
  );
  const ntrol = (
    <Piece key="ntrol" style={order(1)} arc={swapping ? 1 : 0}>
      ntrol
    </Piece>
  );
  pieces.push(dis, co1);
  if (phrase) {
    pieces.push(
      <Piece key="the" className="px-[0.26em]" delay={0.15} style={order(2)}>
        the
      </Piece>,
    );
  }
  pieces.push(co2, ntrol);

  return (
    <span className="flex items-center whitespace-pre text-[clamp(2.25rem,10vw,3.5rem)] font-bold leading-none tracking-[-0.025em] text-text-primary">
      <AnimatePresence mode="popLayout" initial>
        {pieces}
      </AnimatePresence>
    </span>
  );
}

export function BootIntro() {
  const tc = useTranslations("common");
  const reduced = useReducedMotion() ?? false;
  const [show, setShow] = React.useState(true);
  const [stage, setStage] = React.useState<Stage>("phrase");
  const buzzed = React.useRef(false);

  const buzz = React.useCallback(() => {
    if (buzzed.current) return;
    buzzed.current = true;
    navigator.vibrate?.(HAPTIC);
  }, []);

  React.useEffect(() => {
    // Already played in this tab (flag read before paint in app/layout.tsx).
    if (document.documentElement.dataset.intro === "seen") {
      setShow(false);
      return;
    }
    try {
      sessionStorage.setItem("bb-intro", "1");
    } catch {
      // Storage blocked (private mode): the intro simply plays again.
    }
    if (reduced) {
      const done = setTimeout(() => setShow(false), 1100);
      return () => clearTimeout(done);
    }
    const timers = [
      setTimeout(() => setStage("split"), AT.split),
      setTimeout(() => setStage("merge"), AT.merge),
      // The click lands as the two words lock.
      setTimeout(() => {
        if (canVibrate()) buzz();
      }, AT.merge + 380),
      setTimeout(() => setStage("lockup"), AT.lockup),
      setTimeout(() => setShow(false), AT.done),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reduced, buzz]);

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="boot-intro"
          aria-hidden
          data-testid="boot-intro"
          className="boot-intro fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-bg-base"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: reduced ? 0.25 : 0.45, delay: reduced ? 0 : 0.06 } }}
          onPointerDown={() => {
            buzz();
            setShow(false);
          }}
        >
          {/* Leaving: the lockup comes a little towards you as the black lifts. */}
          <motion.div
            className="flex flex-col items-center gap-5"
            initial={reduced ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            exit={reduced ? { opacity: 0 } : { scale: 1.08, opacity: 0, filter: "blur(6px)", transition: { duration: 0.42, ease: [0.4, 0, 1, 1] } }}
          >
            <Lockup stage={reduced ? "lockup" : stage} />
            <motion.p
              className="text-[0.9375rem] font-medium tracking-[0.01em] text-text-secondary"
              initial={{ opacity: 0 }}
              animate={{ opacity: reduced || stage === "lockup" ? 1 : 0, y: reduced || stage === "lockup" ? 0 : 6 }}
              transition={{ duration: 0.45, delay: reduced ? 0 : 0.25, ease: [0.2, 0, 0, 1] }}
            >
              {tc("slogan")}
            </motion.p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
