/**
 * Domain contracts — shared by pricing, state machine, payments, UI.
 * Glossary (BRIEF B3): "Na Fila" = QUEUE, "Em Breve" = SOON, "A Seguir" = NEXT.
 * Money is ALWAYS integer cents. Dates are ISO UTC strings or epoch ms.
 */

export const TIERS = ["QUEUE", "SOON", "NEXT"] as const;
export type Tier = (typeof TIERS)[number];

export const REQUEST_STATUSES = [
  "pending_payment",
  "paid",
  "accepted",
  "playing",
  "played",
  "expired",
  "refunded",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const CLOSE_REASONS = [
  "payment_timeout",
  "rejected_by_dj",
  "dj_timeout",
  "cancelled_by_dj",
  "session_ended",
] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const REJECT_REASONS = [
  "off_style",
  "missing_track",
  "already_played",
  "other",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export type Role = "guest" | "dj" | "manager" | "admin";

export type PaymentMethod = "mbway" | "card" | "apple_pay" | "google_pay";

export type PaymentStatus =
  | "pending"
  | "authorized"
  | "captured"
  | "voided"
  | "failed"
  | "expired";

export type RefundStatus = "pending" | "processing" | "succeeded" | "failed";

export type FitLabel = "fits" | "possible" | "off_style";

export type DemandLevel = "low" | "medium" | "high" | "very_high";

/** Realtime event names (B11). Server publishes pre-filtered broadcasts. */
export const REALTIME_EVENTS = [
  "request.paid",
  "request.accepted",
  "request.rejected",
  "request.pinned",
  "request.playing",
  "request.played",
  "request.refunded",
  "request.sla_missed",
  "queue.changed",
  "price.changed",
  "session.paused",
  "session.ended",
] as const;
export type RealtimeEvent = (typeof REALTIME_EVENTS)[number];

/** Session-level configuration (defaults in BRIEF B4/B5). */
export interface SessionConfig {
  basePriceCents: number; // B — default 1000 (10 €)
  acceptanceRatePerHour: number; // R — default 8
  /** Promise windows, minutes. */
  soonDeadlineMin: number; // default 20
  nextDeadlineMin: number; // default 10
  /** DJ decision windows, minutes (B4.1). */
  decisionWindowNextMin: number; // default 3
  decisionWindowSoonMin: number; // default 5
  decisionWindowQueueMin: number; // default 10
  /** Tier price limits, cents (B5.6). */
  tierLimits: Record<Tier, { minCents: number; maxCents: number }>;
  /** BetBeat fee (bps of GMV, default 2000 = 20%) and venue/DJ split of the rest. */
  betbeatFeeBps: number;
  venueShareBps: number; // of the remainder after the BetBeat fee
  /** Minimum musical fit allowed for requests (0 disables the block). */
  minFitScore: number;
  /** Track repeat block window, minutes (default 60). */
  noRepeatWindowMin: number;
  /** Guest limits (B4.7). */
  maxActiveRequestsPerGuest: number; // default 3
  nightSpendLimitCents: number; // default 15000
  /** MB WAY payment timeout, minutes (default 4). */
  mbwayTimeoutMin: number;
  /** Guest message with request (B4.7) — off by default. */
  guestMessagesEnabled: boolean;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  basePriceCents: 1000,
  acceptanceRatePerHour: 8,
  soonDeadlineMin: 20,
  nextDeadlineMin: 10,
  decisionWindowNextMin: 3,
  decisionWindowSoonMin: 5,
  decisionWindowQueueMin: 10,
  tierLimits: {
    QUEUE: { minCents: 500, maxCents: 6000 },
    SOON: { minCents: 1500, maxCents: 12000 },
    NEXT: { minCents: 2500, maxCents: 20000 },
  },
  betbeatFeeBps: 2000,
  venueShareBps: 5000,
  minFitScore: 0,
  noRepeatWindowMin: 60,
  maxActiveRequestsPerGuest: 3,
  nightSpendLimitCents: 15000,
  mbwayTimeoutMin: 4,
  guestMessagesEnabled: false,
};

/** A track as the domain sees it (library or global catalog cache). */
export interface TrackInfo {
  id: string;
  title: string;
  artist: string;
  genre: string;
  bpm: number | null;
  /** Camelot notation, e.g. "8A"; null when unknown. */
  camelotKey: string | null;
  durationSec: number | null;
  coverUrl: string | null;
  inLibrary: boolean;
  previewUrl: string | null;
}

/** An active (paid, not yet played) request as pricing/ordering sees it. */
export interface ActiveRequestInfo {
  id: string;
  tier: Tier;
  amountCents: number;
  paidAt: string; // ISO UTC
  /** Promise deadline (ISO UTC) — null for QUEUE (promise = end of set). */
  deadlineAt: string | null;
  trackDurationSec: number | null;
  status: Extract<RequestStatus, "paid" | "accepted" | "playing">;
  pinnedNext: boolean;
}
