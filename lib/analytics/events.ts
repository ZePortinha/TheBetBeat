/**
 * Funnel instrumentation (BRIEF B14): stable event names from day one.
 * Captured server-side only (lib/analytics/capture.ts): no SDK, no cookie
 * and no script in the browser, so guests carry no tracker (B13 RGPD).
 * Renaming an event breaks every PostHog chart built on it: add, never
 * rename.
 */
export const EVENTS = {
  // Guest funnel: scan → search → quote → payment → played
  guestScan: "guest.scan",
  guestSearch: "guest.search",
  guestQuoteShown: "guest.quote_shown",
  guestPaymentStarted: "guest.payment_started",
  guestPaymentConfirmed: "guest.payment_confirmed",
  guestRequestPlayed: "guest.request_played",
  guestShare: "guest.share",
  // Auctions: bid → (top-up) → won → DJ decision → played
  auctionBidPlaced: "auction.bid_placed", // props: target own|back, totalCents
  auctionTopUpStarted: "auction.topup_started", // props: method, needCents
  auctionSlotDecision: "auction.slot_decision", // props: action
  // DJ
  djDecision: "dj.decision", // props: action accept|reject|cancel|timeout, decisionMs
  djSlaMissed: "dj.sla_missed",
  // Health
  paymentFailed: "payment.failed",
  refundIssued: "refund.issued",
  refundFailed: "refund.failed",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

export type EventProperties = Record<string, string | number | boolean | null>;
