"use client";

/**
 * "Ranking" (B6.8): who spent the most tonight, the top 3 on a podium and
 * everyone else below (public amounts, @ or "Anónimo", never a name).
 * The live queue moved to the home ("Agora") on 2026-10-06.
 */

import { useTranslations } from "next-intl";
import { RankingPodium } from "./ranking";
import { PartyHeading, PartyTopBar } from "./party-chrome";

/** No label above the title: the tab bar already says where you are. */
export function TopScreen({ token }: { token: string }) {
  const t = useTranslations("guest.top");
  const ta = useTranslations("guest.auction");

  return (
    <main className="flex min-h-dvh flex-col gap-6 px-4 pb-[calc(var(--dock-h)+3rem)] pt-4">
      <PartyTopBar />
      <PartyHeading title={t("title")} sub={ta("rankingTitle")} />
      <RankingPodium token={token} />
    </main>
  );
}
