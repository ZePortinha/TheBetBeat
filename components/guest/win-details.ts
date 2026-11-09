import type { MyAuctionState, PublicWinner } from "@/lib/auction/service";

export interface WinDetails {
  slotId: string;
  trackTitle: string;
  trackArtist: string;
  totalCents: number;
  coverUrl: string | null;
}

/** My bid statuses that mean "this bid is the one that won the auction". */
const WINNING = new Set(["next", "playing", "played", "refunded"]);

/**
 * What the winner screen shows for one auction. A guest can hold several
 * bids in the same auction (their own song plus songs they backed), so the
 * first bid in that auction is not necessarily the winning one: the screen
 * once showed a backed song's title over the winner's cover, with that
 * song's total. Everything comes from the winning bid alone: the public
 * winner entry first (same for every phone), then my own winning bid while
 * the board has not caught up yet. Null when neither says I won it.
 */
export function winDetails(
  slotId: string,
  me: MyAuctionState | null | undefined,
  winners: ReadonlyArray<PublicWinner | null | undefined>,
): WinDetails | null {
  const mine = me?.bids.find((b) => b.slotId === slotId && WINNING.has(b.status) && b.winner);
  if (!mine) return null;
  const board = winners.find((w) => w?.slotId === slotId);
  if (board) {
    return {
      slotId,
      trackTitle: board.trackTitle,
      trackArtist: board.trackArtist,
      totalCents: board.totalCents,
      coverUrl: board.coverUrl,
    };
  }
  return { slotId, trackTitle: mine.trackTitle, trackArtist: mine.trackArtist, totalCents: mine.totalCents, coverUrl: null };
}
