/**
 * Auction configuration per club (2026-10-05, slot auctions replace the
 * QUEUE/SOON/NEXT tiers). Every number here is a club default, stored on
 * the venue and snapshotted onto each night; nothing is fixed in code.
 *
 * Same discipline as lib/domain/config: wrong types throw, insane values
 * are clamped, and the result is always a complete, sane config.
 */
import { z } from "zod";

export const PHASE_NAMES = ["warmup", "ramp", "peak", "close"] as const;
export type PhaseName = (typeof PHASE_NAMES)[number];

export interface AuctionPhase {
  name: PhaseName;
  /** Local wall-clock start "HH:MM"; null = the night's opening. */
  start: string | null;
  /** 0 = no auctions in this phase. */
  slotsPerHour: number;
  minPriceCents: number;
}

export interface SpecialSlotConfig {
  enabled: boolean;
  minPriceCents: number;
  /** Bidding opens this long before the slot closes. */
  openMinutesBefore: number;
}

export interface AuctionConfig {
  timezone: string;
  /** Phases in night order; each lasts until the next one (or the night end). */
  phases: AuctionPhase[];
  specials: {
    /** "Primeira música do pico", closing at `at`. */
    firstPeak: SpecialSlotConfig & { at: string };
    /** "Última música da noite", closing this long before the night ends. */
    lastSong: SpecialSlotConfig & { minutesBeforeEnd: number };
  };
  /** Slot auctions must stay under this share of the night's songs. */
  songsPerHour: number;
  maxAuctionShareBps: number;
  /** Regular slots never close closer than this to another slot. */
  minGapMin: number;
  auctionDurationSec: number;
  /** The night's first auction takes bids from the opening (the longest one). */
  firstAuctionFromStart: boolean;
  softClose: { windowSec: number; extendSec: number; maxExtraSec: number };
  /** Every new bid beats the top by max(minIncrementCents, top × bps). */
  minIncrementCents: number;
  minIncrementBps: number;
  quickBidStepsCents: [number, number, number];
  /** Safety cap per bid (fraud, typos); not a spending target. */
  maxBidCents: number;
  lastMinuteWarningSec: number;
  /** After the auction closes: the DJ should play by `playTargetMin`; refund at `refundAfterMin`. */
  playTargetMin: number;
  refundAfterMin: number;
  /**
   * Days each euro of a guest's balance can be withdrawn (or used in
   * another auction) from when it landed there; after that it goes back to
   * the payment method on its own. 7 by default (owner, 2026-10-10).
   */
  keepBalanceDays: number;
  /**
   * Transition assistant (lib/auction/transition): tempo change the DJ
   * mixes easily / with some work, %, and the starting-price multiplier
   * per difficulty on the auction's minimum, basis points (10000 = ×1).
   */
  transition: {
    easyMaxPct: number;
    mediumMaxPct: number;
    easyBps: number;
    mediumBps: number;
    hardBps: number;
    unknownBps: number;
  };
  recognition: {
    /** The chosen @ / table shows on the public screen. */
    screenNameCents: number;
    /** DJ panel alert to announce the bidder on the mic. */
    announceCents: number;
    /** "Momento especial": lights, CO2… */
    specialMomentCents: number;
    announcementsPerHour: number;
    /** Club choice: show the amount on the public screen, or only the name. */
    showAmountOnScreen: boolean;
  };
}

export const DEFAULT_AUCTION_CONFIG: AuctionConfig = {
  timezone: "Europe/Lisbon",
  phases: [
    { name: "warmup", start: null, slotsPerHour: 0, minPriceCents: 0 },
    { name: "ramp", start: "01:00", slotsPerHour: 2, minPriceCents: 200 },
    { name: "peak", start: "02:00", slotsPerHour: 4, minPriceCents: 500 },
    { name: "close", start: "04:00", slotsPerHour: 2, minPriceCents: 200 },
  ],
  specials: {
    firstPeak: { enabled: true, at: "02:00", minPriceCents: 1000, openMinutesBefore: 30 },
    lastSong: { enabled: true, minutesBeforeEnd: 15, minPriceCents: 1000, openMinutesBefore: 30 },
  },
  songsPerHour: 18,
  maxAuctionShareBps: 1500,
  minGapMin: 10,
  auctionDurationSec: 240,
  firstAuctionFromStart: true,
  softClose: { windowSec: 30, extendSec: 30, maxExtraSec: 180 },
  minIncrementCents: 100,
  minIncrementBps: 500,
  quickBidStepsCents: [100, 500, 1000],
  maxBidCents: 200_000,
  lastMinuteWarningSec: 60,
  playTargetMin: 10,
  refundAfterMin: 15,
  keepBalanceDays: 7,
  transition: { easyMaxPct: 4, mediumMaxPct: 8, easyBps: 10_000, mediumBps: 15_000, hardBps: 25_000, unknownBps: 15_000 },
  recognition: {
    screenNameCents: 5000,
    announceCents: 15000,
    specialMomentCents: 30000,
    announcementsPerHour: 3,
    showAmountOnScreen: true,
  },
};

