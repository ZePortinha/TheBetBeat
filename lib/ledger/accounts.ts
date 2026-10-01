/**
 * Ledger account naming (B4.5). Double-entry, signed cents:
 * positive = debit, negative = credit; every group sums to zero.
 *
 * Flow for a played request of amount A with BetBeat fee F:
 *   capture:  psp_clearing +A  /  guest_escrow −A
 *   split:    guest_escrow +A  /  betbeat_revenue −F, venue_payable −V, dj_payable −D
 *   payout:   venue_payable +V /  psp_clearing −V   (and same for DJ)
 * Refund of R: guest_escrow +R / psp_clearing −R (before split).
 */
export const ACCOUNTS = {
  /** Money moving through the PSP (asset). */
  pspClearing: "psp_clearing",
  /** Guest money held until played/refunded (liability). */
  guestEscrow: "guest_escrow",
  /** BetBeat fee revenue. */
  betbeatRevenue: "betbeat_revenue",
  /** Owed to the venue (liability until payout). */
  venuePayable: "venue_payable",
  /** Owed to the DJ (liability until payout). */
  djPayable: "dj_payable",
  /** PSP fees expense (never charged to guests). */
  pspFees: "psp_fees",
} as const;

export type Account = (typeof ACCOUNTS)[keyof typeof ACCOUNTS];

export interface LedgerLine {
  account: Account;
  amountCents: number; // signed; group must sum to 0
  venueId?: string;
  sessionId?: string;
  requestId?: string;
  memo?: string;
}
