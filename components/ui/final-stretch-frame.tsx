"use client";

/**
 * The last 30 seconds of an auction: the screen edge glows red and beats
 * once per second, on the second the digits roll. In the last 10 seconds
 * each beat becomes the BetBeat heartbeat (lub-dub, like the logo).
 *
 * Opacity only (Web Animations, compositor) — the old box-shadow keyframes
 * repainted the whole viewport every frame. At most two pulses a second,
 * well under the 3 Hz flash limit. Reduced motion: a steady red edge.
 */

import * as React from "react";
import { useReducedMotion } from "motion/react";

const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export function FinalStretchFrame({ secondsLeft }: { secondsLeft: number }) {
  const reduced = useReducedMotion() ?? false;
  const glow = React.useRef<HTMLDivElement>(null);
  const edge = React.useRef<HTMLDivElement>(null);
  const urgent = secondsLeft <= 10;

  React.useEffect(() => {
    if (reduced) return;
    const g = glow.current;
    const e = edge.current;
    if (!g || !e) return;
    const glowFrames: Keyframe[] = urgent
      ? [
          { opacity: 1, offset: 0 },
          { opacity: 0.45, offset: 0.2 },
          { opacity: 0.9, offset: 0.32 },
          { opacity: 0.35, offset: 1 },
        ]
      : [{ opacity: 0.95 }, { opacity: 0.35 }];
    const a = g.animate(glowFrames, { duration: 900, easing: EASE_OUT, fill: "forwards" });
    const b = e.animate([{ opacity: urgent ? 0.9 : 0.6 }, { opacity: 0 }], {
      duration: 420,
      easing: EASE_OUT,
      fill: "forwards",
    });
    return () => {
      a.cancel();
      b.cancel();
    };
  }, [secondsLeft, urgent, reduced]);

  return (
    <div aria-hidden className="auction-flash-frame">
      <div ref={glow} className="auction-flash-glow" />
      <div ref={edge} className="auction-flash-edge" />
    </div>
  );
}
