"use client";

/**
 * Live slot auctions for the guest app: polls /api/guest/auction (3 s),
 * refetches on every public or own-channel event, counts down on the
 * SERVER clock (offset from `serverNow`), and turns "auction.outbid" into
 * a toast + vibration and "auction.won" into the celebration. The outbid
 * toast leaves as soon as the guest is back in front (or wins), so it never
 * sits over the winner screen.
 *
 * One AuctionProvider per party layout: every tab reads the same state
 * (one poll, no reload when switching tabs), and the auction the guest
 * picked on the Leilão tab travels with them through search to the bid.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import type { MyAuctionState, PublicAuctionState } from "@/lib/auction/service";
import type { PaymentMethod } from "@/lib/domain/types";
import { boardChannel, guestChannel, publicChannel } from "@/lib/realtime/events";
import { useRealtimeChannel } from "@/lib/realtime/client";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "./api";
import { useGuest } from "./guest-providers";

export type AuctionState = PublicAuctionState & { me: MyAuctionState | null; paymentMethods: PaymentMethod[] };

/**
 * Polling is the floor, realtime hints are the fast path (B6). With the
 * public channel up, a slow poll is enough; without it, poll every 3 s.
 * Load test 2026-11-05: 1 000 phones at a flat 3 s plus a refetch per hint
 * saturated one server process.
 */
const POLL_MS = 3000;
const POLL_LIVE_MS = 8000;
/** Public hints: at most one refetch per 1.5 s, spread over half a second
 * so a whole room does not hit the server in the same instant. */
const HINT_MIN_MS = 1500;
const HINT_SPREAD_MS = 500;
/** How long after 0:00 the app keeps asking quickly for the result. */
const CLOSE_BURST_MS = 10_000;
/** The final stretch of an auction: the screen flashes red ↔ white. */
export const FINAL_STRETCH_MS = 30_000;

/** True while an auction is in its last 30 seconds. */
export function inFinalStretch(closesAtIso: string, serverNow: number): boolean {
  const left = Date.parse(closesAtIso) - serverNow;
  return left > 0 && left <= FINAL_STRETCH_MS;
}

