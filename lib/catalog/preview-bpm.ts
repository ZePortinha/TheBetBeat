import "server-only";

/**
 * Measures a track's BPM from its 30-second MP3 preview (server side, so a
 * guest can never fake a tempo to pay a lower starting price): download
 * (≤ 3 MB, 8 s timeout) → decode (mpg123 WASM) → mono → lib/catalog/tempo.
 */
import { MPEGDecoder } from "mpg123-decoder";
import { estimateBpm } from "./tempo";

const MAX_BYTES = 3 * 1024 * 1024;

export async function measurePreviewBpm(url: string): Promise<number | null> {
  if (!/^https:\/\//.test(url)) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;

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
