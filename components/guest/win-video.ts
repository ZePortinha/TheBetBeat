/**
 * The winner's moment as a video for Instagram Stories (2026-10-08): the
 * same 2D scene as the live screen (win-scene), with the album art and the
 * text drawn in, recorded in the browser from a 720×1280 canvas with
 * MediaRecorder. MP4 when the phone can (iOS Safari, recent Chrome), else
 * WebM. Nothing leaves the phone until the guest shares it.
 */

import { createWinScene, type WinText } from "./win-scene";

export const VIDEO_SECONDS = 7;
const W = 720;
const H = 1280;
const FPS = 30;

const TYPES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

/** The best format this browser records, or null (no video: share the image). */
export function videoType(): string | null {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") return null;
  return TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** The album art, through our own origin so the canvas stays exportable. */
async function loadCover(slotId: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(`/api/guest/auction/${slotId}/cover`);
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

/**
 * Records the video in real time (≈ VIDEO_SECONDS). The canvas is in the
 * page (invisible) because some browsers do not capture detached ones.
 */
export async function recordWinVideo(slotId: string, text: WinText, signal?: AbortSignal): Promise<File> {
  const type = videoType();
  if (!type) throw new Error("no_video");
  const cover = await loadCover(slotId);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "2px",
    height: "2px",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no_canvas");

  const scene = createWinScene({ cover, text });
  scene.draw(ctx, W, H, 0);
  const stream = canvas.captureStream(FPS);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error("recorder"));
      signal?.addEventListener("abort", () => {
        if (recorder.state !== "inactive") recorder.stop();
        reject(new DOMException("aborted", "AbortError"));
      });
      recorder.start(500);
      const start = performance.now();
      const frame = (now: number) => {
        if (recorder.state === "inactive") return;
        const t = (now - start) / 1000;
        scene.draw(ctx, W, H, Math.min(t, VIDEO_SECONDS));
        if (t >= VIDEO_SECONDS) recorder.stop();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    canvas.remove();
    cover?.close();
  }

  const mime = type.split(";")[0] ?? "video/mp4";
  const blob = new Blob(chunks, { type: mime });
  return new File([blob], `betbeat-vencedor.${mime === "video/mp4" ? "mp4" : "webm"}`, { type: mime });
}
