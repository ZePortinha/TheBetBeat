/**
 * Bidding rules for one slot auction (PURE). The server decides every
 * timing with its own clock; this module only answers "is this bid valid
 * at `now`, and where does the close move to?".
 *
 * One rule covers every way to bid — a new bid, raising your own, or
 * putting money behind someone else's bid: the bid's NEW TOTAL must beat
 * the current top by max(1 €, 5%) (club-configurable). Every accepted
 * action therefore makes that bid the new top. Paying is only the
 * difference to what the payer already has in that bid.
 */
import type { AuctionConfig } from "./config";

type BidRules = Pick<
  AuctionConfig,
  "minIncrementCents" | "minIncrementBps" | "maxBidCents" | "softClose" | "quickBidStepsCents" | "lastMinuteWarningSec"
>;

/** The smallest raise over `topCents`: the larger of the fixed and the % step. */
export function minIncrement(topCents: number, rules: Pick<BidRules, "minIncrementCents" | "minIncrementBps">): number {
  return Math.max(rules.minIncrementCents, Math.ceil((topCents * rules.minIncrementBps) / 10_000));
}

/** The lowest total a bid may have now (the minimum price when nobody bid yet). */
export function minNextBid(
  topCents: number | null,
  minPriceCents: number,
  rules: Pick<BidRules, "minIncrementCents" | "minIncrementBps">,
): number {
  return topCents === null ? minPriceCents : topCents + minIncrement(topCents, rules);
}

/**
 * The "+1 € / +5 € / +10 €" buttons as totals: each step over the top,
 * lifted to the minimum when the % rule asks for more. With no bid yet,
 * the first button is the minimum price.
 */
export function quickBids(topCents: number | null, minPriceCents: number, rules: BidRules): number[] {
  const [s1, s2, s3] = rules.quickBidStepsCents;
  const floor = minNextBid(topCents, minPriceCents, rules);
  const totals =
    topCents === null
      ? [floor, floor + s2 - s1, floor + s3 - s1]
      : [s1, s2, s3].map((step) => Math.max(topCents + step, floor));
  return [...new Set(totals)].filter((t) => t <= rules.maxBidCents);
}

export interface BidAttempt {
  opensAtMs: number;
  /** Current close (moves with soft close). */
  closesAtMs: number;
  /** The planned close, before any extension. */
  scheduledClosesAtMs: number;
  topCents: number | null;
  minPriceCents: number;
  /** The bid's new total. */
  totalCents: number;
  now: number;
}

export type BidDecision =
  | { ok: true; closesAtMs: number; extended: boolean }
  | { ok: false; reason: "not_open" | "closed" | "below_minimum" | "above_maximum" };

/**
 * Validates a bid at server time `now` and applies the soft close: a bid
 * in the last `windowSec` pushes the close by `extendSec`, never past
 * the planned close + `maxExtraSec`.
 */
export function decideBid(bid: BidAttempt, rules: BidRules): BidDecision {
  if (bid.now < bid.opensAtMs) return { ok: false, reason: "not_open" };
  if (bid.now >= bid.closesAtMs) return { ok: false, reason: "closed" };
  if (!Number.isSafeInteger(bid.totalCents) || bid.totalCents < minNextBid(bid.topCents, bid.minPriceCents, rules)) {
    return { ok: false, reason: "below_minimum" };
  }
  if (bid.totalCents > rules.maxBidCents) return { ok: false, reason: "above_maximum" };

  const { windowSec, extendSec, maxExtraSec } = rules.softClose;
  if (bid.closesAtMs - bid.now > windowSec * 1000) {
    return { ok: true, closesAtMs: bid.closesAtMs, extended: false };
  }
  const limit = bid.scheduledClosesAtMs + maxExtraSec * 1000;
  const closesAtMs = Math.min(bid.closesAtMs + extendSec * 1000, limit);
  return { ok: true, closesAtMs, extended: closesAtMs > bid.closesAtMs };
}

/** Countdown state for the app and the public screen (colour change). */
export function countdownState(
  closesAtMs: number,
  now: number,
  rules: Pick<BidRules, "lastMinuteWarningSec">,
): "open" | "last_minute" | "closed" {
  const left = closesAtMs - now;
  if (left <= 0) return "closed";
  return left <= rules.lastMinuteWarningSec * 1000 ? "last_minute" : "open";
}

/** At the close: a winner exists only if some bid reached the minimum price. */
export function closeOutcome(topCents: number | null, minPriceCents: number): "won" | "no_winner" {
  return topCents !== null && topCents >= minPriceCents ? "won" : "no_winner";
}
