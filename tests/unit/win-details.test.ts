import { describe, expect, it } from "vitest";
import type { MyAuctionState, PublicWinner } from "@/lib/auction/service";
import { winDetails } from "@/components/guest/win-details";

type Bid = MyAuctionState["bids"][number];

const bid = (over: Partial<Bid>): Bid =>
  ({
    slotId: "slot-1",
    bidId: "bid-x",
    slotKind: "auction",
    closesAt: "2026-11-05T14:20:00.000Z",
    trackTitle: "Velvet Drift",
    trackArtist: "Linha Oito",
    owner: true,
    libraryTrackId: null,
    myCents: 0,
    totalCents: 0,
    status: "lost",
    rolled: false,
    rolledOn: false,
    winner: true,
    takenOver: false,
    messages: [],
    ...over,
  }) as Bid;

const me = (bids: Bid[]) => ({ bids }) as unknown as MyAuctionState;

const board = {
  slotId: "slot-1",
  trackTitle: "Neon Corridor",
  trackArtist: "Rui Norte",
  coverUrl: "https://covers.example/neon.jpg",
  totalCents: 1400,
} as PublicWinner;

describe("winDetails", () => {
  it("shows the winning song, not another bid I hold in the same auction", () => {
    const mine = me([
      bid({ bidId: "backed", trackTitle: "Velvet Drift", totalCents: 0, status: "lost" }),
      bid({ bidId: "won", trackTitle: "Neon Corridor", trackArtist: "Rui Norte", totalCents: 1400, status: "next" }),
    ]);
    expect(winDetails("slot-1", mine, [board])).toEqual({
      slotId: "slot-1",
      trackTitle: "Neon Corridor",
      trackArtist: "Rui Norte",
      totalCents: 1400,
      coverUrl: "https://covers.example/neon.jpg",
    });
  });

  it("falls back to my winning bid while the board has not caught up", () => {
    const mine = me([bid({ trackTitle: "Neon Corridor", totalCents: 1400, status: "next" })]);
    expect(winDetails("slot-1", mine, [null])).toMatchObject({ trackTitle: "Neon Corridor", totalCents: 1400, coverUrl: null });
  });

  it("shows nothing to a guest who did not win", () => {
    const loser = me([bid({ status: "lost", winner: false })]);
    expect(winDetails("slot-1", loser, [board])).toBeNull();
    expect(winDetails("slot-1", null, [board])).toBeNull();
  });
});
