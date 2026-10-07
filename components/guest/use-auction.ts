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

const POLL_MS = 3000;
/** The final stretch of an auction: the screen flashes red ↔ white. */
export const FINAL_STRETCH_MS = 30_000;
/** Final 2 minutes: urgent warning and button highlight. */
export const FINAL_TWO_MINUTES_MS = 120_000;

/** True while an auction is in its last 30 seconds. */
export function inFinalStretch(closesAtIso: string, serverNow: number): boolean {
  const left = Date.parse(closesAtIso) - serverNow;
  return left > 0 && left <= FINAL_STRETCH_MS;
}

/** True while an auction is in its last 2 minutes. */
export function inFinalTwoMinutes(closesAtIso: string, serverNow: number): boolean {
  const left = Date.parse(closesAtIso) - serverNow;
  return left > 0 && left <= FINAL_TWO_MINUTES_MS;
}

function useAuctionSource(token: string, sessionId: string) {
  const t = useTranslations("guest.auction");
  const { guestId, ready } = useGuest();
  const [state, setState] = React.useState<AuctionState | null>(null);
  const [offsetMs, setOffsetMs] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const [celebrate, setCelebrate] = React.useState<string | null>(null);

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
      navigator.vibrate?.([40, 40, 40, 40, 200]);
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
    chosenSlotId,
    chooseSlot,
  };
}

const AuctionContext = React.createContext<ReturnType<typeof useAuctionSource> | null>(null);

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
