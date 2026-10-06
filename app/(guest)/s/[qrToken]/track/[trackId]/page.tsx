import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPool } from "@/lib/db";
import { isUuid, resolveGuestPage } from "@/app/(guest)/_lib/guest-page";
import { BidScreen } from "@/components/guest/auction-screens";
import { BackHeader } from "@/components/guest/back-header";
import { TokenError } from "@/components/guest/token-error";

export const dynamic = "force-dynamic";

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
  const res = await getPool().query<{ id: string; title: string; artist: string }>(
    `select id, title, artist from public.library_tracks where id = $1 and venue_id = $2 and not blocked`,
    [trackId, resolved.ctx.venueId],
  );
  const track = res.rows[0];
  if (!track) redirect(searchHref);

  const t = await getTranslations("guest.auction");
  return (
    <main className="flex min-h-dvh flex-col gap-5 px-4 pb-[calc(var(--dock-h)+1.5rem)] pt-6">
      <BackHeader title={t("bidTitle")} backHref={searchHref} />
      <BidScreen token={token} sessionId={resolved.ctx.sessionId} track={track} />
    </main>
  );
}
