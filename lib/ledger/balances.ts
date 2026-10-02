/**
 * Pure balance derivation (BRIEF B4.5): balances are ALWAYS derived from the
 * immutable double-entry ledger, never stored as truth.
 *
 * Accepts rows as they come back from Postgres: `amount_cents` is a bigint
 * column, which node-pg returns as a string, so number, string and bigint are
 * all accepted. Accumulation happens in BigInt and is only converted back to
 * number once proven safe.
 */

import { ACCOUNTS, type Account } from "./accounts";

/** A ledger row as read from the DB (snake_case, bigint-safe). */
export interface LedgerEntryRow {
  account: Account;
  amount_cents: number | string | bigint;
}

/** Signed balance per account, integer cents (positive = net debit). */
export type Balances = Record<Account, number>;

/** Per-session money statement, all integer cents. */
export interface SessionStatement {
  /** Gross captured from guests (before refunds). */
  gmv: number;
  /** Total refunded back to guests. */
  refunds: number;
  /** BetBeat fee recognized. */
  betbeatFee: number;
  /** Venue earnings recognized (before payout). */
  venueNet: number;
  /** DJ earnings recognized (before payout). */
  djNet: number;
}

const ALL_ACCOUNTS: readonly Account[] = Object.values(ACCOUNTS);

function toBigInt(value: number | string | bigint, account: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`Ledger amount for ${account} is not a safe integer: ${value}`);
    }
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) {
    throw new RangeError(`Ledger amount for ${account} is not an integer string: "${value}"`);
  }
  return BigInt(value);
}

function toSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} overflows Number.MAX_SAFE_INTEGER: ${value}`);
  }
  return Number(value);
}

/**
 * Sums signed amounts per account. Every known account is present in the
 * result (0 when it has no entries).
 */
export function deriveBalances(entries: readonly LedgerEntryRow[]): Balances {
  const totals = new Map<Account, bigint>(ALL_ACCOUNTS.map((a) => [a, 0n]));
  for (const entry of entries) {
    const current = totals.get(entry.account) ?? 0n;
    totals.set(entry.account, current + toBigInt(entry.amount_cents, entry.account));
  }
  const balances = {} as Balances;
  for (const [account, total] of totals) {
    balances[account] = toSafeNumber(total, `balance(${account})`);
  }
  return balances;
}

/**
 * Derives the session statement purely from (account, sign) — each
 * combination maps to exactly one group type under the posting conventions
 * in lib/ledger/groups.ts:
 *
 * - psp_clearing debits only come from captures           → gmv
 * - betbeat_revenue credits only come from recognition    → betbeatFee
 * - venue_payable / dj_payable credits, recognition only  → venueNet / djNet
 * - guest_escrow debits come from recognition + refunds   → refunds =
 *   escrow debits − (betbeatFee + venueNet + djNet)
 */
export function sessionStatement(entries: readonly LedgerEntryRow[]): SessionStatement {
  let pspDebits = 0n;
  let escrowDebits = 0n;
  let revenueCredits = 0n;
  let venueCredits = 0n;
  let djCredits = 0n;

  for (const entry of entries) {
    const amount = toBigInt(entry.amount_cents, entry.account);
    switch (entry.account) {
      case ACCOUNTS.pspClearing:
        if (amount > 0n) pspDebits += amount;
        break;
      case ACCOUNTS.guestEscrow:
        if (amount > 0n) escrowDebits += amount;
        break;
      case ACCOUNTS.betbeatRevenue:
        if (amount < 0n) revenueCredits += -amount;
        break;
      case ACCOUNTS.venuePayable:
        if (amount < 0n) venueCredits += -amount;
        break;
      case ACCOUNTS.djPayable:
        if (amount < 0n) djCredits += -amount;
        break;
      default:
        break;
    }
  }

  const recognized = revenueCredits + venueCredits + djCredits;
  return {
    gmv: toSafeNumber(pspDebits, "gmv"),
    refunds: toSafeNumber(escrowDebits - recognized, "refunds"),
    betbeatFee: toSafeNumber(revenueCredits, "betbeatFee"),
    venueNet: toSafeNumber(venueCredits, "venueNet"),
    djNet: toSafeNumber(djCredits, "djNet"),
  };
}
