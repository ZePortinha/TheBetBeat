import "server-only";

/**
 * Venue display read model (BRIEF B8).
 *
 * PUBLIC DATA ONLY. The signed display token grants nothing beyond what a
 * guest on the floor can already see: venue/session name, the playing
 * track, tonight's slot auctions (the same public state the guest app
 * shows: open auction, "A seguir", winners, ranking by spend — labels are
 * the chosen @ or table, never a name) and the zone QR link. Every query
 * below selects explicit public fields — never `select *`, never PII.
 */

import { publicAuctionState, type PublicAuctionState } from "@/lib/auction/service";
import { signToken, type QrTokenPayload } from "@/lib/security/tokens";
import { env } from "@/lib/security/env";
import { createAdminClient } from "@/lib/supabase/admin";

export interface DisplayNowDto {
  title: string;
  artist: string;
  /** The winner's public label (@ or table), when the track came from an auction. */
  handle: string | null;
  bpm: number | null;
  /** ISO UTC — when the track started (server clock). */
  startedAt: string;
  durationSec: number | null;
}

export interface DisplayStateDto {
  session: { name: string; venueName: string; live: boolean };
  now: DisplayNowDto | null;
  /** Tonight's slot auctions (amounts per the club's showAmountOnScreen). */
  auction: PublicAuctionState | null;
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

  const [venueRes, zoneRes, nowRes, auction] = await Promise.all([
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
      .select("title, artist, bpm, duration_sec, started_at")
      .eq("session_id", session.id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    publicAuctionState(session.id, Date.now()),
  ]);
  const playingWinner = auction?.recentWinners.find((w) => w.playStatus === "playing");

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
          handle: playingWinner && playingWinner.trackTitle === nowRes.data.title ? playingWinner.label : null,
          bpm: toNum(nowRes.data.bpm),
          startedAt: new Date(nowRes.data.started_at).toISOString(),
          durationSec: nowRes.data.duration_sec ?? null,
        }
      : null,
    auction,
    qrUrl: qrToken
      ? `${env.NEXT_PUBLIC_APP_URL}/s/${encodeURIComponent(qrToken)}`
      : `${env.NEXT_PUBLIC_APP_URL}`,
    serverNow: new Date().toISOString(),
  };

  return { sessionId: session.id, dto };
}
