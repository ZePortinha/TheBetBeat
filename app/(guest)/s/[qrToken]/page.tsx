import { resolveGuestContext } from "@/app/api/guest/_lib/context";
import { buildSessionState } from "@/app/api/guest/_lib/session-state";
import { SessionScreen } from "@/components/guest/session-screen";
import { TokenError } from "@/components/guest/token-error";

export const dynamic = "force-dynamic";

/** /s/[qrToken] — HMAC-verified entry point of the guest app (B6). */
export default async function GuestSessionPage({
  params,
}: {
  params: Promise<{ qrToken: string }>;
}) {
  const { qrToken } = await params;
  const token = decodeURIComponent(qrToken);
  const resolved = await resolveGuestContext(token);
  if (!resolved.ok) return <TokenError kind={resolved.error} />;

  const state = await buildSessionState(resolved.ctx);
  const ctx = resolved.ctx;

  return (
    <SessionScreen
      token={token}
      info={{
        sessionId: ctx.sessionId,
        venueName: ctx.venueName,
        sessionName: ctx.sessionName,
        djName: ctx.djName,
        zoneName: ctx.zoneName,
        status: ctx.status,
        requestsOpen: ctx.requestsOpen,
        endsAt: ctx.endsAt,
      }}
      initialState={state}
    />
  );
}
