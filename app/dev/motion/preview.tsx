"use client";

/**
 * Fixture-driven preview of the guest auction moments (dev only). The
 * components are the real ones; only the auction state is fixed and moved
 * by the buttons at the top right. Fictional tracks, handles and art.
 */

import * as React from "react";
import type { PublicSlot, PublicWinner } from "@/lib/auction/service";
import {
  AuctionOverlays,
  AuctionScreen,
  AuctionTeaser,
  NightWinners,
  RankingPodium,
} from "@/components/guest/auction-screens";
import { PartyHeading, TabBar } from "@/components/guest/party-chrome";
import {
  AuctionStaticProvider,
  type AuctionContextValue,
  type AuctionState,
  type ClosedAuction,
} from "@/components/guest/use-auction";

type Scenario = "auction" | "home" | "podium" | "win" | "closed";

/** Abstract square "album art" (no real covers in fixtures). */
function art(a: string, b: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='100' height='100' fill='url(#g)'/><circle cx='68' cy='34' r='22' fill='white' fill-opacity='0.18'/><circle cx='30' cy='72' r='34' fill='black' fill-opacity='0.22'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const COVERS = [art("#ff6b3d", "#6d1a8c"), art("#1fb6ff", "#0b1f4d"), art("#ffd60a", "#c2185b"), art("#30d158", "#0a3d2e")];
const BIDDERS = ["@rita.m", "Mesa 12", "@noite.longa", null, "@duarte_k"];
const TRACKS = [
  ["Luz de Néon", "Os Vértices"],
  ["Maré Alta", "Clara Sol"],
  ["Cidade Acesa", "Turno da Noite"],
  ["Pulso", "Faro Norte"],
] as const;

const ruleSet: AuctionState["rules"] = {
  quickBidStepsCents: [200, 500, 1000],
  minIncrementCents: 100,
  minIncrementBps: 500,
  lastMinuteWarningSec: 60,
  screenNameCents: 5000,
  showAmountOnScreen: true,
  keepBalanceAllowed: false,
  keepBalanceDays: 30,
  transition: { easyMaxPct: 4, mediumMaxPct: 8, easyBps: 10_000, mediumBps: 15_000, hardBps: 25_000, unknownBps: 15_000 },
};

function winner(i: number, now: number, slotId = `w${i}`): PublicWinner {
  const [title, artist] = TRACKS[i % TRACKS.length]!;
  return {
    slotId,
    kind: "regular",
    trackTitle: title,
    trackArtist: artist,
    label: BIDDERS[i % BIDDERS.length] ?? null,
    by: BIDDERS[i % BIDDERS.length] ?? null,
    coverUrl: COVERS[i % COVERS.length]!,
    totalCents: 1800 + i * 1350,
    playStatus: "pending" as PublicWinner["playStatus"],
    recognition: null,
    closedAt: new Date(now - i * 900_000).toISOString(),
    playBy: new Date(now + 600_000 - i * 900_000).toISOString(),
    refundAt: new Date(now + 900_000 - i * 900_000).toISOString(),
  };
}

function initialState(now: number, leftSec: number, scenario: Scenario): AuctionState {
  const closesAt = new Date(now + leftSec * 1000).toISOString();
  const slot: PublicSlot = {
    id: "slot-live",
    kind: "regular",
    phase: "peak",
    opensAt: new Date(now - 240_000).toISOString(),
    closesAt,
    scheduledCloseAt: closesAt,
    minPriceCents: 500,
    minNextCents: 2700,
    extensions: 0,
    bids: 4,
    top: {
      bidId: "bid-1",
      totalCents: 2500,
      trackTitle: TRACKS[0][0],
      trackArtist: TRACKS[0][1],
      label: "@rita.m",
      by: "@rita.m",
      coverUrl: COVERS[0]!,
      backers: 2,
    },
  } as PublicSlot;
  return {
    serverNow: new Date(now).toISOString(),
    open: scenario === "podium" ? [] : [slot],
    next: { id: "next-1", kind: "regular", opensAt: new Date(now + 900_000).toISOString(), closesAt: new Date(now + 1_140_000).toISOString(), minPriceCents: 500 },
    upcoming: [
      { id: "next-1", kind: "regular", opensAt: new Date(now + 900_000).toISOString(), closesAt: new Date(now + 1_140_000).toISOString(), minPriceCents: 500 },
      { id: "next-2", kind: "special", opensAt: new Date(now + 2_700_000).toISOString(), closesAt: new Date(now + 4_500_000).toISOString(), minPriceCents: 1000 },
    ],
    upNext: winner(1, now, "w-up"),
    recentWinners: [winner(2, now), winner(3, now), winner(0, now)],
    ranking: [
      { label: "@noite.longa", spentCents: 14_200 },
      { label: "Mesa 12", spentCents: 9_650 },
      { label: "@rita.m", spentCents: 7_300 },
      { label: "@duarte_k", spentCents: 4_100 },
      { label: null, spentCents: 3_200 },
      { label: "@lia.f", spentCents: 1_800 },
    ],
    nowPlaying: { title: "Cidade Acesa", artist: "Turno da Noite", bpm: 124, camelotKey: "8A" },
    rules: ruleSet,
    me: {
      walletCents: 0,
      keepBalance: false,
      bids: [
        {
          slotId: "slot-live",
          bidId: "bid-1",
          slotKind: "regular",
          closesAt,
          trackTitle: TRACKS[0][0],
          trackArtist: TRACKS[0][1],
          owner: true,
          libraryTrackId: "t-1",
          myCents: 2500,
          totalCents: 2500,
          status: "leading",
        },
      ],
      pending: [],
    },
    paymentMethods: ["card", "mbway"],
  } as AuctionState;
}

export function MotionPreview({ scenario, leftSec }: { scenario: Scenario; leftSec: number }) {
  const [now, setNow] = React.useState(() => Date.now());
  const [state, setState] = React.useState<AuctionState>(() => initialState(now, leftSec, scenario));
  const [celebrate, setCelebrate] = React.useState<string | null>(scenario === "win" ? "slot-live" : null);
  const [closed, setClosed] = React.useState<ClosedAuction | null>(null);
  const bidder = React.useRef(1);

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  React.useEffect(() => {
    if (scenario !== "closed") return;
    const id = setTimeout(() => {
      const w = winner(2, Date.now(), "slot-closed");
      setClosed({ slotId: w.slotId, by: w.by, totalCents: w.totalCents, trackTitle: w.trackTitle, trackArtist: w.trackArtist, coverUrl: w.coverUrl, hadBid: true });
    }, 600);
    return () => clearTimeout(id);
  }, [scenario]);

  const slot = state.open[0];
  const patchSlot = (fn: (s: PublicSlot) => PublicSlot) => setState((st) => ({ ...st, open: st.open.map(fn) }));

  const actions: Array<[string, () => void]> = [
    [
      "outbid",
      () => {
        const i = bidder.current++;
        const [title, artist] = TRACKS[i % TRACKS.length]!;
        patchSlot((s) => ({
          ...s,
          minNextCents: (s.top?.totalCents ?? 0) + 700,
          top: { bidId: `bid-x${i}`, totalCents: (s.top?.totalCents ?? 0) + 500, trackTitle: title, trackArtist: artist, label: BIDDERS[i % BIDDERS.length] ?? null, by: BIDDERS[i % BIDDERS.length] ?? null, coverUrl: COVERS[i % COVERS.length]!, backers: 1 },
        }));
        setState((st) => ({ ...st, me: st.me && { ...st.me, walletCents: 2500, bids: st.me.bids.map((b) => ({ ...b, status: "outbid" as const, myCents: 0 })) } }));
      },
    ],
    ["raise", () => patchSlot((s) => (s.top ? { ...s, top: { ...s.top, totalCents: s.top.totalCents + 500, backers: s.top.backers + 1 }, minNextCents: s.minNextCents + 500 } : s))],
    ["extend", () => patchSlot((s) => ({ ...s, closesAt: new Date(Date.parse(s.closesAt) + 30_000).toISOString(), extensions: s.extensions + 1 }))],
    [
      "close",
      () => {
        if (!slot?.top) return;
        const iLead = state.me?.bids.some((b) => b.slotId === slot.id && b.status === "leading");
        setState((st) => ({ ...st, open: [] }));
        if (iLead) setCelebrate(slot.id);
        else setClosed({ slotId: slot.id, by: slot.top.by, totalCents: slot.top.totalCents, trackTitle: slot.top.trackTitle, trackArtist: slot.top.trackArtist, coverUrl: slot.top.coverUrl, hadBid: true });
      },
    ],
  ];

  const value: AuctionContextValue = {
    state,
    refetch: async () => undefined,
    serverNow: now,
    celebrate,
    dismissCelebration: () => setCelebrate(null),
    closed,
    dismissClosed: () => setClosed(null),
    chosenSlotId: null,
    chooseSlot: () => undefined,
  };

  return (
    <AuctionStaticProvider value={value}>
      <div className="guest-type relative isolate mx-auto min-h-dvh w-full max-w-md">
        <div aria-hidden className="ambient pointer-events-none fixed inset-0 -z-10" />
        <main className="flex min-h-dvh flex-col gap-5 px-4 pb-[calc(var(--dock-h)+3rem)] pt-4">
          {scenario === "podium" ? (
            <>
              <PartyHeading title="Ranking" />
              <RankingPodium />
            </>
          ) : scenario === "home" ? (
            <>
              <PartyHeading title="Agora" />
              <AuctionTeaser token="preview" />
              <NightWinners />
            </>
          ) : (
            <>
              <PartyHeading title="Leilão" />
              <AuctionScreen token="preview" />
            </>
          )}
        </main>
        <div className="fixed bottom-28 left-2 z-[70] flex flex-col gap-1 opacity-60" data-testid="preview-controls">
          {actions.map(([name, run]) => (
            <button
              key={name}
              type="button"
              data-action={name}
              onClick={run}
              className="rounded-full bg-surface-3/80 px-2 py-1 text-[10px] font-semibold text-text-secondary"
            >
              {name}
            </button>
          ))}
        </div>
        <AuctionOverlays />
        <TabBar token="preview" />
      </div>
    </AuctionStaticProvider>
  );
}
