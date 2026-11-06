import { notFound } from "next/navigation";
import { isUuid, resolveGuestPage } from "@/app/(guest)/_lib/guest-page";
import { TokenError } from "@/components/guest/token-error";
import { WinScreen } from "@/components/guest/win-screen";

export const dynamic = "force-dynamic";

/**
 * /s/[qrToken]/win/[slotId] — the winner's moment on a screen of its own
 * (owner, 2026-11-06): the whole screen, no scrolling, no tab bar, only
 * "Partilhar no Instagram" and "Voltar" (to the ranking, at the guest's
 * place). What it shows comes from the guest's own auction state, so it
 * only ever opens for the guest who won that auction.
 */
export default async function GuestWinPage({
  params,
}: {
  params: Promise<{ qrToken: string; slotId: string }>;
}) {
  const { slotId } = await params;
  if (!isUuid(slotId)) notFound();
  const { token, resolved } = await resolveGuestPage(params);
  if (!resolved.ok) return <TokenError kind={resolved.error} />;
  return <WinScreen token={token} slotId={slotId} venueName={resolved.ctx.venueName} />;
}
