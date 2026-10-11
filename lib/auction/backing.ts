/**
 * Backing someone else's bid (PURE, owner's brief of 2026-10-11).
 *
 *   - A bid belongs to the guest with the most money in it. When a backer
 *     puts in more than the guest who made the bid, the song is theirs if
 *     it wins: their name, their celebration, their shoutout. The bidder
 *     keeps it on a tie; between two backers on a tie, whoever got there
 *     first.
 *   - A backer may send the bidder a short message (10 characters).
 */

import { hasBlockedWord } from "@/lib/guests/blocked-words";

export interface BidPart {
  guestId: string;
  amountCents: number;
  /** When the money went in (epoch ms); breaks ties between backers. */
  atMs: number;
}

/** The guest a bid belongs to, given the money each guest has in it now. */
export function bidLeader(ownerId: string, parts: readonly BidPart[]): string {
  const sum = new Map<string, number>();
  const lastAt = new Map<string, number>();
  for (const p of parts) {
    sum.set(p.guestId, (sum.get(p.guestId) ?? 0) + p.amountCents);
    lastAt.set(p.guestId, Math.max(lastAt.get(p.guestId) ?? -Infinity, p.atMs));
  }
  const top = Math.max(0, ...sum.values());
  if (top === 0 || (sum.get(ownerId) ?? 0) >= top) return ownerId;
  let leader: string | null = null;
  for (const [guestId, cents] of sum) {
    if (cents !== top) continue;
    if (leader === null || (lastAt.get(guestId) ?? 0) < (lastAt.get(leader) ?? 0)) leader = guestId;
  }
  return leader ?? ownerId;
}

export const MESSAGE_MAX_CHARS = 10;

export type MessageCheck =
  | { ok: true; message: string | null }
  | { ok: false; reason: "too_long" | "invalid" | "blocked" };

/**
 * Cleans a backing message: trims, collapses spaces, at most 10
 * characters (emoji count as one), no control characters, no links, no
 * blocked words. Empty → no message.
 */
export function checkBackingMessage(raw: string | null | undefined): MessageCheck {
  const message = (raw ?? "").replace(/\s+/g, " ").trim();
  if (message === "") return { ok: true, message: null };
  if ([...new Intl.Segmenter("pt", { granularity: "grapheme" }).segment(message)].length > MESSAGE_MAX_CHARS) {
    return { ok: false, reason: "too_long" };
  }
  // The column counts code points: a long emoji sequence could still overflow it.
  if ([...message].length > MESSAGE_MAX_CHARS * 2) return { ok: false, reason: "too_long" };
  if (/[\p{Cc}\p{Cf}<>]/u.test(message.replace(/‍/g, ""))) return { ok: false, reason: "invalid" };
  if (/https?:|www\.|\.(com|pt|net|org|io|me|ly)\b/i.test(message)) return { ok: false, reason: "invalid" };

  // The same banned-word list as the @ (lib/guests/blocked-words.ts); also
  // tried with punctuation turned into spaces, so "corno!" is one word.
  if (hasBlockedWord(message) || hasBlockedWord(message.replace(/[^\p{L}\p{N}@$\s]/gu, " "))) {
    return { ok: false, reason: "blocked" };
  }
  return { ok: true, message };
}
