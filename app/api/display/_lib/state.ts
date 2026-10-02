import "server-only";

/**
 * Venue display read model (BRIEF B8).
 *
 * PUBLIC DATA ONLY. The signed display token grants nothing beyond what a
 * guest on the floor can already see: venue/session name, the playing
 * track, the next accepted request (anonymous unless the guest opted into
 * the ranking), the top-of-night handles and the zone QR link. Every query
 * below selects explicit public fields — never `select *`, never PII.
 */

import { TIER_RANK, type Tier } from "@/lib/domain/types";
import { signToken, type QrTokenPayload } from "@/lib/security/tokens";
import { env } from "@/lib/security/env";
import { createAdminClient } from "@/lib/supabase/admin";

export interface DisplayNowDto {
  title: string;
  artist: string;
  /** Requester handle — only when the guest opted into the ranking. */
  handle: string | null;
  bpm: number | null;
  /** ISO UTC — when the track started (server clock). */
  startedAt: string;
  durationSec: number | null;
}

export interface DisplayNextDto {
  title: string;
  artist: string;
  handle: string | null;
}

export interface DisplayTopEntryDto {
  handle: string;
  requests: number;
}

export interface DisplayStateDto {
  session: { name: string; venueName: string; live: boolean };
  now: DisplayNowDto | null;
  next: DisplayNextDto | null;
  /** Handles only — no amounts by default (B8). */
  top: DisplayTopEntryDto[];
  /** Absolute guest join URL for the venue's first zone (signed). */
  qrUrl: string;
  /** Server clock, ISO UTC — lets the client correct for drift. */
  serverNow: string;
}

export interface DisplayState {
  sessionId: string;
  dto: DisplayStateDto;
}

function toNum(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Statuses that count as a (still-standing) paid request tonight. */
const TOP_STATUSES = ["paid", "accepted", "playing", "played"] as const;

/**
 * Load everything the venue screen shows for a verified display token.
 * Returns null when the token's session no longer exists.
 */
export async function getDisplayState(
  payload: QrTokenPayload,
): Promise<DisplayState | null> {
  const supabase = createAdminClient();

  const { data: session } = await supabase
    .from("sessions")
    .select("id, name, status, venue_id")
    .eq("display_slug", payload.slug)
    .eq("venue_id", payload.venueId)
    .single();
  if (!session) return null;

  const [venueRes, zoneRes, nowRes, nextRes, topRes] = await Promise.all([
    supabase.from("venues").select("name").eq("id", session.venue_id).single(),
    supabase
      .from("zones")
      .select("qr_slug")
      .eq("venue_id", session.venue_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("session_tracks")
      .select("title, artist, bpm, duration_sec, started_at, request_id")
      .eq("session_id", session.id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("requests")
      .select(
        "track_title, track_artist, guest_id, tier, pinned_next, amount_cents, created_at",
      )
      .eq("session_id", session.id)
      .eq("status", "accepted")
      .limit(50),
    supabase
      .from("requests")
      .select("guest_id")
      .eq("session_id", session.id)
      .in("status", [...TOP_STATUSES])
      .limit(1000),
  ]);

  // ── Next accepted request (B5.5 spirit: pinned → tier → amount) ───
  const nextRow = (nextRes.data ?? [])
    .slice()
    .sort(
      (a, b) =>
        Number(b.pinned_next) - Number(a.pinned_next) ||
        TIER_RANK[b.tier as Tier] - TIER_RANK[a.tier as Tier] ||
        b.amount_cents - a.amount_cents ||
        a.created_at.localeCompare(b.created_at),
    )[0];

  // ── Handles: one batched lookup, opt-in only (RGPD / B8) ──────────
  const handleIds = new Set<string>();
  const nowGuestId = await resolveNowGuestId(nowRes.data?.request_id ?? null);
  if (nowGuestId) handleIds.add(nowGuestId);
  if (nextRow) handleIds.add(nextRow.guest_id);
  const counts = new Map<string, number>();
  for (const row of topRes.data ?? []) {
    counts.set(row.guest_id, (counts.get(row.guest_id) ?? 0) + 1);
    handleIds.add(row.guest_id);
  }

  const handles = new Map<string, string>();
  if (handleIds.size > 0) {
    const { data: guests } = await supabase
      .from("guests")
      .select("id, handle")
      .in("id", [...handleIds])
      .eq("ranking_optin", true)
      .not("handle", "is", null);
    for (const g of guests ?? []) {
      if (g.handle) handles.set(g.id, g.handle);
    }
  }

  const top: DisplayTopEntryDto[] = [...counts.entries()]
    .filter(([guestId]) => handles.has(guestId))
    .map(([guestId, requests]) => ({ handle: handles.get(guestId)!, requests }))
    .sort((a, b) => b.requests - a.requests || a.handle.localeCompare(b.handle))
    .slice(0, 10);

  const qrToken = zoneRes.data
    ? signToken({
        kind: "zone",
        venueId: session.venue_id,
        slug: zoneRes.data.qr_slug,
      })
    : null;

  const dto: DisplayStateDto = {
    session: {
      name: session.name,
      venueName: venueRes.data?.name ?? "",
      live: session.status === "live",
    },
    now: nowRes.data
      ? {
          title: nowRes.data.title,
          artist: nowRes.data.artist,
          handle: nowGuestId ? (handles.get(nowGuestId) ?? null) : null,
          bpm: toNum(nowRes.data.bpm),
          startedAt: new Date(nowRes.data.started_at).toISOString(),
          durationSec: nowRes.data.duration_sec ?? null,
        }
      : null,
    next: nextRow
      ? {
          title: nextRow.track_title,
          artist: nextRow.track_artist,
          handle: handles.get(nextRow.guest_id) ?? null,
        }
      : null,
    top,
    qrUrl: qrToken
      ? `${env.NEXT_PUBLIC_APP_URL}/s/${encodeURIComponent(qrToken)}`
      : `${env.NEXT_PUBLIC_APP_URL}`,
    serverNow: new Date().toISOString(),
  };

  return { sessionId: session.id, dto };

  async function resolveNowGuestId(requestId: string | null): Promise<string | null> {
    if (!requestId) return null;
    const { data } = await supabase
      .from("requests")
      .select("guest_id")
      .eq("id", requestId)
      .maybeSingle();
    return data?.guest_id ?? null;
  }
}
