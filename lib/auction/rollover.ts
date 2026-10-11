/**
 * Runner-up rollover and the balance's 7 days (PURE, owner's brief of
 * 2026-10-10).
 *
 * Whoever ends an auction in SECOND place has that money moved into the
 * next auction as its opening bid, for the same track:
 *   - wins it          → spent as any winning bid (refunded if not played);
 *   - second again     → it rolls again;
 *   - third or lower   → it is already in the balance (outbid money comes
 *                        back at once), withdrawable for `days`.
 * Money in the balance has `days` from the moment it landed there, oldest
 * euro first; what is still there after that goes back to the payment
 * method on its own (never forfeited: B1/B4 #2).
 */

export interface LoserBid {
  id: string;
  /** The bid's total the last time it was outbid (0 = never led). */
  lastTotalCents: number;
}

/**
 * The runner-up of a closed auction: the losing bid that led with the
 * highest total. Every lead change must beat the top, so two losers can
 * never share a non-zero total. Null when nobody else ever led.
 */
export function runnerUp<T extends LoserBid>(losers: readonly T[]): T | null {
  let best: T | null = null;
  for (const bid of losers) {
    if (bid.lastTotalCents > 0 && (best === null || bid.lastTotalCents > best.lastTotalCents)) best = bid;
  }
  return best;
}

export interface Share {
  guestId: string;
  amountCents: number;
}

/**
 * What each contributor of the runner-up bid rolls: their part of its last
 * total, capped by what their balance still holds (they may have spent it
 * on another bid since they were outbid). Merged per guest, zeros dropped.
 */
export function rolloverShares(parts: readonly Share[], balances: ReadonlyMap<string, number>): Share[] {
  const wanted = new Map<string, number>();
  for (const p of parts) wanted.set(p.guestId, (wanted.get(p.guestId) ?? 0) + p.amountCents);
  const shares: Share[] = [];
  for (const [guestId, amount] of wanted) {
    const take = Math.min(amount, Math.max(0, balances.get(guestId) ?? 0));
    if (take > 0) shares.push({ guestId, amountCents: take });
  }
  return shares;
}

export type PlaceCheck =
  | { ok: true }
  | { ok: false; reason: "below_minimum" | "outbid_already" };

/**
 * Can the rolled money open the next auction? It has to reach the
 * auction's minimum and, when someone already bid, beat the top by the
 * club's increment (`minNextCents`, from lib/auction/bidding).
 */
export function canPlaceRollover(amountCents: number, minNextCents: number, hasLeader: boolean): PlaceCheck {
  if (amountCents >= minNextCents) return { ok: true };
  return { ok: false, reason: hasLeader ? "outbid_already" : "below_minimum" };
}

export interface Credit {
  amountCents: number;
  atMs: number;
}

const DAY_MS = 86_400_000;

/**
 * The part of a balance older than `days` (oldest euro first): the
 * balance minus every credit that landed in the window. Spending and
 * holds always consume the oldest money.
 */
export function expiredCents(balanceCents: number, credits: readonly Credit[], now: number, days: number): number {
  const since = now - days * DAY_MS;
  const fresh = credits.filter((c) => c.atMs > since).reduce((sum, c) => sum + c.amountCents, 0);
  return Math.max(0, balanceCents - fresh);
}

/**
 * When the oldest euro still in the balance goes back to the payment
 * method (null for an empty balance): walk the credits newest first until
 * they cover the balance; the credit that completes it is the oldest
 * money left.
 */
export function balanceDeadline(balanceCents: number, credits: readonly Credit[], days: number): number | null {
  if (balanceCents <= 0) return null;
  const newestFirst = [...credits].sort((a, b) => b.atMs - a.atMs);
  let covered = 0;
  for (const c of newestFirst) {
    covered += c.amountCents;
    if (covered >= balanceCents) return c.atMs + days * DAY_MS;
  }
  // Credits do not explain the whole balance (should not happen): the
  // oldest one known sets the date, so the money is never held longer.
  const oldest = newestFirst[newestFirst.length - 1];
  return oldest ? oldest.atMs + days * DAY_MS : null;
}
