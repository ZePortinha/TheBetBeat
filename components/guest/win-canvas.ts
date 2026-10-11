/**
 * Canvas primitives shared by the winner's scene (win-scene), the champagne
 * bottle (win-bottle) and the record (win-vinyl).
 *
 * Everything here is a pure function of its arguments, so the live screen and
 * the Instagram video paint the same frame for the same `t`. Offscreen canvases
 * are only available in a browser: `offscreen()` returns null everywhere else
 * (unit tests run in node), and every caller draws without that layer instead
 * of throwing.
 */

export type Canvas2D = HTMLCanvasElement;

/** An offscreen canvas of this size, or null where there is no DOM. */
export function offscreen(w: number, h: number): Canvas2D | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c.getContext("2d") ? c : null;
}

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
/** Ease out cubic: fast, then settling. */
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
/** Ease in and out cubic, for the record's iris. */
export const easeInOut = (x: number) => {
  const k = clamp(x);
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
};
export const smoothstep = (a: number, b: number, x: number) => {
  const k = clamp((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/** Small seeded PRNG: the same scene every time (the video matches the screen). */
export function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A horizontal gradient through a list of colours, evenly spaced. */
export function hgrad(ctx: CanvasRenderingContext2D, x0: number, x1: number, stops: readonly string[]): CanvasGradient {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

/** One pre-rendered sprite, centred, at an alpha. Skipped when the sprite could not be baked. */
export function sprite(
  ctx: CanvasRenderingContext2D,
  img: Canvas2D | null,
  x: number,
  y: number,
  size: number,
  alpha = 1,
  rot = 0,
) {
  if (!img || alpha <= 0.002 || size <= 0) return;
  ctx.globalAlpha = alpha;
  if (rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  } else {
    ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
}

/** A soft round glow, baked once. */
export function glowSprite(rgb: string, soft = 0.45): Canvas2D | null {
  const c = offscreen(128, 128);
  const g = c?.getContext("2d");
  if (!c || !g) return null;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, `rgba(${rgb},1)`);
  gr.addColorStop(0.22, `rgba(${rgb},${soft})`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/** A fuller round blob, for foam. */
export function blobSprite(rgb: string): Canvas2D | null {
  const c = offscreen(64, 64);
  const g = c?.getContext("2d");
  if (!c || !g) return null;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb},1)`);
  gr.addColorStop(0.55, `rgba(${rgb},0.92)`);
  gr.addColorStop(0.8, `rgba(${rgb},0.35)`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return c;
}

/** A puff of smoke: overlapping faint discs, seeded so it is always the same puff. */
export function smokeSprite(rgb: string, seed: number): Canvas2D | null {
  const c = offscreen(256, 256);
  const g = c?.getContext("2d");
  if (!c || !g) return null;
  const r = rng(seed);
  for (let i = 0; i < 18; i += 1) {
    const a = r() * Math.PI * 2;
    const d = r() * 60;
    const x = 128 + Math.cos(a) * d;
    const y = 128 + Math.sin(a) * d;
    const rad = 36 + r() * 56;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${rgb},0.16)`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
  }
  return c;
}

/** The font the page is set in, so the canvas text matches the screen. */
export function sceneFont(): string {
  if (typeof document === "undefined") return "sans-serif";
  const family = getComputedStyle(document.body).fontFamily;
  return family || "sans-serif";
}

/** Draws a string with extra space between the letters, centred on `x`. */
export function spaced(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, sp: number) {
  const chars = [...s];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + sp * (chars.length - 1);
  let cx = x - total / 2;
  ctx.textAlign = "left";
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, y);
    cx += (widths[i] ?? 0) + sp;
  });
  ctx.textAlign = "center";
}

/** A band of light travelling across a gradient, for gold type. */
export function shine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  p: number,
  base: string,
  hi: string,
  width = 0.16,
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, base);
  g.addColorStop(clamp(p - width), base);
  g.addColorStop(clamp(p), hi);
  g.addColorStop(clamp(p + width), base);
  g.addColorStop(1, base);
  return g;
}

/** Ellipsis when a line is wider than the space it has. */
export function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}
