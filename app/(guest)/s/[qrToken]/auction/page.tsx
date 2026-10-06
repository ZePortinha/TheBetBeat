import { Gavel } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { resolveGuestPage } from "@/app/(guest)/_lib/guest-page";
import { AuctionScreen } from "@/components/guest/auction-screens";
import { PartyHeading, PartyTopBar } from "@/components/guest/party-chrome";
import { TokenError } from "@/components/guest/token-error";

export const dynamic = "force-dynamic";

/** /s/[qrToken]/auction — the centre tab: pick the auction, then bid, raise or back. */
export default async function GuestAuctionPage({ params }: { params: Promise<{ qrToken: string }> }) {
  const { token, resolved } = await resolveGuestPage(params);
  if (!resolved.ok) return <TokenError kind={resolved.error} />;
  const t = await getTranslations("guest.auction");
  return (
    <main className="flex min-h-dvh flex-col gap-5 px-4 pb-[calc(var(--dock-h)+3rem)] pt-4">
      <PartyTopBar />
      <PartyHeading
        eyebrow={
          <>
            <Gavel size={14} aria-hidden />
            {t("screenEyebrow")}
          </>
        }
        title={t("screenTitle")}
      />
      <AuctionScreen token={token} />
    </main>
  );
}
