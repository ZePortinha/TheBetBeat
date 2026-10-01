/**
 * Realtime contract (BRIEF B11 "Tempo real"). The SERVER publishes
 * pre-filtered broadcasts; clients never subscribe to table changes.
 * Channels: session:<id>:staff (private) · guest:<uuid> (private) ·
 * session:<id>:public (public data only).
 */
import type { RealtimeEvent, RequestStatus, Tier } from "@/lib/domain/types";

export function staffChannel(sessionId: string): string {
  return `session:${sessionId}:staff`;
}
export function guestChannel(guestId: string): string {
  return `guest:${guestId}`;
}
export function publicChannel(sessionId: string): string {
  return `session:${sessionId}:public`;
}

/** Staff payload: everything the cockpit card needs (no guest PII). */
export interface StaffRequestPayload {
  requestId: string;
  tier: Tier;
  status: RequestStatus;
  amountCents: number;
  djShareCents: number;
  trackTitle: string;
  trackArtist: string;
  trackGenre: string | null;
  trackBpm: number | null;
  trackKey: string | null;
  coverUrl: string | null;
  inLibrary: boolean;
  fitScore: number | null;
  fitLabel: string | null;
  zoneName: string | null;
  message: string | null;
  deadlineAt: string | null;
  decisionDeadlineAt: string | null;
  pinnedNext: boolean;
  paidAt: string | null;
}

/** Guest payload: only the guest's own request status. */
export interface GuestRequestPayload {
  requestId: string;
  status: RequestStatus;
  tier: Tier;
  queuePosition: number | null;
  etaMin: number | null;
  refundedCents: number;
  demotedFrom: Tier | null;
}

/** Public payload (display + "now on the floor"): anonymous by default. */
export interface PublicNowPayload {
  trackTitle: string;
  trackArtist: string;
  handle: string | null;
  bpm: number | null;
  startedAt: string;
}

export interface EventEnvelope<T = unknown> {
  event: RealtimeEvent;
  payload: T;
  /** Server timestamp, ISO UTC. */
  at: string;
}
