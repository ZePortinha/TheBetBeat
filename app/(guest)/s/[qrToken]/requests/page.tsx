import { resolveGuestPage } from "@/app/(guest)/_lib/guest-page";
import { MyRequestsScreen } from "@/components/guest/my-requests-screen";
import { TokenError } from "@/components/guest/token-error";

export const dynamic = "force-dynamic";

/** /s/[qrToken]/requests — "Os meus pedidos": history, receipts, refunds (B6.9). */
export default async function GuestMyRequestsPage({
  params,
}: {
  params: Promise<{ qrToken: string }>;
}) {
  const { token, resolved } = await resolveGuestPage(params);
  if (!resolved.ok) return <TokenError kind={resolved.error} />;
  return <MyRequestsScreen token={token} sessionId={resolved.ctx.sessionId} />;
}
