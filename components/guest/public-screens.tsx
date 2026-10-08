"use client";

/**
 * "Ranking" (B6.8): who spent the most tonight, the top 3 on a podium and
 * everyone else below (public amounts, @ or "Anónimo", never a name).
 * The live queue moved to the home ("Agora") on 2026-10-06.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { publicChannel } from "@/lib/realtime/events";
import { useRealtimeChannel } from "@/lib/realtime/client";
import { apiFetch } from "./api";
import { RankingPodium } from "./ranking";
import { LiveDot, PartyHeading, PartyTopBar } from "./party-chrome";
import type { SessionStateDto } from "./types";

function useSessionState(token: string, sessionId: string, initial: SessionStateDto) {
  const [state, setState] = React.useState(initial);
  const refetch = React.useCallback(async () => {
    const res = await apiFetch<SessionStateDto>(
      `/api/guest/session-state?token=${encodeURIComponent(token)}`,
    );
    if (res.ok) setState(res.data);
  }, [token]);
  React.useEffect(() => {
    const id = setInterval(() => void refetch(), 15_000);
    return () => clearInterval(id);
  }, [refetch]);
  useRealtimeChannel(publicChannel(sessionId), { private: false }, () => void refetch());
  return state;
}

export function TopScreen({
  token,
  sessionId,
  initialState,
}: {
  token: string;
  sessionId: string;
  initialState: SessionStateDto;
}) {
  const t = useTranslations("guest.top");
  const ta = useTranslations("guest.auction");
  const state = useSessionState(token, sessionId, initialState);
  const dj = state.session.djName;

  return (
    <main className="flex min-h-dvh flex-col gap-6 px-4 pb-[calc(var(--dock-h)+3rem)] pt-4">
      <PartyTopBar />
      <PartyHeading
        eyebrow={
          <>
            <LiveDot />
            {dj ? t("eyebrowDj", { dj }) : t("eyebrow")}
          </>
        }
        title={t("title")}
        sub={ta("rankingTitle")}
      />
      <RankingPodium token={token} />
    </main>
  );
}
