"use client";

/**
 * Live slot auctions for the guest app: polls /api/guest/auction (3 s),
 * refetches on every public or own-channel event, counts down on the
 * SERVER clock (offset from `serverNow`), and turns "auction.outbid" into
 * a toast + vibration and "auction.won" into the celebration.
 *
 * One AuctionProvider per party layout: every tab reads the same state
 * (one poll, no reload when switching tabs), and the auction the guest
 * picked on the Leilão tab travels with them through search to the bid.
 *
 * It also notices when an open auction closes with a winner who is not
 * this guest (`closed`), so every tab can show the gavel coming down.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import type { MyAuctionState, PublicAuctionState } from "@/lib/auction/service";
import type { PaymentMethod } from "@/lib/domain/types";
import { guestChannel, publicChannel } from "@/lib/realtime/events";
import { useRealtimeChannel } from "@/lib/realtime/client";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "./api";
import { useGuest } from "./guest-providers";

export type AuctionState = PublicAuctionState & { me: MyAuctionState | null; paymentMethods: PaymentMethod[] };

/** An auction that just closed, as the guests who did not win it see it. */
export interface ClosedAuction {
  slotId: string;
  by: string | null;
  totalCents: number;
  trackTitle: string;
  trackArtist: string;
  coverUrl: string | null;
  /** This guest had a bid in it (their money is already in the balance). */
  hadBid: boolean;
}

const POLL_MS = 3000;
/** The final stretch of an auction: the screen flashes red ↔ white. */
export const FINAL_STRETCH_MS = 30_000;
/** The last seconds: the flash doubles its tempo. */
export const URGENT_MS = 10_000;

/** True while an auction is in its last 30 seconds. */
export function inFinalStretch(closesAtIso: string, serverNow: number): boolean {
  const left = Date.parse(closesAtIso) - serverNow;
  return left > 0 && left <= FINAL_STRETCH_MS;
}

/** True in the last 10 seconds. */
export function isUrgent(closesAtIso: string, serverNow: number): boolean {
  const left = Date.parse(closesAtIso) - serverNow;
  return left > 0 && left <= URGENT_MS;
}

/** My bid statuses that mean "my track won this auction". */
const WON = new Set(["next", "playing", "played"]);

function useAuctionSource(token: string, sessionId: string) {
  const t = useTranslations("guest.auction");
  const { guestId, ready } = useGuest();
  const [state, setState] = React.useState<AuctionState | null>(null);
  const [offsetMs, setOffsetMs] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const [celebrate, setCelebrate] = React.useState<string | null>(null);
  const [closed, setClosed] = React.useState<ClosedAuction | null>(null);
  // Open auctions at the last fetch: one gone with a winner just closed.
  const openIds = React.useRef<Set<string> | null>(null);

  // My bids last seen leading: if one turns into the winner, celebrate —
  // even when the realtime "auction.won" never arrived.
  const leading = React.useRef<Set<string> | null>(null);
  const refetch = React.useCallback(async () => {
    const res = await apiFetch<AuctionState>(`/api/guest/auction?token=${encodeURIComponent(token)}`);
    if (!res.ok) return;
    setOffsetMs(Date.parse(res.data.serverNow) - Date.now());
    setState(res.data);
    const bids = res.data.me?.bids ?? [];
    const won = bids.find((b) => b.status === "next" && leading.current?.has(b.slotId));
    if (won) setCelebrate(won.slotId);
    leading.current = new Set(bids.filter((b) => b.status === "leading").map((b) => b.slotId));

    const openNow = new Set(res.data.open.map((s) => s.id));
    for (const id of openIds.current ?? []) {
      if (openNow.has(id)) continue;
      const winner = [res.data.upNext, ...res.data.recentWinners].find((w) => w?.slotId === id);
      const mine = bids.filter((b) => b.slotId === id);
      // The winner gets the celebration instead.
      if (!winner || mine.some((b) => WON.has(b.status))) continue;
      setClosed({
        slotId: id,
        by: winner.by,
        totalCents: winner.totalCents,
        trackTitle: winner.trackTitle,
        trackArtist: winner.trackArtist,
        coverUrl: winner.coverUrl,
        hadBid: mine.length > 0,
      });
    }
    openIds.current = openNow;
  }, [token]);

  React.useEffect(() => {
    if (!ready) return;
    void refetch();
    const id = setInterval(() => void refetch(), POLL_MS);
    return () => clearInterval(id);
  }, [ready, refetch]);

  // One tick per second drives every countdown (server time).
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  useRealtimeChannel(publicChannel(sessionId), { private: false }, () => void refetch());
  useRealtimeChannel(ready && guestId ? guestChannel(guestId) : null, { private: true }, (envelope) => {
    if (envelope.event === "auction.outbid") {
      navigator.vibrate?.([80, 60, 80]);
      toast({ title: t("outbidToast"), variant: "error", durationMs: 4000 });
    }
    if (envelope.event === "auction.won") {
      // The celebration buzzes itself, on the frame its flash starts.
      const slotId = (envelope.payload as { slotId?: string } | null)?.slotId ?? "won";
      setCelebrate(slotId);
    }
    void refetch();
  });

  // The auction picked on the Leilão tab (null = the first open one).
  const [chosenSlotId, chooseSlot] = React.useState<string | null>(null);

  return {
    state,
    refetch,
    serverNow: now + offsetMs,
    celebrate,
    dismissCelebration: () => setCelebrate(null),
    closed,
    dismissClosed: () => setClosed(null),
    chosenSlotId,
    chooseSlot,
  };
}

export type AuctionContextValue = ReturnType<typeof useAuctionSource>;

const AuctionContext = React.createContext<AuctionContextValue | null>(null);

/** A fixed auction state (dev previews): no polling, no realtime. */
export function AuctionStaticProvider({ value, children }: { value: AuctionContextValue; children: React.ReactNode }) {
  return React.createElement(AuctionContext.Provider, { value }, children);
}

export function AuctionProvider({
  token,
  sessionId,
  children,
}: {
  token: string;
  sessionId: string;
  children: React.ReactNode;
}) {
  const value = useAuctionSource(token, sessionId);
  return React.createElement(AuctionContext.Provider, { value }, children);
}

export function useAuction() {
  const value = React.useContext(AuctionContext);
  if (!value) throw new Error("useAuction outside AuctionProvider");
  return value;
}

/** mm:ss (or h:mm:ss) until `atIso`, never negative. */
export function countdown(atIso: string, serverNow: number): string {
  const total = Math.max(0, Math.ceil((Date.parse(atIso) - serverNow) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "HH:MM" in Lisbon for a server instant. */
export function clockTime(atIso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" }).format(
    new Date(atIso),
  );
}
