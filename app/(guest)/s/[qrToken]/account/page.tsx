import { resolveGuestPage } from "@/app/(guest)/_lib/guest-page";
import { PhoneLoginScreen } from "@/components/guest/phone-login-screen";
import { TokenError } from "@/components/guest/token-error";

export const dynamic = "force-dynamic";

/** /s/[qrToken]/account — optional phone sign-in by SMS code (2026-10-05). */
export default async function GuestAccountPage({
  params,
}: {
  params: Promise<{ qrToken: string }>;
}) {
  const { token, resolved } = await resolveGuestPage(params);
  if (!resolved.ok) return <TokenError kind={resolved.error} />;
  return <PhoneLoginScreen token={token} />;
}