/** Final 2 minutes: urgent warning and button highlight. */
export const FINAL_TWO_MINUTES_MS = 120_000;

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
  const { toast, dismiss } = useToast();
  // The "outbid" toast on screen and the auction it is about.
  const outbidToast = React.useRef<{ id: number; slotId: string | null; at: number } | null>(null);
  const clearOutbid = React.useCallback(() => {
    if (outbidToast.current) dismiss(outbidToast.current.id);
    outbidToast.current = null;
  }, [dismiss]);

  // My bids last seen leading: if one turns into the winner, celebrate —
  // even when the realtime "auction.won" never arrived.
  const leading = React.useRef<Set<string> | null>(null);
  const refetch = React.useCallback(async () => {
    const askedAt = Date.now();
    const res = await apiFetch<AuctionState>(`/api/guest/auction?token=${encodeURIComponent(token)}`);
    if (!res.ok) return;
    setOffsetMs(Date.parse(res.data.serverNow) - Date.now());
    boardAt.current = Math.max(boardAt.current, Date.parse(res.data.serverNow) || 0);
    setState(res.data);
    const bids = res.data.me?.bids ?? [];
    // Only the guest who spent the most on the song wins it (owner, 2026-10-11).
    const won = bids.find((b) => b.status === "next" && b.winner && leading.current?.has(b.slotId));
    if (won) setCelebrate(won.slotId);
    leading.current = new Set(bids.filter((b) => b.status === "leading").map((b) => b.slotId));
    // Only an answer asked after the toast can say the guest is back in front.
    const shown = outbidToast.current;
    if (won || (shown?.slotId && shown.at < askedAt && leading.current.has(shown.slotId))) clearOutbid();
  }, [token, clearOutbid]);

  // The public half (amounts, closing times, winners, ranking) is the same
  // for every phone. Board versions are ordered by the server time they
  // were built at, so an older one never overwrites a newer read.
  const boardAt = React.useRef(0);
  const applyBoard = React.useCallback((board: PublicAuctionState) => {
    const at = Date.parse(board.serverNow);
    if (!Number.isFinite(at) || at < boardAt.current) return;
    boardAt.current = at;
    // The clock offset stays from the full read (a CDN may serve the board
    // up to a second old); my bids and wallet come with my own events.
    setState((prev) => (prev ? { ...prev, ...board, serverNow: prev.serverNow } : prev));
  }, []);
  const refetchBoard = React.useCallback(async () => {
    const res = await apiFetch<PublicAuctionState>(`/api/guest/auction/board?token=${encodeURIComponent(token)}`);
    if (res.ok) applyBoard(res.data);
  }, [token, applyBoard]);

  // Fast path: the server sends the fresh board itself after every change
  // (server-only channel), so a bid costs no request from the phones.
  const boardLink = useRealtimeChannel(ready && guestId ? boardChannel(sessionId) : null, { private: true }, (envelope) => {
    if (envelope.event === "auction.board" && envelope.payload && typeof envelope.payload === "object") {
      applyBoard(envelope.payload as PublicAuctionState);
    }
  });
  const boardLive = boardLink === "connected";

  // Fallback: the public hint, only while the board channel is down.
  const publicLink = useRealtimeChannel(publicChannel(sessionId), { private: false, minIntervalMs: HINT_MIN_MS }, () => {
    if (boardLive) return;
    setTimeout(() => void (state ? refetchBoard() : refetch()), Math.random() * HINT_SPREAD_MS);
  });
  const pollMs = boardLive || publicLink === "connected" ? POLL_LIVE_MS : POLL_MS;

  React.useEffect(() => {
    if (!ready) return;
    void refetch();
    const id = setInterval(() => void refetch(), pollMs);
    return () => clearInterval(id);
  }, [ready, refetch, pollMs]);

  // One tick per second drives every countdown (server time).
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  // An auction I am in just hit 0:00: ask the server right away (and every
  // 400 ms until it says who won) instead of waiting for the next 3 s poll,
  // so the winner screen opens within a second of the close. A soft-close
  // extension simply moves closesAt and stops the burst.
  const lastBurst = React.useRef(0);
  const serverNowMs = now + offsetMs;
  const closing = state?.open.some(
    (s) =>
      Date.parse(s.closesAt) <= serverNowMs &&
      serverNowMs - Date.parse(s.closesAt) < CLOSE_BURST_MS &&
      (state.me?.bids.some((b) => b.slotId === s.id) ?? false),
  );
  React.useEffect(() => {
    if (!closing || now - lastBurst.current < 400) return;
    lastBurst.current = now;
    void refetch();
  }, [closing, now, refetch]);

  useRealtimeChannel(ready && guestId ? guestChannel(guestId) : null, { private: true }, (envelope) => {
    if (envelope.event === "auction.outbid") {
      navigator.vibrate?.([80, 60, 80]);
      clearOutbid();
      const slotId = (envelope.payload as { slotId?: string } | null)?.slotId ?? null;
      outbidToast.current = { id: toast({ title: t("outbidToast"), variant: "error", durationMs: 4000 }), slotId, at: Date.now() };
    }
    if (envelope.event === "auction.backed") {
      const p = (envelope.payload ?? {}) as { by?: string | null; message?: string | null; takesOver?: boolean };
      const name = p.by ?? t("anonymous");
      navigator.vibrate?.(30);
      toast({
        title: p.message ? t("backedToastMessage", { name, message: p.message }) : t("backedToast", { name }),
        ...(p.takesOver ? { description: t("backedToastTakeover", { name }) } : {}),
        durationMs: 5000,
      });
    }
    if (envelope.event === "auction.won") {
      navigator.vibrate?.([40, 40, 40, 40, 200]);
      const slotId = (envelope.payload as { slotId?: string } | null)?.slotId ?? "won";
      clearOutbid();
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

/** The auction the guest picked, else the first one still running, else the first open. */
export function pickSlot(state: PublicAuctionState, chosenSlotId: string | null, serverNow: number) {
  return (
    state.open.find((s) => s.id === chosenSlotId) ??
    state.open.find((s) => Date.parse(s.closesAt) > serverNow) ??
    state.open[0] ??
    null
  );
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
