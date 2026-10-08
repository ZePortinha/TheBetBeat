import { resolveGuestPage } from "@/app/(guest)/_lib/guest-page";
import { PartyChrome } from "@/components/guest/party-chrome";
import { env } from "@/lib/security/env";

/**
 * Party screens share the co-branded chrome and the tab bar (2026-10-05).
 * Since 2026-10-08 the party opens with the phone sign-in (number + SMS
 * code; a new number also picks its @). The one exception is a production
 * build still on the mock SMS provider: nobody would ever get a code, so
 * guests go straight in as before until real SMS is configured.
 */
export default async function PartyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ qrToken: string }>;
}) {
  const { token, resolved } = await resolveGuestPage(params);
  // Bad token or no live session: the page itself renders the error.
  if (!resolved.ok) return children;
  const phoneRequired = !(process.env.NODE_ENV === "production" && env.SMS_PROVIDER === "mock");
  return (
    <PartyChrome
      token={token}
      venueName={resolved.ctx.venueName}
      sessionId={resolved.ctx.sessionId}
      phoneRequired={phoneRequired}
    >
      {children}
    </PartyChrome>
  );
}
