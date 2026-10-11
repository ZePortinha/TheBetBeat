/**
 * Words no @ may carry (owner, 2026-10-11): insults, slurs, sexual terms
 * and hate symbols, in Portuguese (PT and BR) and English. The @ shows on
 * the venue screen and in the ranking, so it must be fit for a TV in a
 * room full of strangers.
 *
 * To add or remove a word, edit the two lists below (lowercase, no
 * accents) and run `pnpm test lib/guests`.
 *
 *   ANYWHERE: caught inside any @ ("xfuckx", "o.caralho_22"). Only words
 *             that are not part of ordinary words go here.
 *   WHOLE:    caught only as the whole @ or as one of its parts split by
 *             dot, hyphen, _ or digits ("rita.cona", "cona_22"), because
 *             they hide inside innocent words ("computador" has "puta",
 *             "pilates" has "pila", "sexta" has "sex", "torpedo" has
 *             "pedo").
 *
 * Both sides are compared the same way: accents and case dropped, digits
 * used as letters turned back (f0d4 → foda, 1 as i or l) and separators
 * out; the @ is also tried with repeated letters collapsed ("fuuuck" →
 * "fuck"), the list words never are.
 */

const ANYWHERE = [
  // Portuguese
  "caralho",
  "caralha",
  "foda",
  "foder",
  "fodase",
  "fodido",
  "fodida",
  "fodam",
  "merda",
  "porra",
  "filhodaputa",
  "putaquepariu",
  "putaqpariu",
  "puttana",
  "putedo",
  "paneleiro",
  "panasca",
  "maricas",
  "maricon",
  "bichona",
  "rabeta",
  "piroca",
  "buceta",
  "boceta",
  "xoxota",
  "punheta",
  "punheteiro",
  "badalhoca",
  "cabrao",
  "cagalhao",
  "mamada",
  "broxa",
  "vadia",
  "prostituta",
  "pedofilo",
  "pedofila",
  "violador",
  "estupro",
  "estuprador",
  "suicid",
  // English
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "whore",
  "slut",
  "pussy",
  "asshole",
  "bastard",
  "bollock",
  "wanker",
  "twat",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "tranny",
  "porn",
  "penis",
  "vagina",
  "blowjob",
  "handjob",
  "dildo",
  "pedophile",
  "paedophile",
  // Hate symbols and groups
  "nazi",
  "hitler",
  "siegheil",
  "heilhitler",
  "jihad",
  "kukluxklan",
];

const WHOLE = [
  // Portuguese
  "puta",
  "putas",
  "cona",
  "conas",
  "cu",
  "pila",
  "pilas",
  "pica",
  "picha",
  "pissa",
  "broche",
  "corno",
  "cornos",
  "cabra",
  "fufa",
  "viado",
  "bicha",
  "rabo",
  "mamas",
  "tetas",
  "sexo",
  "nudes",
  "anal",
  "pedo",
  "preto",
  "macaco",
  "monhe",
  "zuca",
  // English
  "ass",
  "dick",
  "cock",
  "fag",
  "dyke",
  "spic",
  "chink",
  "coon",
  "kike",
  "sex",
  "cum",
  "tits",
  "rape",
  "nude",
  "isis",
  "kkk",
];

/**
 * Accents and case out, digits read as letters, separators out, runs
 * collapsed. Exported so other free text (bid messages) can share the
 * same matching instead of keeping a second list.
 */
export function variants(raw: string): string[] {
  const base = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[._\s-]/g, "");
  const swap = (s: string, one: string) =>
    s
      .replace(/0/g, "o")
      .replace(/1/g, one)
      .replace(/3/g, "e")
      .replace(/4/g, "a")
      .replace(/5/g, "s")
      .replace(/7/g, "t")
      .replace(/8/g, "b")
      .replace(/9/g, "g")
      .replace(/\$/g, "s")
      .replace(/@/g, "a");
  const out = new Set<string>();
  for (const one of ["i", "l"]) {
    const letters = swap(base, one);
    out.add(letters);
    out.add(collapse(letters));
  }
  return [...out];
}

function collapse(s: string): string {
  return s.replace(/(.)\1+/g, "$1");
}

// List words stay as written: collapsing them would turn "porra" into
// "pora" (inside "incorporar") or "ass" into "as".
const WHOLE_SET = new Set(WHOLE);

/** The parts of a text as written: split at separators, spaces and digit runs. */
export function parts(raw: string): string[] {
  const clean = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^@/, "");
  return clean.split(/[._\s-]+|\d+/).filter(Boolean);
}

/**
 * True when the text carries a word from the lists above. Works for an @
 * and for any short guest text (spaces split it into parts too).
 */
export function hasBlockedWord(text: string): boolean {
  const whole = variants(text);
  if (whole.some((v) => WHOLE_SET.has(v))) return true;
  if (whole.some((v) => ANYWHERE.some((w) => v.includes(w)))) return true;
  for (const part of parts(text)) {
    if (variants(part).some((v) => WHOLE_SET.has(v))) return true;
  }
  return false;
}

/** The @ check (same lists, same matching). */
export const isOffensiveHandle = hasBlockedWord;
