/**
 * Pure builders for double-entry ledger groups (BRIEF B4.5).
 *
 * Convention (lib/ledger/accounts.ts): signed cents, positive = debit,
 * negative = credit. Every group sums to exactly zero — `assertZeroSum`
 * enforces it and `postLedgerGroup` re-checks before writing.
 *
 * Zero-amount lines are omitted (the `ledger_entries` table forbids
 * `amount_cents = 0`), which never breaks the zero-sum invariant.
 */

import { ACCOUNTS, type Account, type LedgerLine } from "./accounts";
import type { Split } from "./split";

/** Dimensions stamped on every line of a group. */
export interface LedgerMeta {
  venueId?: string;
  sessionId?: string;
  requestId?: string;
  memo?: string;
}

export type PayoutRecipient = "venue" | "dj";

function assertPositiveInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer, got ${value}`);
  }
}

function line(account: Account, amountCents: number, meta: LedgerMeta): LedgerLine {
  return { account, amountCents, ...meta };
}

/** Builds a group, dropping zero-amount lines (disallowed by the DB). */
function group(lines: LedgerLine[]): LedgerLine[] {
  const nonZero = lines.filter((l) => l.amountCents !== 0);
  assertZeroSum(nonZero);
  return nonZero;
}

/**
 * Throws unless `lines` form a valid zero-sum group: every amount a non-zero
 * safe integer and the signed total exactly zero.
 */
export function assertZeroSum(lines: LedgerLine[]): void {
  let sum = 0n;
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amountCents)) {
      throw new Error(
        `Ledger group invalid: ${l.account} amount ${l.amountCents} is not a safe integer`,
      );
    }
    if (l.amountCents === 0) {
      throw new Error(`Ledger group invalid: ${l.account} has a zero-amount line`);
    }
    sum += BigInt(l.amountCents);
  }
  if (sum !== 0n) {
    throw new Error(`Ledger group does not sum to zero (got ${sum} cents)`);
  }
}

/**
 * Guest payment captured by the PSP: money enters clearing and is held in
 * escrow until the track plays (recognition) or is refunded.
 *
 *   psp_clearing  +A
 *   guest_escrow  −A
 */
export function captureGroup(amountCents: number, meta: LedgerMeta): LedgerLine[] {
  assertPositiveInt(amountCents, "amountCents");
  return group([
    line(ACCOUNTS.pspClearing, amountCents, meta),
    line(ACCOUNTS.guestEscrow, -amountCents, meta),
  ]);
}

/**
 * Revenue recognition when the track plays: escrow is released and split into
 * BetBeat fee, venue payable and DJ payable (per `computeSplit`).
 *
 *   guest_escrow     +A
 *   betbeat_revenue  −fee
 *   venue_payable    −venue
 *   dj_payable       −dj
 */
export function recognitionGroup(split: Split, meta: LedgerMeta): LedgerLine[] {
  const { amountCents, betbeatFeeCents, venueCents, djCents } = split;
  assertPositiveInt(amountCents, "split.amountCents");
  for (const [name, value] of [
    ["split.betbeatFeeCents", betbeatFeeCents],
    ["split.venueCents", venueCents],
    ["split.djCents", djCents],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer, got ${value}`);
    }
  }
  if (betbeatFeeCents + venueCents + djCents !== amountCents) {
    throw new Error(
      `Split parts (${betbeatFeeCents} + ${venueCents} + ${djCents}) do not sum to amount ${amountCents}`,
    );
  }
  return group([
    line(ACCOUNTS.guestEscrow, amountCents, meta),
    line(ACCOUNTS.betbeatRevenue, -betbeatFeeCents, meta),
    line(ACCOUNTS.venuePayable, -venueCents, meta),
    line(ACCOUNTS.djPayable, -djCents, meta),
  ]);
}

/**
 * Full or partial refund to the guest (before recognition): escrow is
 * released back through PSP clearing.
 *
 *   guest_escrow  +R
 *   psp_clearing  −R
 */
export function refundGroup(amountCents: number, meta: LedgerMeta): LedgerLine[] {
  assertPositiveInt(amountCents, "amountCents");
  return group([
    line(ACCOUNTS.guestEscrow, amountCents, meta),
    line(ACCOUNTS.pspClearing, -amountCents, meta),
  ]);
}

/**
 * SEPA payout after session close: the payable is settled through PSP
 * clearing.
 *
 *   venue_payable | dj_payable  +A
 *   psp_clearing                −A
 */
export function payoutGroup(
  recipient: PayoutRecipient,
  amountCents: number,
  meta: LedgerMeta,
): LedgerLine[] {
  assertPositiveInt(amountCents, "amountCents");
  const payable = recipient === "venue" ? ACCOUNTS.venuePayable : ACCOUNTS.djPayable;
  return group([
    line(payable, amountCents, meta),
    line(ACCOUNTS.pspClearing, -amountCents, meta),
  ]);
}
