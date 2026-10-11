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

/**
 * Words a backing message may not carry (pt-PT and EN): insults, slurs,
 * sexual and violent terms. Compared without accents, separators or digit
 * swaps, so "p.u.t.a" or "f4ck" are caught too.
 */
const BLOCKED = [
  // pt
  "puta", "putas", "puto", "putos", "caralho", "foda", "fodase", "foder", "fodido", "merda", "cona", "piça",
  "pila", "cabrao", "cabra", "corno", "cornos", "paneleiro", "panasca", "bicha", "maricas", "rabeta", "preto",
  "macaco", "cigano", "monhe", "atrasado", "mongoloide", "otario", "idiota", "estupido", "cu", "punheta",
  "broche", "mamada", "vadia", "badalhoca", "porra", "nazi", "hitler", "violar", "violo", "morre",
  // en
  "fuck", "fck", "fuk", "shit", "bitch", "cunt", "dick", "cock", "pussy", "whore", "slut", "bastard",
  "asshole", "ass", "fag", "faggot", "nigger", "nigga", "retard", "rape", "kill", "die", "kys", "porn",
  "sex", "cum",
];

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/@/g, "a")
    .replace(/\$/g, "s");
}

/** Repeated letters collapsed ("fuuuck" → "fuck"). */
const squeeze = (word: string) => word.replace(/(.)\1+/g, "$1");

const BLOCKED_FOLDED = new Set(BLOCKED.flatMap((w) => [fold(w).replace(/[^a-z]/g, ""), squeeze(fold(w).replace(/[^a-z]/g, ""))]));
const BLOCKED_LONG = [...BLOCKED_FOLDED].filter((w) => w.length >= 5);

/** Words in the message, plus letters spelled out one by one ("p.u.t.a" → "puta"). */
function wordsOf(folded: string): string[] {
  const tokens = folded.split(/[^a-z]+/).filter(Boolean);
  const words = [...tokens];
  let run = "";
  for (const t of [...tokens, ""]) {
    if (t.length === 1) run += t;
    else {
      if (run.length > 1) words.push(run);
      run = "";
    }
  }
  return words.flatMap((w) => [w, squeeze(w)]);
}

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

  for (const word of wordsOf(fold(message))) {
    // Whole words; longer ones also as the start of a word ("caralhos"), so "cu" never blocks "curti".
    if (BLOCKED_FOLDED.has(word) || BLOCKED_LONG.some((b) => word.startsWith(b))) return { ok: false, reason: "blocked" };
  }
  return { ok: true, message };
}
