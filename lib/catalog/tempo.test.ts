import { describe, expect, it } from "vitest";
import { estimateBpm } from "./tempo";

/** Kick-like clicks (decaying 60 Hz bursts + noise) at a given tempo. */
function clicks(bpm: number, seconds = 30, sampleRate = 44_100): Float32Array {
  const out = new Float32Array(seconds * sampleRate);
  const period = (60 / bpm) * sampleRate;
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
  for (let beat = 0; beat * period < out.length; beat += 1) {
    const start = Math.round(beat * period);
    for (let i = 0; i < 2000 && start + i < out.length; i += 1) {
      out[start + i] = Math.sin((2 * Math.PI * 60 * i) / sampleRate) * Math.exp(-i / 400);
    }
  }
  for (let i = 0; i < out.length; i += 1) out[i]! += noise();
  return out;
}

describe("estimateBpm", () => {
  it.each([128, 124, 100, 95])("finds %i BPM in a steady beat", (bpm) => {
    const est = estimateBpm(clicks(bpm), 44_100);
    expect(est).not.toBeNull();
    expect(Math.abs(est!.bpm - bpm)).toBeLessThanOrEqual(1.5);
  });

  it("says nothing for silence or too little audio", () => {
    expect(estimateBpm(new Float32Array(44_100 * 20), 44_100)).toBeNull();
    expect(estimateBpm(clicks(128, 3), 44_100)).toBeNull();
  });
});