/* ------------------------------------------------------------------ */
/* Schema — every field optional, every type strict                    */
/* ------------------------------------------------------------------ */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const num = z.number().finite();

const specialInput = z
  .object({ enabled: z.boolean(), minPriceCents: num, openMinutesBefore: num })
  .partial()
  .strip();

export const auctionConfigInputSchema = z
  .object({
    timezone: z.string().min(1),
    phases: z
      .array(
        z
          .object({
            name: z.enum(PHASE_NAMES),
            start: hhmm.nullable(),
            slotsPerHour: num,
            minPriceCents: num,
          })
          .strip(),
      )
      .min(1)
      .max(8),
    specials: z
      .object({
        firstPeak: specialInput.extend({ at: hhmm.optional() }),
        lastSong: specialInput.extend({ minutesBeforeEnd: num.optional() }),
      })
      .partial()
      .strip(),
    songsPerHour: num,
    maxAuctionShareBps: num,
    minGapMin: num,
    auctionDurationSec: num,
    firstAuctionFromStart: z.boolean(),
    softClose: z.object({ windowSec: num, extendSec: num, maxExtraSec: num }).partial().strip(),
    minIncrementCents: num,
    minIncrementBps: num,
    quickBidStepsCents: z.tuple([num, num, num]),
    maxBidCents: num,
    lastMinuteWarningSec: num,
    playTargetMin: num,
    refundAfterMin: num,
    keepBalanceDays: num,
    transition: z
      .object({ easyMaxPct: num, mediumMaxPct: num, easyBps: num, mediumBps: num, hardBps: num, unknownBps: num })
      .partial()
      .strip(),
    recognition: z
      .object({
        screenNameCents: num,
        announceCents: num,
        specialMomentCents: num,
        announcementsPerHour: num,
        showAmountOnScreen: z.boolean(),
      })
      .partial()
      .strip(),
  })
  .partial()
  .strip();

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

const MAX_CENTS = 10_000_000;

