/**
 * Request body caps for /api (B12.4). Route handlers read the whole body
 * into memory, so the middleware refuses an oversized declared
 * Content-Length before any route runs. Every JSON route takes a few
 * hundred bytes; only the library import uploads a file (10 MB cap of its
 * own, checked again on the parsed form).
 */

export const API_BODY_MAX = 256 * 1024;
export const UPLOAD_BODY_MAX = 11 * 1024 * 1024;

const UPLOAD_PATHS = new Set(["/api/cockpit/library/import"]);

export function isApiBodyTooLarge(pathname: string, headers: Headers): boolean {
  if (!pathname.startsWith("/api/")) return false;
  const raw = headers.get("content-length");
  if (raw === null) return false;
  const length = Number(raw);
  if (!Number.isFinite(length) || length < 0) return true;
  return length > (UPLOAD_PATHS.has(pathname) ? UPLOAD_BODY_MAX : API_BODY_MAX);
}
