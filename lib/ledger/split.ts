/**
 * Revenue split math (BRIEF B4.5).
 *
 * Pure, deterministic, integer-cents only. The BetBeat fee is taken off the
 * gross amount first; the remainder is divided between venue and DJ. Rounding
 * never creates or destroys cents: the DJ receives the exact remainder, so
 * `betbeatFeeCents + venueCents + djCents === amountCents` always holds.
 */

/** Basis points denominator: 10000 bps = 100%. */
export const BPS_DENOMINATOR = 10_000;

export interface Split {
  /** Gross amount captured from the guest (VAT-inclusive), cents. */
  amountCents: number;
  /** BetBeat platform fee, cents. */
  betbeatFeeCents: number;
  /** Venue share of the remainder, cents. */
  venueCents: number;
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
 * Split a gross request amount into BetBeat fee, venue share and DJ share.
 *
 * fee   = round(amount · betbeatFeeBps / 10000)
 * rest  = amount − fee
 * venue = round(rest · venueShareBps / 10000)
 * dj    = rest − venue
 *
 * Invariants (property-tested): every part is a non-negative integer and
 * fee + venue + dj === amount for all non-negative integer inputs.
 */
export function computeSplit(
  amountCents: number,
  betbeatFeeBps: number,
  venueShareBps: number,
): Split {
  assertNonNegativeInt(amountCents, "amountCents");
  assertBps(betbeatFeeBps, "betbeatFeeBps");
  assertBps(venueShareBps, "venueShareBps");

  const betbeatFeeCents = mulBpsRound(amountCents, betbeatFeeBps);
  const remainderCents = amountCents - betbeatFeeCents;
  const venueCents = mulBpsRound(remainderCents, venueShareBps);
  const djCents = remainderCents - venueCents;

  return { amountCents, betbeatFeeCents, venueCents, djCents };
}
