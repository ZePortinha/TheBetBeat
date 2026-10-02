"use client";

/**
 * PriceTag — odometer price display (BRIEF B10.5 / B10.6 anim 2).
 * Digits roll vertically on change (tween `slow` 480ms, ease `standard`);
 * no up/down colors — the motion itself explains the change.
 * Reduced motion: crossfade only (120ms).
 */

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, type CSSProperties } from "react";
import { durations, easeStandard } from "@/lib/motion";

export type PriceTagSize = "md" | "lg" | "display";

/** Editorial serif applies only to monetary values ≥ 28px (B10.3). */
export const EDITORIAL_MIN_PX = 28;

const EASING: [number, number, number, number] = [...easeStandard];

const NBSP = " ";

/**
 * Pure pt-PT euro display formatter: 1200 → "12 €", 1250 → "12,50 €".
 * Whole euros drop the decimals; otherwise two decimals with a comma.
 * The space before "€" is non-breaking. Money is integer cents.
 */
export function formatEurosDisplay(cents: number): string {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const euros = Math.floor(abs / 100);
  const rem = abs % 100;
  const body =
    rem === 0 ? `${euros}` : `${euros},${String(rem).padStart(2, "0")}`;
  return `${sign}${body}${NBSP}€`;
}

/** Size recipes (type scale + tracking-by-size, B10.3). */
const SIZE_STYLES: Record<PriceTagSize, CSSProperties> = {
  md: {
    fontSize: "var(--text-20)",
    letterSpacing: "var(--tracking-body)",
    fontWeight: 600,
  },
  lg: {
    fontSize: "var(--text-32)",
    letterSpacing: "var(--tracking-heading)",
    fontWeight: 600,
  },
  display: {
    // 56px ≥ EDITORIAL_MIN_PX → editorial serif (Instrument Serif, 400).
    fontSize: "var(--text-56)",
    letterSpacing: "var(--tracking-display)",
    fontWeight: 400,
    fontFamily: "var(--font-editorial)",
  },
};

interface Cell {
  key: string;
  ch: string;
  digit: number | null;
}

/**
 * Split the formatted price into keyed cells so digit columns keep their
 * identity across changes. Integer digits are keyed by their distance from
 * the decimal boundary (right-aligned: "9 €" → "10 €" rolls 9→0 and grows a
 * column); the fraction/suffix is keyed from the boundary onwards.
 */
function toCells(text: string): Cell[] {
  const chars = Array.from(text);
  const comma = chars.indexOf(",");
  const boundary = comma === -1 ? chars.indexOf(NBSP) : comma;
  return chars.map((ch, idx) => {
    const digit = ch >= "0" && ch <= "9" ? ch.charCodeAt(0) - 48 : null;
    if (idx < boundary) {
      const place = boundary - idx;
      return digit === null
        ? { key: `si${place}-${ch}`, ch, digit }
        : { key: `i${place}`, ch, digit };
    }
    const place = idx - boundary;
    return digit === null
      ? { key: `sf${place}-${ch}`, ch, digit }
      : { key: `f${place}`, ch, digit };
  });
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function RollingDigit({ digit, animated }: { digit: number; animated: boolean }) {
  return (
    <span
      className="inline-block overflow-hidden align-baseline"
      style={{ height: "1em", lineHeight: 1 }}
    >
      <motion.span
        className="block"
        style={{ willChange: "transform" }}
        initial={animated ? false : { y: `${-digit}em` }}
        animate={{ y: `${-digit}em` }}
        transition={{ duration: durations.slow, ease: EASING }}
      >
        {DIGITS.map((d) => (
          <span key={d} className="block" style={{ height: "1em", lineHeight: 1 }}>
            {d}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

export interface PriceTagProps {
  /** Money is ALWAYS integer cents. */
  cents: number;
  size?: PriceTagSize;
  /** Gold marks money (B10.2); "inherit" defers to the surrounding text. */
  tone?: "gold" | "inherit";
  className?: string;
}

export function PriceTag({
  cents,
  size = "md",
  tone = "gold",
  className,
}: PriceTagProps) {
  const reducedMotion = useReducedMotion() ?? false;
  // New cells fade in only after mount — never on the first paint.
  const mounted = useRef(false);
  const isFirstRender = !mounted.current;
  useEffect(() => {
    mounted.current = true;
  }, []);

  const text = formatEurosDisplay(cents);
  const style: CSSProperties = {
    ...SIZE_STYLES[size],
    lineHeight: 1,
    ...(tone === "gold" ? { color: "var(--color-gold-500)" } : {}),
  };

  const rootClass = ["tnum relative inline-flex", className]
    .filter(Boolean)
    .join(" ");

  if (reducedMotion) {
    // Reduced motion: a short crossfade instead of the odometer roll.
    return (
      <span className={rootClass} style={style}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={text}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: EASING }}
          >
            {text}
          </motion.span>
        </AnimatePresence>
      </span>
    );
  }

  return (
    <span className={rootClass} style={style}>
      {/* Plain value for assistive tech; the odometer machinery is hidden. */}
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-flex whitespace-pre">
        <AnimatePresence initial={false} mode="popLayout">
          {toCells(text).map((cell) => (
            <motion.span
              key={cell.key}
              className="inline-block"
              initial={isFirstRender ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: durations.fast, ease: EASING }}
            >
              {cell.digit === null ? (
                <span className="inline-block" style={{ height: "1em", lineHeight: 1 }}>
                  {cell.ch}
                </span>
              ) : (
                <RollingDigit digit={cell.digit} animated={!isFirstRender} />
              )}
            </motion.span>
          ))}
        </AnimatePresence>
      </span>
    </span>
  );
}
