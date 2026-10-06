/**
 * Client-side mirrors of the guest API DTOs (explicit shapes, B12.4).
 * Types only — safe to import from client components.
 */
import type {
  CloseReason,
  FitLabel,
  PaymentMethod,
  PaymentStatus,
  RequestStatus,
  Tier,
} from "@/lib/domain/types";

export interface SessionInfo {
  sessionId: string;
  venueName: string;
  sessionName: string;
  djName: string | null;
  zoneName: string;
  status: string;
  requestsOpen: boolean;
  endsAt: string;
}

export interface NowPlayingDto {
  title: string;
  artist: string;
  genre: string | null;
  bpm: number | null;
  startedAt: string;
  durationSec: number | null;
  /** Album art when we know it (catalog), for the hero background. */
  coverUrl: string | null;
  /**
   * Who chose it: null = the DJ's own pick; otherwise the auction winner,
   * shown the way they chose when bidding (label null = anonymous).
   */
  pickedBy: { label: string | null } | null;
}

export interface SessionStateDto {
  session: {
    name: string;
    venueName: string;
    djName: string | null;
    status: string;
    requestsOpen: boolean;
    endsAt: string;
  };
  nowPlaying: NowPlayingDto | null;
  upNext: Array<{ title: string; artist: string; tier: Tier }>;
  top: {
    tracks: Array<{ title: string; artist: string; count: number }>;
    guests: Array<{ handle: string; count: number }>;
  };
}

export interface SearchTrackDto {
  id: string;
  title: string;
  artist: string;
  genre: string | null;
  bpm: number | null;
  camelotKey: string | null;
  coverUrl: string | null;
  source: "library" | "catalog";
  fitLabel: FitLabel;
  /** Transition out of what is playing now. */
  transition: "easy" | "medium" | "hard" | "unknown";
  available: boolean;
  reason?: "blocked" | "recently_played";
}

export interface SearchResponseDto {
  sections: Array<{
    key: "results" | "catalog" | "trending" | "fits" | "popular" | "recent";
    tracks: SearchTrackDto[];
  }>;
  /** The full catalog has more results (next page). */
  hasMore?: boolean;
  albums?: AlbumDto[];
}

export interface AlbumDto {
  providerAlbumId: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  trackCount: number | null;
}

export interface QuoteTierDto {
  tier: Tier;
  priceCents: number;
  etaDisplayMin: number;
  available: boolean;
  reason?: string;
  minCents: number;
  maxCents: number;
}

export interface QuoteDto {
  quoteId: string;
  expiresAt: string;
  fit: { score: number; label: FitLabel };
  demand: { level: "low" | "medium" | "high" | "very_high" };
  tiers: QuoteTierDto[];
  track: {
    id: string;
    title: string;
    artist: string;
    genre: string | null;
    bpm: number | null;
    camelotKey: string | null;
    durationSec: number | null;
  };
}

export interface CreateRequestResponse {
  requestId: string;
  status: RequestStatus;
  payment: {
    paymentId: string;
    method: PaymentMethod;
    status: PaymentStatus;
    expiresAt: string | null;
  };
}

export interface GuestRequestDetail {
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
  queuePosition: number | null;
  etaMin: number | null;
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    expiresAt: string | null;
    createdAt: string;
  } | null;
}

export interface GuestRequestListItem {
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
  deadlineAt: string | null;
  paidAt: string | null;
  playedAt: string | null;
  createdAt: string;
  sessionId: string;
  invoiceRef: string | null;
}

export interface UpgradeOptionDto {
  tier: Tier;
  available: boolean;
  reason?: string;
  priceCents: number;
  diffCents: number;
  etaDisplayMin: number;
}

export interface UpgradePreviewDto {
  upgradable: boolean;
  options: UpgradeOptionDto[];
}

export interface UpgradeResultDto {
  requestId: string;
  toTier: Tier;
  chargedCents: number;
  state: "applied" | "pending_payment";
  payment: { expiresAt: string | null } | null;
}

export interface DevPaymentDto {
  paymentId: string;
  requestId: string;
  providerRef: string | null;
  method: string;
  status: string;
  amountCents: number;
  expiresAt: string | null;
  trackTitle: string;
}

export const ACTIVE_REQUEST_STATUSES: RequestStatus[] = [
  "pending_payment",
  "paid",
  "accepted",
  "playing",
];
