import { resolveGuestPage } from "@/app/(guest)/_lib/guest-page";
import { PartyChrome } from "@/components/guest/party-chrome";

/** Party screens share the co-branded chrome and the tab bar (2026-10-05). */
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
  return (
    <PartyChrome token={token} venueName={resolved.ctx.venueName}>
      {children}
    </PartyChrome>
  );
}
