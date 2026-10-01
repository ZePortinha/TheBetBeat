/**
 * Motion tokens (BRIEF B10.6) for the Motion library.
 * Springs: bounce only when the gesture carried momentum — never on
 * elements that merely appear. Tweens: opacity/color only, never gestures.
 */
import type { Transition } from "motion/react";

export const springDefault: Transition = {
  type: "spring",
  bounce: 0,
  duration: 0.35,
};

export const springMove: Transition = {
  type: "spring",
  bounce: 0,
  duration: 0.4,
};

export const springSheet: Transition = {
  type: "spring",
  bounce: 0.2,
  duration: 0.3,
};

export const springMomentum: Transition = {
  type: "spring",
  bounce: 0.2,
  duration: 0.4,
};

export const durations = {
  instant: 0.1,
  fast: 0.18,
  base: 0.28,
  slow: 0.48,
  ambient: 1.6,
} as const;

export const easeStandard = [0.2, 0, 0, 1] as const;
export const easeStandardReverse = [1, 0, 0.8, 1] as const;

/**
 * Momentum projection (apple-design §6): where a flick is going,
 * using iOS's exponential-decay form — NOT v²/2a.
 */
export function project(initialVelocity: number, decelerationRate = 0.998): number {
  return ((initialVelocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Rubber-band resistance past a boundary (apple-design §9). */
export function rubberband(
  overshoot: number,
  dimension: number,
  constant = 0.55,
): number {
  return (
    (overshoot * dimension * constant) /
    (dimension + constant * Math.abs(overshoot))
  );
}
