/**
 * Read a QR from a still photo (the front door's fallback when there is no
 * live camera). A phone photo of a TV is hard for a single pass: 12 MP,
 * the code small or large in the frame, screen-grid moiré and glare. So the
 * photo is tried as a whole, as centre crops and as overlapping halves, at a few sizes (jsQR
 * reads best at a few pixels per module; moiré averages out when scaled
 * down), and the first code found wins. Native BarcodeDetector goes first
 * where the browser has it.
 */

type JsQr = (data: Uint8ClampedArray, w: number, h: number) => { data: string } | null;

interface Detector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

/**
 * One pass: [share of the photo kept, longest side in px, where the crop
 * sits (0 = left/top, 0.5 = centre, 1 = right/bottom) across, down].
 */
export type PhotoPass = readonly [keep: number, longSide: number, ax: number, ay: number];

export const PHOTO_PASSES: ReadonlyArray<PhotoPass> = [
  [1, 1000, 0.5, 0.5],
  [1, 1600, 0.5, 0.5],
  [0.6, 1000, 0.5, 0.5],
  [1, 700, 0.5, 0.5],
  [0.4, 800, 0.5, 0.5],
  // Small sizes: a photo of a screen carries a pixel-grid pattern (moiré)
  // that scaling down averages away.
  [1, 500, 0.5, 0.5],
  [0.6, 600, 0.5, 0.5],
  [1, 400, 0.5, 0.5],
  [0.4, 450, 0.5, 0.5],
  // The code off to one side (a TV filmed at an angle): overlapping halves.
  ...[0, 0.5, 1].flatMap((ay) => [0, 0.5, 1].map((ax) => [0.5, 1000, ax, ay] as const)).filter(([, , ax, ay]) => ax !== 0.5 || ay !== 0.5),
  [0.6, 1600, 0.5, 0.5],
  [1, 2200, 0.5, 0.5],
];

/** The source rectangle and canvas size for one pass (pure, for tests). */
export function passGeometry(width: number, height: number, [keep, longSide, ax, ay]: PhotoPass) {
  const sw = Math.round(width * keep);
  const sh = Math.round(height * keep);
  const sx = Math.round((width - sw) * ax);
  const sy = Math.round((height - sh) * ay);
  const scale = Math.min(1, longSide / Math.max(sw, sh));
  return { sx, sy, sw, sh, w: Math.max(1, Math.round(sw * scale)), h: Math.max(1, Math.round(sh * scale)) };
}

async function loadImage(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  try {
    const bmp = await createImageBitmap(file);
    return { source: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() };
  } catch {
    // Older Safari: decode through an <img>.
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  }
}

/** The QR's text, or null when no pass finds one. */
export async function readQrFromPhoto(file: Blob): Promise<string | null> {
  const img = await loadImage(file);
  try {
    const Native = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (Native) {
      try {
        const codes = await new Native({ formats: ["qr_code"] }).detect(img.source);
        if (codes[0]?.rawValue) return codes[0].rawValue;
      } catch {
        // Fall through to jsQR.
      }
    }
    const jsQR = (await import("jsqr")).default as JsQr;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    for (const pass of PHOTO_PASSES) {
      const g = passGeometry(img.width, img.height, pass);
      canvas.width = g.w;
      canvas.height = g.h;
      ctx.drawImage(img.source, g.sx, g.sy, g.sw, g.sh, 0, 0, g.w, g.h);
      const code = jsQR(ctx.getImageData(0, 0, g.w, g.h).data, g.w, g.h);
      if (code?.data) return code.data;
      // Let the page breathe between passes (the spinner keeps turning).
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return null;
  } finally {
    img.done();
  }
}
