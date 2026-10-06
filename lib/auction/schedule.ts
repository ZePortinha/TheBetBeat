/**
 * The night's auction slots, planned from the club's phases (PURE).
 *
 * Each slot is defined by the moment its auction CLOSES: bidding opens
 * `auctionDurationSec` before (specials: `openMinutesBefore`), the DJ
 * should play the winner within `playTargetMin` after the close and the
 * money comes back at `refundAfterMin`. Regular slots are spread evenly
 * inside each phase; specials take the place of any regular slot closing
 * within `minGapMin` of them. The whole night must stay under the club's
 * share of songs (~15% by default) — `withinCap` reports it. The night's
 * first auction takes bids from the opening (club option), so it is the
 * longest one.
 */
import type { AuctionConfig, PhaseName } from "./config";
import { nextWallClock, nightAnchor } from "./time";

const MIN_MS = 60_000;

export type SlotKind = "regular" | "first_peak" | "last_song";

export interface PlannedSlot {
  kind: SlotKind;
  phase: PhaseName;
  opensAtMs: number;
  closesAtMs: number;
  minPriceCents: number;
}

export interface NightPlan {
  slots: PlannedSlot[];
  /** Songs the DJ plays in the night at the club's pace. */
  estimatedSongs: number;
  /** Slots allowed by the club's maximum share. */
  maxSlots: number;
  withinCap: boolean;
}

interface PhaseWindow {
  name: PhaseName;
  startMs: number;
  endMs: number;
  slotsPerHour: number;
  minPriceCents: number;
}

/** Phase windows clipped to the night, in order, never overlapping. */
export function phaseWindows(nightStartMs: number, nightEndMs: number, config: AuctionConfig): PhaseWindow[] {
  // Read each phase time forward from the previous one, starting at the
  // night's noon: order survives midnight and late openings.
  let cursor = nightAnchor(nightStartMs, config.timezone);
  const starts = config.phases.map((p) => {
    if (p.start === null) return nightStartMs;
    cursor = nextWallClock(cursor, p.start, config.timezone);
    return cursor;
  });
  const windows: PhaseWindow[] = [];
  config.phases.forEach((p, i) => {
    const startMs = Math.max(nightStartMs, starts[i] as number);
    const endMs = Math.min(nightEndMs, starts[i + 1] ?? nightEndMs);
    if (endMs > startMs) {
      windows.push({ name: p.name, startMs, endMs, slotsPerHour: p.slotsPerHour, minPriceCents: p.minPriceCents });
    }
  });
  return windows;
}

/** Which phase is running at `atMs` (null outside the night). */
export function phaseAt(atMs: number, nightStartMs: number, nightEndMs: number, config: AuctionConfig): PhaseName | null {
  return phaseWindows(nightStartMs, nightEndMs, config).find((w) => atMs >= w.startMs && atMs < w.endMs)?.name ?? null;
}

export function planNight(nightStartMs: number, nightEndMs: number, config: AuctionConfig): NightPlan {
  const windows = phaseWindows(nightStartMs, nightEndMs, config);
  const phaseOf = (atMs: number): PhaseName =>
    windows.find((w) => atMs >= w.startMs && atMs < w.endMs)?.name ?? windows[windows.length - 1]?.name ?? "close";
  const auctionMs = config.auctionDurationSec * 1000;

  const specials: PlannedSlot[] = [];
  const { firstPeak, lastSong } = config.specials;
  if (firstPeak.enabled) {
    const closesAtMs = nextWallClock(nightAnchor(nightStartMs, config.timezone), firstPeak.at, config.timezone);
    if (closesAtMs > nightStartMs && closesAtMs < nightEndMs) {
      specials.push({
        kind: "first_peak",
        phase: phaseOf(closesAtMs),
        opensAtMs: Math.max(nightStartMs, closesAtMs - firstPeak.openMinutesBefore * MIN_MS),
        closesAtMs,
        minPriceCents: firstPeak.minPriceCents,
      });
    }
  }
  if (lastSong.enabled) {
    const closesAtMs = nightEndMs - lastSong.minutesBeforeEnd * MIN_MS;
    if (closesAtMs > nightStartMs) {
      specials.push({
        kind: "last_song",
        phase: phaseOf(closesAtMs),
        opensAtMs: Math.max(nightStartMs, closesAtMs - lastSong.openMinutesBefore * MIN_MS),
        closesAtMs,
        minPriceCents: lastSong.minPriceCents,
      });
    }
  }

  const gapMs = config.minGapMin * MIN_MS;
  const regular: PlannedSlot[] = [];
  for (const w of windows) {
    if (w.slotsPerHour <= 0) continue;
    const intervalMs = (60 / w.slotsPerHour) * MIN_MS;
    for (let closesAtMs = w.startMs; closesAtMs < w.endMs; closesAtMs += intervalMs) {
      const clashes = [...specials, ...regular].some((s) => Math.abs(s.closesAtMs - closesAtMs) < gapMs);
      // The last-song special is the final word: nothing regular after it.
      const afterLastSong = specials.some((s) => s.kind === "last_song" && closesAtMs > s.closesAtMs);
      if (clashes || afterLastSong) continue;
      regular.push({
        kind: "regular",
        phase: w.name,
        opensAtMs: Math.max(nightStartMs, closesAtMs - auctionMs),
        closesAtMs,
        minPriceCents: w.minPriceCents,
      });
    }
  }

  const slots = [...specials, ...regular].sort((a, b) => a.closesAtMs - b.closesAtMs);
  if (config.firstAuctionFromStart && slots[0]) slots[0] = { ...slots[0], opensAtMs: nightStartMs };
  const estimatedSongs = Math.floor(((nightEndMs - nightStartMs) / (60 * MIN_MS)) * config.songsPerHour);
  const maxSlots = Math.floor((estimatedSongs * config.maxAuctionShareBps) / 10_000);
  return { slots, estimatedSongs, maxSlots, withinCap: slots.length <= maxSlots };
}