function int(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function special<T extends SpecialSlotConfig>(given: Partial<T> | undefined, d: T): T {
  return {
    ...d,
    ...given,
    enabled: given?.enabled ?? d.enabled,
    minPriceCents: int(given?.minPriceCents ?? d.minPriceCents, 0, MAX_CENTS),
    openMinutesBefore: int(given?.openMinutesBefore ?? d.openMinutesBefore, 1, 180),
  };
}

function transitionRules(
  t: Partial<AuctionConfig["transition"]>,
  d: AuctionConfig["transition"],
): AuctionConfig["transition"] {
  const easyMaxPct = Math.min(50, Math.max(0.5, t.easyMaxPct ?? d.easyMaxPct));
  // Multipliers never lower a price (≥ ×1) and never get easier with difficulty.
  const easyBps = int(t.easyBps ?? d.easyBps, 10_000, 100_000);
  const mediumBps = Math.max(easyBps, int(t.mediumBps ?? d.mediumBps, 10_000, 100_000));
  return {
    easyMaxPct,
    mediumMaxPct: Math.min(50, Math.max(easyMaxPct, t.mediumMaxPct ?? d.mediumMaxPct)),
    easyBps,
    mediumBps,
    hardBps: Math.max(mediumBps, int(t.hardBps ?? d.hardBps, 10_000, 100_000)),
    unknownBps: int(t.unknownBps ?? d.unknownBps, 10_000, 100_000),
  };
}

/**
 * Club settings blob → complete, sane AuctionConfig. Missing fields take
 * the defaults; a wrong type throws (silent coercion misprices a night).
 */
export function parseAuctionConfig(input: unknown): AuctionConfig {
  const raw = auctionConfigInputSchema.parse(input ?? {});
  const d = DEFAULT_AUCTION_CONFIG;
  const sc = raw.softClose ?? {};
  const rec = raw.recognition ?? {};
  const screenNameCents = int(rec.screenNameCents ?? d.recognition.screenNameCents, 0, MAX_CENTS);
  // Recognition tiers only ever go up: name ≤ mic ≤ special moment.
  const announceCents = Math.max(screenNameCents, int(rec.announceCents ?? d.recognition.announceCents, 0, MAX_CENTS));
  const specialMomentCents = Math.max(
    announceCents,
    int(rec.specialMomentCents ?? d.recognition.specialMomentCents, 0, MAX_CENTS),
  );
  const refundAfterMin = int(raw.refundAfterMin ?? d.refundAfterMin, 1, 120);

  return {
    timezone: raw.timezone ?? d.timezone,
    phases: (raw.phases ?? d.phases).map((p) => ({
      name: p.name,
      start: p.start,
      slotsPerHour: int(p.slotsPerHour, 0, 12),
      minPriceCents: int(p.minPriceCents, 0, MAX_CENTS),
    })),
    specials: {
      firstPeak: { ...special(raw.specials?.firstPeak, d.specials.firstPeak), at: raw.specials?.firstPeak?.at ?? d.specials.firstPeak.at },
      lastSong: {
        ...special(raw.specials?.lastSong, d.specials.lastSong),
        minutesBeforeEnd: int(raw.specials?.lastSong?.minutesBeforeEnd ?? d.specials.lastSong.minutesBeforeEnd, 0, 120),
      },
    },
    songsPerHour: int(raw.songsPerHour ?? d.songsPerHour, 1, 60),
    maxAuctionShareBps: int(raw.maxAuctionShareBps ?? d.maxAuctionShareBps, 0, 10_000),
    minGapMin: int(raw.minGapMin ?? d.minGapMin, 1, 120),
    auctionDurationSec: int(raw.auctionDurationSec ?? d.auctionDurationSec, 30, 3600),
    firstAuctionFromStart: raw.firstAuctionFromStart ?? d.firstAuctionFromStart,
    softClose: {
      windowSec: int(sc.windowSec ?? d.softClose.windowSec, 0, 600),
      extendSec: int(sc.extendSec ?? d.softClose.extendSec, 0, 600),
      maxExtraSec: int(sc.maxExtraSec ?? d.softClose.maxExtraSec, 0, 3600),
    },
    minIncrementCents: int(raw.minIncrementCents ?? d.minIncrementCents, 1, MAX_CENTS),
    minIncrementBps: int(raw.minIncrementBps ?? d.minIncrementBps, 0, 10_000),
    quickBidStepsCents: (raw.quickBidStepsCents ?? d.quickBidStepsCents)
      .map((s) => int(s, 1, MAX_CENTS))
      .sort((a, b) => a - b) as [number, number, number],
    maxBidCents: int(raw.maxBidCents ?? d.maxBidCents, 100, MAX_CENTS),
    lastMinuteWarningSec: int(raw.lastMinuteWarningSec ?? d.lastMinuteWarningSec, 0, 600),
    // The refund deadline can never come before the DJ's play target.
    playTargetMin: Math.min(refundAfterMin, int(raw.playTargetMin ?? d.playTargetMin, 1, 120)),
    refundAfterMin,
    keepBalanceDays: int(raw.keepBalanceDays ?? d.keepBalanceDays, 1, 365),
    transition: transitionRules(raw.transition ?? {}, d.transition),
    recognition: {
      screenNameCents,
      announceCents,
      specialMomentCents,
      announcementsPerHour: int(rec.announcementsPerHour ?? d.recognition.announcementsPerHour, 0, 60),
      showAmountOnScreen: rec.showAmountOnScreen ?? d.recognition.showAmountOnScreen,
    },
  };
}

/**
 * Console-facing checks that are not clamping matters: they need a human
 * decision. Returns translation keys (console.auction.errors.*).
 */
export function auctionConfigProblems(config: AuctionConfig): string[] {
  const problems: string[] = [];
  const [first, ...rest] = config.phases;
  if (!first || first.start !== null) problems.push("firstPhaseStartsAtOpening");
  if (rest.some((p) => p.start === null)) problems.push("onlyFirstPhaseWithoutStart");
  const names = config.phases.map((p) => p.name);
  if (new Set(names).size !== names.length) problems.push("duplicatePhase");
  return problems;
}
