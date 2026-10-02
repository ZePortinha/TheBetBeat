import { redirect } from "next/navigation";
import { isUuid, resolveGuestPage } from "@/app/(guest)/_lib/guest-page";
import { TrackingScreen } from "@/components/guest/tracking-screen";
import { TokenError } from "@/components/guest/token-error";

export const dynamic = "force-dynamic";

/** /s/[qrToken]/requests/[id] — tracking + "Tocou" (B6 screens 5–6). */
export default async function GuestRequestPage({
  params,
}: {
  params: Promise<{ qrToken: string; id: string }>;
}) {
  const { token, resolved } = await resolveGuestPage(params);
  if (!resolved.ok) return <TokenError kind={resolved.error} />;

  const { id } = await params;
  if (!isUuid(id)) redirect(`/s/${encodeURIComponent(token)}/requests`);

  return <TrackingScreen token={token} requestId={id} />;
}
