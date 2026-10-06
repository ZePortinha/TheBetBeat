/**
 * "/s/<token>" from a scanned QR (a URL on any host, or the bare path), or
 * null when it is not a BetBeat guest link. Only the path is kept, so the
 * scanner always stays on this site: a QR pointing elsewhere is never opened.
 */
export function guestPathFrom(text: string): string | null {
  const raw = text.trim();
  let path = raw;
  try {
    path = new URL(raw).pathname;
  } catch {
    // Not a URL: maybe the bare path.
  }
  return /^\/s\/[A-Za-z0-9._~%-]{10,2048}$/.test(path) ? path : null;
}
