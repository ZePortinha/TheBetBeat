/**
 * Funnel instrumentation (BRIEF B14): stable event names from day one.
 * Captured server-side (no SDK dependency) by lib/analytics/capture.ts and,
 * when NEXT_PUBLIC_POSTHOG_KEY is set, client-side via the same names.
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
  // DJ
  djDecision: "dj.decision", // props: action accept|reject|cancel, decisionMs
  djSlaMissed: "dj.sla_missed",
  // Health
  paymentFailed: "payment.failed",
  refundIssued: "refund.issued",
  refundFailed: "refund.failed",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
