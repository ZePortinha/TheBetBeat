"use client";

/**
 * Cockpit alert sounds (BRIEF B10.7): WebAudio tones < 400 ms, one
 * distinct triad per tier, loud enough over club music. Volume persists
 * in localStorage; silent mode swaps sound for an animated gold edge
 * flash (dispatched as a window event the shell renders).
 *
 * Causality & harmony: `playTierAlert` is called inside the realtime
 * event handler, the same tick that inserts the card and shows the
 * toast — sound, motion and feed land on the same frame.
 */
import type { Tier } from "@/lib/domain/types";

const VOLUME_KEY = "bb-cockpit-volume";
const SILENT_KEY = "bb-cockpit-silent";

export const GOLD_FLASH_EVENT = "betbeat:gold-flash";

/** Triad roots per tier — rising with the promise strength (B10.7). */
const TIER_TRIADS: Record<Tier, [number, number, number]> = {
  QUEUE: [880, 1109, 1319], // A5 major
  SOON: [988, 1245, 1480], // B5 major
  NEXT: [1175, 1480, 1760], // D6 major
};

let audioContext: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state === "suspended") void audioContext.resume();
    return audioContext;
  } catch {
    return null;
  }
}

export function getVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const v = raw === null ? 0.8 : Number(raw);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
  } catch {
    return 0.8;
  }
}

export function setVolume(volume: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(Math.min(1, Math.max(0, volume))));
  } catch {
    // Per-viewer convenience only.
  }
}

export function getSilent(): boolean {
  try {
    return localStorage.getItem(SILENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSilent(silent: boolean): void {
  try {
    localStorage.setItem(SILENT_KEY, silent ? "1" : "0");
  } catch {
    // Per-viewer convenience only.
  }
}

/** Fires the gold border flash (B10.7 silent mode). */
export function triggerGoldFlash(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(GOLD_FLASH_EVENT));
}

function playTriad(frequencies: [number, number, number], volume: number): void {
  const ctx = context();
  if (!ctx || volume <= 0) return;
  const start = ctx.currentTime;
  const total = 0.32; // < 400 ms (B10.7)
  frequencies.forEach((frequency, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = frequency;
    const at = start + i * 0.07;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume * 0.5, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + total);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(start + total);
  });
}

/** New paid request: tier-specific triad OR gold flash in silent mode. */
export function playTierAlert(tier: Tier): void {
  if (getSilent()) {
    triggerGoldFlash();
    return;
  }
  playTriad(TIER_TRIADS[tier], getVolume());
}

/** Short single blip (errors / confirmations), reusing the volume. */
export function playBlip(): void {
  if (getSilent()) return;
  playTriad([660, 660, 660], getVolume() * 0.5);
}
