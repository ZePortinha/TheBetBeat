import { resolveGuestPage } from "@/app/(guest)/_lib/guest-page";
import { buildSessionState } from "@/app/api/guest/_lib/session-state";
import { QueueScreen } from "@/components/guest/public-screens";
import { TokenError } from "@/components/guest/token-error";

export const dynamic = "force-dynamic";

/** /s/[qrToken]/queue — "Agora na pista" (B6.7): public data only. */
export default async function GuestQueuePage({
  params,
}: {
  params: Promise<{ qrToken: string }>;
}) {
  const { token, resolved } = await resolveGuestPage(params);
  if (!resolved.ok) return <TokenError kind={resolved.error} />;
  const state = await buildSessionState(resolved.ctx);
  return (
    <QueueScreen token={token} sessionId={resolved.ctx.sessionId} initialState={state} />
  );
}
