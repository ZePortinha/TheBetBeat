/**
 * Tempo (BPM) estimation from audio — PURE (2026-10-06).
 *
 * Used on the 30-second catalog previews when the catalog has no BPM.
 * Classic MIR pipeline: spectral flux onset envelope (FFT 1024, hop 256)
 * → mean-removed, half-wave rectified → autocorrelation over 60–200 BPM
 * lags, with harmonics (2×, 3× lag) and a log-normal tempo prior (centre
 * 120 BPM, 0.6 octave) → parabolic refinement. Half/double-tempo mistakes can
 * happen on any detector; the transition engine treats half/double time
 * as mixable, so they never mislead a price.
 */

const FFT_SIZE = 1024;
const HOP = 256;
const MIN_BPM = 60;
const MAX_BPM = 200;

/** In-place radix-2 FFT (re, im of length n, power of two). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Spectral flux per frame (log-compressed magnitudes, positive changes only). */
export function onsetEnvelope(samples: Float32Array): Float64Array {
  const frames = Math.max(0, Math.floor((samples.length - FFT_SIZE) / HOP) + 1);
  const env = new Float64Array(frames);
  const window = new Float64Array(FFT_SIZE).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  const half = FFT_SIZE / 2;
  let prev = new Float64Array(half);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  for (let f = 0; f < frames; f += 1) {
    const start = f * HOP;
    for (let i = 0; i < FFT_SIZE; i += 1) {
      re[i] = samples[start + i]! * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float64Array(half);
    let flux = 0;
    for (let k = 1; k < half; k += 1) {
      mag[k] = Math.log1p(100 * Math.hypot(re[k]!, im[k]!));
      const d = mag[k]! - prev[k]!;
      if (d > 0) flux += d;
    }
    env[f] = f === 0 ? 0 : flux;
    prev = mag;
  }
  return env;
}

export interface TempoEstimate {
  bpm: number;
  /** Peak over the mean of the scored range (≥ ~1.5 is a clear pulse). */
  confidence: number;
}

/** BPM of mono audio, or null when there is no clear pulse. */
export function estimateBpm(samples: Float32Array, sampleRate: number): TempoEstimate | null {
  const fps = sampleRate / HOP;
  const raw = onsetEnvelope(samples);
  if (raw.length < fps * 6) return null; // under ~6 s of audio

  // Remove the local trend (~0.5 s) and keep the bumps.
  const w = Math.max(1, Math.round(fps * 0.25));
  const env = new Float64Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(raw.length - 1, i + w); j += 1) {
      sum += raw[j]!;
      n += 1;
    }
    env[i] = Math.max(0, raw[i]! - sum / n);
  }

  const minLag = Math.floor((60 * fps) / MAX_BPM);
  const maxLag = Math.ceil((60 * fps) / MIN_BPM);
  const ac = new Float64Array(maxLag * 3 + 2);
  for (let lag = 1; lag < ac.length && lag < env.length; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < env.length; i += 1) sum += env[i]! * env[i + lag]!;
    ac[lag] = sum / (env.length - lag);
  }

  const score = new Float64Array(maxLag + 1);
  let best = -1;
  let bestScore = 0;
  let total = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.6) ** 2);
    const s = (ac[lag]! + 0.5 * ac[2 * lag]! + 0.33 * ac[3 * lag]!) * prior;
    score[lag] = s;
    total += s;
    if (s > bestScore) {
      bestScore = s;
      best = lag;
    }
  }
  if (best < 0 || bestScore <= 0) return null;
  const mean = total / (maxLag - minLag + 1);

  // Sub-frame peak position (parabola through the neighbours).
  const a = score[best - 1] ?? bestScore;
  const b = bestScore;
  const c = score[best + 1] ?? bestScore;
  const denom = a - 2 * b + c;
  const offset = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  const lag = best + Math.max(-0.5, Math.min(0.5, offset));
  const bpm = Math.round(((60 * fps) / lag) * 10) / 10;
  const confidence = mean > 0 ? bestScore / mean : 0;
  return confidence >= 1.2 ? { bpm, confidence } : null;
}
