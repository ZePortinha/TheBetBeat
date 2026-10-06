/**
 * Transition assistant — PURE (2026-10-06).
 *
 * How hard is it for the DJ to mix a requested track out of the one
 * playing now? Beatmatching works by nudging the tempo: a few percent is
 * routine, beyond the usual pitch range (±8 %) it needs a cut, an effect
 * or a breakdown. Half/double time counts as a match (64 ↔ 128 BPM), and
 * when both keys are known, a clash on the Camelot wheel makes it one
 * step harder. Harder transitions start at a higher price (club rules).
 */
import { isCamelotCompatible, parseCamelot } from "@/lib/catalog/camelot";
import type { AuctionConfig } from "./config";

export type TransitionLevel = "easy" | "medium" | "hard" | "unknown";

export interface Tempo {
  bpm: number | null;
  camelotKey: string | null;
}

export interface TransitionAssessment {
  level: TransitionLevel;
  /** Tempo change the DJ has to make, % (after half/double time). */
  deltaPct: number | null;
  /** How the tempos line up: same, the track at half or at double time. */
  mode: "same" | "half" | "double" | null;
  /** null when a key is unknown. */
  keyMatch: boolean | null;
  /** Nothing is playing: any track can open. */
  nothingPlaying: boolean;
  multiplierBps: number;
}

const HARDER: Record<Exclude<TransitionLevel, "unknown">, Exclude<TransitionLevel, "unknown">> = {
  easy: "medium",
  medium: "hard",
  hard: "hard",
};

export function assessTransition(
  track: Tempo,
  current: Tempo | null,
  rules: AuctionConfig["transition"],
): TransitionAssessment {
  const result = (level: TransitionLevel, extra: Partial<TransitionAssessment> = {}): TransitionAssessment => ({
    level,
    deltaPct: null,
    mode: null,
    keyMatch: null,
    nothingPlaying: false,
    ...extra,
    multiplierBps: rules[`${level}Bps`],
  });

  if (!current || current.bpm === null || current.bpm <= 0) return result("easy", { nothingPlaying: !current });
  if (track.bpm === null || track.bpm <= 0) return result("unknown");

  const ratio = track.bpm / current.bpm;
  const options = [
    { mode: "same" as const, delta: Math.abs(ratio - 1) },
    { mode: "half" as const, delta: Math.abs(ratio * 2 - 1) },
    { mode: "double" as const, delta: Math.abs(ratio / 2 - 1) },
  ];
  const best = options.reduce((a, b) => (b.delta < a.delta ? b : a));
  const deltaPct = Math.round(best.delta * 1000) / 10;

  let level: Exclude<TransitionLevel, "unknown"> =
    deltaPct <= rules.easyMaxPct ? "easy" : deltaPct <= rules.mediumMaxPct ? "medium" : "hard";

  const a = parseCamelot(track.camelotKey);
  const b = parseCamelot(current.camelotKey);
  const keyMatch = a && b ? isCamelotCompatible(a, b) : null;
  if (keyMatch === false) level = HARDER[level];

  return result(level, { deltaPct, mode: best.mode, keyMatch });
}

/** A track's starting price in this auction: its minimum × the difficulty multiplier, up to 0,50 €. */
export function startingPriceCents(slotMinCents: number, multiplierBps: number): number {
  const raw = Math.ceil((slotMinCents * multiplierBps) / 10_000);
  return Math.max(slotMinCents, Math.ceil(raw / 50) * 50);
}
