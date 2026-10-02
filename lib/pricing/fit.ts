/**
 * Musical fit S ∈ [0, 1] (BRIEF B5.3). Pure functions — no I/O, no Date.now().
 *
 * S = 0.5·s_g + 0.35·s_b + 0.15·s_k
 *  - s_g genre: 1 in-session, 0.6 adjacent (venue map merged over built-in
 *    defaults, symmetric), 0.2 otherwise.
 *  - s_b BPM: max(0, 1 − Δ/16) where Δ is the smallest difference between
 *    track BPM ×0.5/×1/×2 and the median of the set's recent BPMs.
 *  - s_k key: Camelot-compatible 1, incompatible 0.5, unknown 0.75.
 */
import type { FitLabel } from "@/lib/domain/types";
import { isCamelotCompatible, parseCamelot } from "@/lib/catalog/camelot";
import type { PricingSetInput, PricingTrackInput } from "./types";

export const FIT_WEIGHTS = { genre: 0.5, bpm: 0.35, key: 0.15 } as const;

export const GENRE_IN_SESSION_SCORE = 1;
export const GENRE_ADJACENT_SCORE = 0.6;
export const GENRE_OTHER_SCORE = 0.2;
/** Blank/unknown track genre — treated like "uncertain", not hostile. */
export const GENRE_UNKNOWN_SCORE = 0.6;
export const BPM_UNKNOWN_SCORE = 0.75;
export const KEY_UNKNOWN_SCORE = 0.75;
export const KEY_INCOMPATIBLE_SCORE = 0.5;
/** BPM tolerance window in the s_b formula (Δ at which s_b hits 0 is 16). */
export const BPM_TOLERANCE = 16;

export const FIT_LABEL_FITS_MIN = 0.7;
export const FIT_LABEL_POSSIBLE_MIN = 0.4;

const GENRE_ALIASES: Record<string, string> = {
  "r and b": "rnb",
  randb: "rnb",
  "r n b": "rnb",
  "rhythm and blues": "rnb",
  "drum n bass": "drum and bass",
  dnb: "drum and bass",
  "d n b": "drum and bass",
  hiphop: "hip hop",
  afrobeat: "afrobeats",
  "uk garage": "garage",
  ukg: "garage",
  "edm electro": "edm",
};

/** Canonical form used for all genre comparisons and map keys. */
export function normalizeGenre(raw: string): string {
  const base = raw
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return GENRE_ALIASES[base] ?? base;
}

/**
 * Built-in adjacency defaults for club genres (B5.3 "sensible defaults").
 * Treated as symmetric; a venue's `adjacentGenres` map EXTENDS this map.
 */
export const DEFAULT_ADJACENT_GENRES: Record<string, string[]> = {
  house: ["tech house", "deep house", "afro house", "progressive house", "disco", "funk", "garage", "dance pop", "edm"],
  "tech house": ["house", "techno", "deep house", "minimal"],
  techno: ["tech house", "melodic techno", "minimal", "hard techno", "trance"],
  "deep house": ["house", "tech house", "afro house", "organic house"],
  "afro house": ["house", "deep house", "amapiano", "organic house"],
  "organic house": ["deep house", "afro house"],
  "melodic techno": ["techno", "progressive house", "trance"],
  "progressive house": ["house", "melodic techno", "trance"],
  trance: ["techno", "progressive house", "melodic techno"],
  minimal: ["techno", "tech house"],
  "hard techno": ["techno", "hardstyle"],
  hardstyle: ["hard techno"],
  "hip hop": ["rnb", "trap", "reggaeton", "afrobeats"],
  rnb: ["hip hop", "afrobeats", "pop"],
  trap: ["hip hop", "drill", "dubstep"],
  drill: ["trap", "hip hop"],
  reggaeton: ["latin", "hip hop", "dancehall", "afrobeats", "moombahton"],
  latin: ["reggaeton", "salsa", "dancehall"],
  salsa: ["latin"],
  dancehall: ["reggaeton", "afrobeats", "latin"],
  afrobeats: ["amapiano", "dancehall", "hip hop", "rnb"],
  amapiano: ["afrobeats", "afro house"],
  "drum and bass": ["jungle", "dubstep", "garage"],
  jungle: ["drum and bass"],
  dubstep: ["drum and bass", "trap", "bass"],
  garage: ["drum and bass", "house", "bass"],
  bass: ["dubstep", "garage"],
  pop: ["dance pop", "rnb", "disco"],
  "dance pop": ["pop", "house", "edm"],
  edm: ["big room", "electro house", "dance pop", "house"],
  "electro house": ["edm", "house", "big room"],
  "big room": ["edm", "electro house"],
  disco: ["house", "funk", "pop"],
  funk: ["disco", "house"],
  moombahton: ["reggaeton", "edm"],
};

