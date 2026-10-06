import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { resolveGuestPage } from "@/app/(guest)/_lib/guest-page";
import { AlbumScreen } from "@/components/guest/album-screen";
import { BackHeader } from "@/components/guest/back-header";
import { TokenError } from "@/components/guest/token-error";

export const dynamic = "force-dynamic";

/** /s/[qrToken]/album/[albumId] — an album of the full catalog, every song biddable. */
export default async function GuestAlbumPage({
  params,
}: {
  params: Promise<{ qrToken: string; albumId: string }>;
}) {
  const { token, resolved } = await resolveGuestPage(params);
  if (!resolved.ok) return <TokenError kind={resolved.error} />;
  const { albumId } = await params;
  const searchHref = `/s/${encodeURIComponent(token)}/search`;
  if (!/^\d{1,20}$/.test(albumId)) redirect(searchHref);

  const t = await getTranslations("guest.search");
  return (
    <main className="flex min-h-dvh flex-col gap-5 px-4 pb-[calc(var(--dock-h)+1.5rem)] pt-6">
      <BackHeader title={t("album")} backHref={searchHref} />
      <AlbumScreen token={token} albumId={albumId} />
    </main>
  );
}
