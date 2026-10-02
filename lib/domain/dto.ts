import "server-only";

/**
 * Minimal DTO mappers (BRIEF B12.4 "Respostas mínimas").
 *
 * Every mapper lists its fields EXPLICITLY — never a spread of a DB row —
 * so adding a column to `requests` can never leak new data to a client
 * by accident. Guests only ever see their own request; staff payloads
 * carry no guest PII; the public payload is anonymous unless the guest
 * opted into the ranking (B8, B13 RGPD).
 */

import { computeSplit } from "@/lib/ledger/split";
import type {
  GuestRequestPayload,
  PublicNowPayload,
  StaffRequestPayload,
} from "@/lib/realtime/events";
import type {
  CloseReason,
  PaymentMethod,
  PaymentStatus,
  RequestStatus,
  Tier,
} from "./types";

/* ------------------------------------------------------------------ */
/* Row shapes (snake_case, as node-pg returns them)                    */
/* ------------------------------------------------------------------ */

/** A `requests` row as node-pg returns it (timestamptz → Date). */
export interface RequestRow {
  id: string;
  venue_id: string;
  session_id: string;
  zone_id: string | null;
  guest_id: string;
  quote_id: string;
  library_track_id: string | null;
  track_id: string | null;
  track_title: string;
  track_artist: string;
  track_genre: string | null;
  track_bpm: string | number | null; // numeric → string
  track_key: string | null;
  track_duration_sec: number | null;
  cover_url: string | null;
  in_library: boolean;
  fit_score: string | number | null; // numeric → string
  fit_label: string | null;
  tier: Tier;
  amount_cents: number;
  status: RequestStatus;
  close_reason: CloseReason | null;
  reject_reason: string | null;
  message: string | null;
  message_approved: boolean;
  pinned_next: boolean;
  sla_missed: boolean;
  original_tier: Tier | null;
  refunded_cents: number;
  paid_at: Date | null;
  accepted_at: Date | null;
  playing_at: Date | null;
  played_at: Date | null;
  closed_at: Date | null;
  deadline_at: Date | null;
  decision_deadline_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** A `payments` row as node-pg returns it. */
export interface PaymentRow {
  id: string;
  request_id: string;
  guest_id: string;
  provider: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount_cents: number;
  captured_cents: number;
  provider_ref: string | null;
  idempotency_key: string;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/* ------------------------------------------------------------------ */
/* Converters                                                          */
/* ------------------------------------------------------------------ */

export function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** pg numeric comes back as a string; normalize to number | null. */
export function toNumberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ */
/* Guest DTO — only the guest's own request, only what the screen needs */
/* ------------------------------------------------------------------ */

export interface GuestRequestDto {
  requestId: string;
  status: RequestStatus;
  tier: Tier;
  closeReason: CloseReason | null;
  trackTitle: string;
  trackArtist: string;
  coverUrl: string | null;
  amountCents: number;
  refundedCents: number;
  demotedFrom: Tier | null;
  fitLabel: string | null;
  deadlineAt: string | null;
  paidAt: string | null;
  playedAt: string | null;
  createdAt: string;
}

export function toGuestRequestDto(row: RequestRow): GuestRequestDto {
  return {
    requestId: row.id,
    status: row.status,
    tier: row.tier,
    closeReason: row.close_reason,
    trackTitle: row.track_title,
    trackArtist: row.track_artist,
    coverUrl: row.cover_url,
    amountCents: row.amount_cents,
    refundedCents: row.refunded_cents,
    demotedFrom: row.sla_missed ? row.original_tier : null,
    fitLabel: row.fit_label,
    deadlineAt: toIso(row.deadline_at),
    paidAt: toIso(row.paid_at),
    playedAt: toIso(row.played_at),
    createdAt: row.created_at.toISOString(),
  };
}

/** Realtime guest payload (lib/realtime/events.ts contract). */
export function toGuestRequestPayload(row: RequestRow): GuestRequestPayload {
  return {
    requestId: row.id,
    status: row.status,
    tier: row.tier,
    // Live position/ETA are recomputed by the queue read model on each
    // broadcast-triggered refetch; the push payload keeps them null.
    queuePosition: null,
    etaMin: null,
    refundedCents: row.refunded_cents,
    demotedFrom: row.sla_missed ? row.original_tier : null,
  };
}

/* ------------------------------------------------------------------ */
/* Staff DTO — cockpit card, no guest PII                              */
/* ------------------------------------------------------------------ */

export interface StaffDtoContext {
  /** BetBeat fee in bps (session config). */
  betbeatFeeBps: number;
  /** Venue share of the post-fee remainder, bps (session_settings). */
  venueShareBps: number;
  /** Zone display name, when the request came from a zoned QR. */
  zoneName: string | null;
}

export function toStaffRequestDto(
  row: RequestRow,
  ctx: StaffDtoContext,
): StaffRequestPayload {
  const split = computeSplit(row.amount_cents, ctx.betbeatFeeBps, ctx.venueShareBps);
  return {
    requestId: row.id,
    tier: row.tier,
    status: row.status,
    amountCents: row.amount_cents,
    djShareCents: split.djCents,
    trackTitle: row.track_title,
    trackArtist: row.track_artist,
    trackGenre: row.track_genre,
    trackBpm: toNumberOrNull(row.track_bpm),
    trackKey: row.track_key,
    coverUrl: row.cover_url,
    inLibrary: row.in_library,
    fitScore: toNumberOrNull(row.fit_score),
    fitLabel: row.fit_label,
    zoneName: ctx.zoneName,
    // Only DJ-approved messages ever leave the server (B4.7).
    message: row.message_approved ? row.message : null,
    deadlineAt: toIso(row.deadline_at),
    decisionDeadlineAt: toIso(row.decision_deadline_at),
    pinnedNext: row.pinned_next,
    paidAt: toIso(row.paid_at),
  };
}

/* ------------------------------------------------------------------ */
/* Public DTO — display / "now on the floor", anonymous by default     */
/* ------------------------------------------------------------------ */

export function toPublicNowDto(
  row: RequestRow,
  opts: {
    /** Guest handle — pass ONLY when the guest opted into the ranking. */
    handle: string | null;
    /** When the track started playing, epoch ms (server clock). */
    startedAtMs: number;
  },
): PublicNowPayload {
  return {
    trackTitle: row.track_title,
    trackArtist: row.track_artist,
    handle: opts.handle,
    bpm: toNumberOrNull(row.track_bpm),
    startedAt: new Date(opts.startedAtMs).toISOString(),
  };
}
