/**
 * The winning song's album art for the winner's screen, as a bitmap the
 * canvas can draw (2026-11-06). While the guest leads an auction the art of
 * their leading song is fetched ahead of time, so the vinyl opens with the
 * cover already pressed in instead of waiting for a download after the win.
 * Keyed by auction and cover address: a bid that changes songs never shows
 * the old one's art. Fetched through our own origin (same-origin canvas).
 */

type Entry = { promise: Promise<ImageBitmap | null>; bitmap: ImageBitmap | null | undefined };

const entries = new Map<string, Entry>();
const MAX_ENTRIES = 6;

const keyOf = (slotId: string, coverUrl: string) => `${slotId}|${coverUrl}`;

function load(key: string, url: string): Entry {
  const entry: Entry = { bitmap: undefined, promise: Promise.resolve(null) };
  entry.promise = fetch(url)
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("cover"))))
    .then((b) => createImageBitmap(b))
    .then((bmp) => {
      entry.bitmap = bmp;
      return bmp;
    })
    .catch(() => {
      entry.bitmap = null;
      return null;
    });
  entries.set(key, entry);
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value as string;
    entries.get(oldest)?.bitmap?.close();
    entries.delete(oldest);
  }
  return entry;
}

/** While leading: fetch the art of my leading bid (once per song). */
export function warmCover(slotId: string, coverUrl: string, bidId: string): void {
  const key = keyOf(slotId, coverUrl);
  if (entries.has(key)) return;
  load(key, `/api/guest/auction/${slotId}/cover?bid=${encodeURIComponent(bidId)}`);
}

/** The bitmap right now, when it is already here (undefined: not yet). */
export function readyCover(slotId: string, coverUrl: string): ImageBitmap | null | undefined {
  return entries.get(keyOf(slotId, coverUrl))?.bitmap ?? undefined;
}

/** The winning art: the warmed copy when it came, otherwise a fresh fetch. */
export async function coverFor(slotId: string, coverUrl: string): Promise<ImageBitmap | null> {
  const key = keyOf(slotId, coverUrl);
  const warm = entries.get(key);
  const bmp = warm ? await warm.promise : null;
  if (bmp) return bmp;
  return load(key, `/api/guest/auction/${slotId}/cover`).promise;
}