type AdjacencyIndex = Map<string, Set<string>>;

function addPair(index: AdjacencyIndex, a: string, b: string): void {
  const ka = normalizeGenre(a);
  const kb = normalizeGenre(b);
  if (!ka || !kb || ka === kb) return;
  let setA = index.get(ka);
  if (!setA) {
    setA = new Set();
    index.set(ka, setA);
  }
  setA.add(kb);
  let setB = index.get(kb);
  if (!setB) {
    setB = new Set();
    index.set(kb, setB);
  }
  setB.add(ka);
}

function buildAdjacencyIndex(maps: Array<Record<string, string[]>>): AdjacencyIndex {
  const index: AdjacencyIndex = new Map();
  for (const map of maps) {
    for (const [genre, adjacents] of Object.entries(map)) {
      for (const adjacent of adjacents) addPair(index, genre, adjacent);
    }
  }
  return index;
}

const DEFAULT_ADJACENCY_INDEX = buildAdjacencyIndex([DEFAULT_ADJACENT_GENRES]);

function adjacencyIndexFor(venueAdjacentGenres?: Record<string, string[]>): AdjacencyIndex {
  if (!venueAdjacentGenres || Object.keys(venueAdjacentGenres).length === 0) {
    return DEFAULT_ADJACENCY_INDEX;
  }
  return buildAdjacencyIndex([DEFAULT_ADJACENT_GENRES, venueAdjacentGenres]);
}

/** s_g per B5.3. Empty session genre list = no style restriction → 1. */
export function genreScore(
  trackGenre: string,
  sessionGenres: string[],
  venueAdjacentGenres?: Record<string, string[]>,
): number {
  const session = sessionGenres.map(normalizeGenre).filter((g) => g.length > 0);
  if (session.length === 0) return GENRE_IN_SESSION_SCORE;
  const track = normalizeGenre(trackGenre);
  if (!track) return GENRE_UNKNOWN_SCORE;
  if (session.includes(track)) return GENRE_IN_SESSION_SCORE;
  const adjacents = adjacencyIndexFor(venueAdjacentGenres).get(track);
  if (adjacents && session.some((g) => adjacents.has(g))) return GENRE_ADJACENT_SCORE;
  return GENRE_OTHER_SCORE;
}

/** Median of a non-empty list; NaN for an empty one (callers guard). */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** s_b per B5.3. Missing BPM on either side → 0.75. */
export function bpmScore(trackBpm: number | null, recentBpms: number[]): number {
  const usable = recentBpms.filter((b) => Number.isFinite(b) && b > 0);
  if (
    trackBpm === null ||
    !Number.isFinite(trackBpm) ||
    trackBpm <= 0 ||
    usable.length === 0
  ) {
    return BPM_UNKNOWN_SCORE;
  }
  const setMedian = median(usable);
  const delta = Math.min(
    Math.abs(trackBpm * 0.5 - setMedian),
    Math.abs(trackBpm - setMedian),
    Math.abs(trackBpm * 2 - setMedian),
  );
  return Math.max(0, 1 - delta / BPM_TOLERANCE);
}

/** s_k per B5.3. Unknown/unparseable key on either side → 0.75. */
export function keyScore(trackKey: string | null, currentKey: string | null): number {
  const track = parseCamelot(trackKey);
  const current = parseCamelot(currentKey);
  if (!track || !current) return KEY_UNKNOWN_SCORE;
  return isCamelotCompatible(track, current) ? 1 : KEY_INCOMPATIBLE_SCORE;
}

export function fitLabel(score: number): FitLabel {
  if (score >= FIT_LABEL_FITS_MIN) return "fits";
  if (score >= FIT_LABEL_POSSIBLE_MIN) return "possible";
  return "off_style";
}

export interface FitResult {
  score: number;
  label: FitLabel;
  /** Component scores, for the breakdown/simulator. */
  sGenre: number;
  sBpm: number;
  sKey: number;
}

export function computeFit(
  track: PricingTrackInput,
  set: PricingSetInput,
  sessionGenres: string[],
  venueAdjacentGenres?: Record<string, string[]>,
): FitResult {
  const sGenre = genreScore(track.genre, sessionGenres, venueAdjacentGenres);
  const sBpm = bpmScore(track.bpm, set.recentBpms);
  const sKey = keyScore(track.camelotKey, set.currentKey);
  const raw =
    FIT_WEIGHTS.genre * sGenre + FIT_WEIGHTS.bpm * sBpm + FIT_WEIGHTS.key * sKey;
  // Guard float drift (0.5 + 0.35 + 0.15 can sum to 1.0000000000000002).
  const score = Math.min(1, Math.max(0, raw));
  return { score, label: fitLabel(score), sGenre, sBpm, sKey };
}
