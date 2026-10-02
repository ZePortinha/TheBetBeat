/**
 * Client mirror of the cockpit API DTOs (app/api/cockpit/state).
 * Presentation types only — money is integer cents, dates ISO UTC.
 */
import type { StaffRequestPayload } from "@/lib/realtime/events";

export interface CockpitSessionConfig {
  acceptanceRatePerHour: number;
  basePriceCents: number;
  soonDeadlineMin: number;
  nextDeadlineMin: number;
  decisionWindowNextMin: number;
  decisionWindowSoonMin: number;
  decisionWindowQueueMin: number;
  noRepeatWindowMin: number;
}

export interface CockpitSession {
  id: string;
  name: string;
  status: string;
  requestsOpen: boolean;
  startsAt: string;
  endsAt: string;
  sessionGenres: string[];
  catalogMode: "library" | "library_plus_catalog";
  djStaffId: string | null;
  config: CockpitSessionConfig;
  basePriceBounds: { minCents: number; maxCents: number };
}

export interface CockpitNowPlaying {
  requestId: string | null;
  title: string;
  artist: string;
  bpm: number | null;
  durationSec: number | null;
  startedAt: string;
  amountCents: number | null;
}

export interface CockpitState {
  serverNow: string;
  session: CockpitSession | null;
  requests: StaffRequestPayload[];
  nowPlaying: CockpitNowPlaying | null;
  revenue: { totalCents: number; djCents: number };
  genres: Array<{ genre: string; blocked: boolean }>;
  venueDjs: Array<{ staffId: string; name: string }>;
}

export type CockpitActionKind = "accept" | "reject" | "cancel" | "pin" | "play";

/** One queued offline action (B7 Fiabilidade). */
export interface QueuedAction {
  action: CockpitActionKind;
  requestId: string;
  idemKey: string;
  body: Record<string, unknown>;
  at: number;
}

export interface FeedEntry {
  id: string;
  kind: "paid" | "refunded" | "sla_missed" | "played";
  track: string;
  amountCents: number;
  at: string;
}

export interface CockpitStats {
  revenuePerHour: Array<{ hour: string; totalCents: number; count: number }>;
  acceptance: { accepted: number; decided: number; rate: number | null };
  refundsByReason: Array<{ reason: string; count: number; totalCents: number }>;
  topTracks: Array<{ title: string; artist: string; count: number; totalCents: number }>;
  payouts: Array<{ recipient: string; amountCents: number; status: string }>;
  statement: { gmv: number; refunds: number; djNet: number };
  djShareProjection: number;
}

export interface EndSetSummary {
  closedRequests: number;
  statement: {
    gmv: number;
    refunds: number;
    betbeatFee: number;
    venueNet: number;
    djNet: number;
  };
}
