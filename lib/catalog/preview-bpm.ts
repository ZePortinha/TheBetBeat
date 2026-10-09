import "server-only";

/**
 * Measures a track's BPM from its 30-second MP3 preview (server side, so a
 * guest can never fake a tempo to pay a lower starting price): download
 * (≤ 3 MB, 8 s timeout) → decode (mpg123 WASM) → mono → lib/catalog/tempo.
 */
import { MPEGDecoder } from "mpg123-decoder";
import { estimateBpm } from "./tempo";

const MAX_BYTES = 3 * 1024 * 1024;

/** Previews only ever come from Deezer's CDN; the server fetches nothing else (no SSRF). */
const PREVIEW_HOST = /(^|\.)dzcdn\.net$/;

export function isPreviewUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.port === "" && PREVIEW_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/** Reads at most MAX_BYTES; a bigger (or endless) body is dropped, not buffered. */
async function readCapped(res: Response): Promise<Uint8Array | null> {
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES || !res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.byteLength;
  }
  return buf;
}

export async function measurePreviewBpm(url: string): Promise<number | null> {
  if (!isPreviewUrl(url)) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  // A redirect must land on the CDN too.
  if (!res.ok || !isPreviewUrl(res.url || url)) return null;
  const buf = await readCapped(res);
  if (!buf || buf.byteLength === 0) return null;

  const decoder = new MPEGDecoder();
  await decoder.ready;
  try {
    const { channelData, sampleRate } = decoder.decode(buf);
    const length = channelData[0]?.length ?? 0;
    if (length === 0) return null;
    const mono = new Float32Array(length);
    for (const channel of channelData) {
      for (let i = 0; i < length; i += 1) mono[i] = mono[i]! + channel[i]! / channelData.length;
    }
    return estimateBpm(mono, sampleRate)?.bpm ?? null;
  } finally {
    decoder.free();
  }
}
