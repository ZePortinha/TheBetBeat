import { resolveGuestPage } from "@/app/(guest)/_lib/guest-page";
import { TopScreen } from "@/components/guest/public-screens";
import { TokenError } from "@/components/guest/token-error";

export const dynamic = "force-dynamic";

/** /s/[qrToken]/top — "Top da noite" (B6.8): opt-in ranking, amounts hidden. */
export default async function GuestTopPage({
  params,
}: {
  params: Promise<{ qrToken: string }>;
}) {
  const { token, resolved } = await resolveGuestPage(params);
  if (!resolved.ok) return <TokenError kind={resolved.error} />;
  return <TopScreen token={token} />;
}
