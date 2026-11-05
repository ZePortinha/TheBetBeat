/**
 * Realtime contract (BRIEF B11 "Tempo real"). The SERVER publishes
 * pre-filtered broadcasts; clients never subscribe to table changes.
 * Channels: session:<id>:staff (private) · guest:<uuid> (private) ·
 * session:<id>:public (public hints only: anyone can broadcast there) ·
 * session:<id>:board (private, server-written: the public auction board).
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
/**
 * The auction board itself (amounts, closing times, winners, ranking), sent
 * by the server after every auction change. Private so that only the server
 * can write it (no insert policy on realtime.messages); any signed-in guest
 * may read it, because the board is public data. Phones apply it directly
 * instead of refetching (load test 2026-11-05, docs/LOAD-TEST.md).
 */
export function boardChannel(sessionId: string): string {
  return `session:${sessionId}:board`;
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
