import { resolveGuestContext } from "@/app/api/guest/_lib/context";
import { SearchScreen } from "@/components/guest/search-screen";
import { TokenError } from "@/components/guest/token-error";

export const dynamic = "force-dynamic";

export default async function GuestSearchPage({
  params,
}: {
  params: Promise<{ qrToken: string }>;
}) {
  const { qrToken } = await params;
  const token = decodeURIComponent(qrToken);
  const resolved = await resolveGuestContext(token);
  if (!resolved.ok) return <TokenError kind={resolved.error} />;
  return <SearchScreen token={token} />;
}
