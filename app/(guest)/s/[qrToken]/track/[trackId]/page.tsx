import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPool } from "@/lib/db";
import { loadNight } from "@/lib/auction/service";
import { ensureTrackBpm } from "@/lib/catalog/service";
import { isUuid, resolveGuestPage } from "@/app/(guest)/_lib/guest-page";
import { BidScreen } from "@/components/guest/auction-screens";
import { BackHeader } from "@/components/guest/back-header";
import { TokenError } from "@/components/guest/token-error";

export const dynamic = "force-dynamic";

interface TrackProps {
  id: string;
  title: string;
  artist: string;
  bpm: number | null;
  camelotKey: string | null;
  coverUrl: string | null;
}

/** The club's library first; the full catalog when the DJ opened it tonight. */
async function findTrack(trackId: string, venueId: string, sessionId: string): Promise<TrackProps | null> {
  const pool = getPool();
  const lib = await pool.query<{ id: string; title: string; artist: string; bpm: string | null; camelot_key: string | null }>(
    `select id, title, artist, bpm, camelot_key from public.library_tracks where id = $1 and venue_id = $2 and not blocked`,
    [trackId, venueId],
  );
  const l = lib.rows[0];
  if (l) return { id: l.id, title: l.title, artist: l.artist, bpm: l.bpm === null ? null : Number(l.bpm), camelotKey: l.camelot_key, coverUrl: null };

  const night = await loadNight(pool, sessionId);
  if (!night?.catalogOpen) return null;
  // Its price depends on its tempo: find the BPM now if we never did.
  const bpm = await ensureTrackBpm(trackId).catch(() => null);
  const cat = await pool.query<{ id: string; title: string; artist: string; camelot_key: string | null; cover_url: string | null }>(
    `select id, title, artist, camelot_key, cover_url from public.tracks where id = $1`,
    [trackId],
  );
  const c = cat.rows[0];
  return c ? { id: c.id, title: c.title, artist: c.artist, bpm, camelotKey: c.camelot_key, coverUrl: c.cover_url } : null;
}

/** /s/[qrToken]/track/[trackId] — bid with this track on the open auction (slot auctions). */
export default async function GuestTrackPage({
  params,
}: {
  params: Promise<{ qrToken: string; trackId: string }>;
}) {
  const { token, resolved } = await resolveGuestPage(params);
  if (!resolved.ok) return <TokenError kind={resolved.error} />;

  const { trackId } = await params;
  const searchHref = `/s/${encodeURIComponent(token)}/search`;
  // A malformed id can only come from a hand-edited URL: back to search.
  if (!isUuid(trackId)) redirect(searchHref);
  const track = await findTrack(trackId, resolved.ctx.venueId, resolved.ctx.sessionId);
  if (!track) redirect(searchHref);

  const t = await getTranslations("guest.auction");
  return (
    <main className="flex min-h-dvh flex-col gap-5 px-4 pb-[calc(var(--dock-h)+1.5rem)] pt-6">
      <BackHeader title={t("bidTitle")} backHref={searchHref} />
      <BidScreen token={token} sessionId={resolved.ctx.sessionId} track={track} />
    </main>
  );
}
