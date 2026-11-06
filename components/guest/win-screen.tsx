"use client";

/**
 * The winner's page (2026-11-06): the celebration on a screen of its own.
 * The song, the cover and the total come from the winning bid in the
 * guest's own auction state (win-details), so the page only ever shows a
 * win that is theirs; anyone else, or a slot that was not won, goes back to
 * the party. The party layout draws it (party-chrome), the moment the win
 * lands, before the address has changed. "Voltar" leads to the ranking, which then moves to the guest's
 * place. The page replaces itself on the way out, so Back from the ranking
 * does not land on the celebration again.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { rankingPath } from "./party-paths";
import { useAuction } from "./use-auction";
import { WinCelebration } from "./win-celebration";
import { winDetails } from "./win-details";

export function WinScreen({
  token,
  slotId,
  venueName,
  onLeave,
}: {
  token: string;
  slotId: string;
  venueName: string;
  /** The layout stops drawing the screen (Voltar, or not a win of mine). */
  onLeave?: () => void;
}) {
  const router = useRouter();
  const { state } = useAuction();
  const won = state ? winDetails(slotId, state.me, [state.upNext, ...state.recentWinners]) : null;
  const loaded = state !== null;

  React.useEffect(() => {
    if (!loaded || won) return;
    onLeave?.();
    router.replace(`/s/${token}`);
  }, [loaded, won, router, token, onLeave]);

  const back = React.useCallback(() => {
    onLeave?.();
    router.replace(rankingPath(token, { me: true }));
  }, [router, token, onLeave]);

  // Black until the state says what was won (no flash of the party behind).
  if (!won) return <div aria-hidden className="cover-chrome fixed inset-0 z-50 bg-bg-base" />;
  return (
    <WinCelebration
      slotId={won.slotId}
      trackTitle={won.trackTitle}
      trackArtist={won.trackArtist}
      totalCents={won.totalCents}
      coverUrl={won.coverUrl}
      venueName={venueName}
      onBack={back}
    />
  );
}
