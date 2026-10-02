import { redirect } from "next/navigation";
import { isUuid, resolveGuestPage } from "@/app/(guest)/_lib/guest-page";
import { TierScreen } from "@/components/guest/tier-screen";
import { TokenError } from "@/components/guest/token-error";

export const dynamic = "force-dynamic";

/** /s/[qrToken]/track/[trackId] — tier choice + payment sheet (B6 screens 3–4). */
export default async function GuestTrackPage({
  params,
}: {
  params: Promise<{ qrToken: string; trackId: string }>;
}) {
  const { token, resolved } = await resolveGuestPage(params);
  if (!resolved.ok) return <TokenError kind={resolved.error} />;

  const { trackId } = await params;
  // A malformed id can only come from a hand-edited URL: back to search.
  if (!isUuid(trackId)) redirect(`/s/${encodeURIComponent(token)}/search`);

  return <TierScreen token={token} trackId={trackId} />;
}
