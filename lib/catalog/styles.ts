/**
 * Event music styles (2026-10-11). The admin picks the night's styles when
 * creating an event (stored lowercase in sessions.genres); guests then see
 * songs of those styles first in the recommendations. Pure: shared by the
 * console form, the guest search route and tests.
 */

/** Styles offered on the event form, besides the club's own genres. */
export const EVENT_STYLES = [
  "funk",
  "pop",
  "hip-hop",
  "trap",
  "reggaeton",
  "latina",
  "kizomba",
  "afro house",
  "amapiano",
  "house",
  "deep house",
  "techno",
  "eletrónica",
  "dance",
  "r&b",
  "rock",
  "indie",
  "disco",
  "anos 80",
  "anos 90",
  "anos 2000",
  "portuguesa",
] as const;

/** Lowercase, accents kept, single spaces: how styles are stored. */
export function normalizeStyle(style: string): string {
  return style.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Accent-free and punctuation-free form, for matching only. */
function fold(value: string): string {
  return normalizeStyle(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9&]+/g, " ")
    .trim();
}

/**
 * Does a track's genre belong to one of the event's styles? Case and
 * accent blind, and a style inside a longer genre counts ("funk" matches
 * "Funk Carioca", "house" matches "Afro House").
 */
export function matchesStyle(genre: string | null | undefined, styles: readonly string[]): boolean {
  if (!genre || styles.length === 0) return false;
  const g = ` ${fold(genre)} `;
  return styles.some((s) => {
    const f = fold(s);
    return f.length > 0 && g.includes(` ${f} `);
  });
}

/** Is a BPM inside the event's range? A missing bound (or BPM) never excludes. */
export function inBpmRange(bpm: number | null, min: number | null, max: number | null): boolean {
  if (bpm === null) return true;
  if (min !== null && bpm < min) return false;
  if (max !== null && bpm > max) return false;
  return true;
}

/**
 * Stable reorder: tracks of the event's styles (inside the BPM range) first,
 * then the rest in their original order.
 */
export function eventStyleFirst<T extends { genre: string | null; bpm: number | null }>(
  tracks: readonly T[],
  styles: readonly string[],
  bpmMin: number | null = null,
  bpmMax: number | null = null,
): T[] {
  if (styles.length === 0 && bpmMin === null && bpmMax === null) return [...tracks];
  const fits = (t: T) =>
    (styles.length === 0 || matchesStyle(t.genre, styles)) && inBpmRange(t.bpm, bpmMin, bpmMax);
  return [...tracks.filter(fits), ...tracks.filter((t) => !fits(t))];
}
