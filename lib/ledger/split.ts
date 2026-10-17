/**
 * Revenue split math (BRIEF B4.5).
 *
 * Pure, deterministic, integer-cents only. The Ritma fee is taken off the
 * gross amount first; the remainder is divided between venue and DJ. Rounding
 * never creates or destroys cents: the DJ receives the exact remainder, so
 * `betbeatFeeCents + venueCents + djCents === amountCents` always holds.
 */

/** Basis points denominator: 10000 bps = 100%. */
export const BPS_DENOMINATOR = 10_000;

/** Ritma's flat fee on every event created from 2026-10-11: 11%. */
export const PLATFORM_FEE_BPS = 1_100;

export interface Split {
  /** Gross amount captured from the guest (VAT-inclusive), cents. */
  amountCents: number;
  /** Ritma platform fee, cents. */
  betbeatFeeCents: number;
  /** Venue share of the remainder, cents. */
  venueCents: number;
  /** Promoter share of the remainder, cents (0 when the event has none). */
  promoterCents: number;
  /** DJ share of the remainder, cents. */
  djCents: number;
}

function assertNonNegativeInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer, got ${value}`);
  }
}

function assertBps(value: number, name: string): void {
  assertNonNegativeInt(value, name);
  if (value > BPS_DENOMINATOR) {
    throw new RangeError(`${name} must be <= ${BPS_DENOMINATOR} bps, got ${value}`);
  }
}

/**
 * round(amount * bps / 10000) with half-up rounding, computed in BigInt so it
 * stays exact for every safe-integer amount (no float precision loss).
 */
function mulBpsRound(amountCents: number, bps: number): number {
  const product = BigInt(amountCents) * BigInt(bps);
  const rounded = (product + BigInt(BPS_DENOMINATOR / 2)) / BigInt(BPS_DENOMINATOR);
  return Number(rounded); // <= amountCents, so always a safe integer
}

/**
 * Split a gross request amount into Ritma fee, venue, promoter and DJ shares.
 *
 * fee      = round(amount · betbeatFeeBps / 10000)
 * rest     = amount − fee
 * venue    = round(rest · venueShareBps / 10000)
 * promoter = round(rest · promoterShareBps / 10000)
 * dj       = rest − venue − promoter
 *
 * Invariants (property-tested): every part is a non-negative integer and
 * fee + venue + promoter + dj === amount for all non-negative integer
 * inputs with venueShareBps + promoterShareBps ≤ 10000.
 */
export function computeSplit(
  amountCents: number,
  betbeatFeeBps: number,
  venueShareBps: number,
  promoterShareBps = 0,
): Split {
  assertNonNegativeInt(amountCents, "amountCents");
  assertBps(betbeatFeeBps, "betbeatFeeBps");
  assertBps(venueShareBps, "venueShareBps");
  assertBps(promoterShareBps, "promoterShareBps");
  if (venueShareBps + promoterShareBps > BPS_DENOMINATOR) {
    throw new RangeError(
      `venueShareBps + promoterShareBps must be <= ${BPS_DENOMINATOR}, got ${venueShareBps + promoterShareBps}`,
    );
  }

  const betbeatFeeCents = mulBpsRound(amountCents, betbeatFeeBps);
  const remainderCents = amountCents - betbeatFeeCents;
  const venueCents = mulBpsRound(remainderCents, venueShareBps);
  // Both rounded halves can never exceed the remainder: ≤ rest·(v+p)/10000 + 1
  // only when both round up, so the promoter is capped by what is left.
  const promoterCents = Math.min(mulBpsRound(remainderCents, promoterShareBps), remainderCents - venueCents);
  const djCents = remainderCents - venueCents - promoterCents;

  return { amountCents, betbeatFeeCents, venueCents, promoterCents, djCents };
}
