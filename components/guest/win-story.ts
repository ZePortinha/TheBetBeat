/**
 * The winner's Story picture (owner, 2026-11-06, after Spotify's song cards):
 * 1080×1920, a colour taken from the album art behind a dark card that holds
 * a still of the winner's animation (the same scene as the screen, at the
 * same moment), the song, the artist, and the Discontrol mark with the venue.
 *
 * It is drawn on the phone while the guest watches, so it is ready before
 * they tap: iOS only opens the share sheet straight from a tap, never after
 * a wait. Instagram's own "Sharing to Stories" (the card Spotify pastes into
 * a new Story by itself) exists only for native iOS and Android apps with a
 * Meta app id; from a web app the way into Instagram is the system share
 * sheet with this file.
 *
 * The layout and colour maths are pure (unit-tested); only `buildWinStory`
 * touches a canvas.
 */

import { offscreen, roundRect, sceneFont } from "./win-canvas";
import { createWinScene } from "./win-scene";

export const STORY_W = 1080;
export const STORY_H = 1920;

/** The still: the scene at a portrait 4:5, when the champagne still flies. */
const PRINT_W = 1080;
const PRINT_H = 1350;
export const PRINT_AT_SECONDS = 1.8;

/** Card geometry (px of the 1080×1920 story). */
const CARD_W = 840;
const PAD = 44;
const IMG_W = CARD_W - PAD * 2;
const IMG_H = Math.round((IMG_W * PRINT_H) / PRINT_W);

const WHITE = "#f5f5f7";
const GREY = "#aeaeb2";
const ACCENT = "#ff453a";
const ACCENT_FILL = "#e8112d";

export interface StoryPalette {
  /** Story background, top to bottom. */
  top: string;
  bottom: string;
  /** The card: near black, tinted by the same colour. */
  card: string;
}

/** No art, or art without colour (black and white photos): the brand's red. */
export const BRAND_PALETTE: StoryPalette = { top: "#5a1019", bottom: "#1e0508", card: "#140a0c" };

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * The colour of the album art, the way Spotify dresses its cards: the
 * colourful mid tones of the picture decide the hue (near black, near white
 * and grey count little), then it is muted and darkened so white type
 * always reads on it. `pixels` is RGBA, any size (a 24×24 thumbnail is plenty).
 */
export function storyPalette(pixels: ArrayLike<number>): StoryPalette {
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  let satSum = 0;
  let count = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if ((pixels[i + 3] ?? 0) < 128) continue;
    const R = pixels[i] ?? 0;
    const G = pixels[i + 1] ?? 0;
    const B = pixels[i + 2] ?? 0;
    const [, s, l] = rgbToHsl(R, G, B);
    const w = 0.02 + s * (1 - Math.abs(l - 0.5) * 2);
    r += R * w;
    g += G * w;
    b += B * w;
    weight += w;
    satSum += s * (1 - Math.abs(l - 0.5) * 2);
    count += 1;
  }
  if (count === 0 || satSum / count < 0.08) return BRAND_PALETTE;
  const [h, s] = rgbToHsl(r / weight, g / weight, b / weight);
  const sat = clamp(s, 0.2, 0.5);
  return {
    top: hslToHex(h, sat, 0.3),
    bottom: hslToHex(h, sat, 0.13),
    card: hslToHex(h, Math.min(sat, 0.3), 0.07),
  };
}

/**
 * The biggest size (from `sizes`, largest first) at which `text` fits in
 * `max`; at the smallest size, the text is cut with an ellipsis instead.
 */
export function fitLine(
  measure: (text: string, size: number) => number,
  text: string,
  max: number,
  sizes: readonly number[],
): { text: string; size: number } {
  for (const size of sizes) {
    if (measure(text, size) <= max) return { text, size };
  }
  const size = sizes[sizes.length - 1] ?? 32;
  let cut = text;
  while (cut.length > 1 && measure(`${cut}…`, size) > max) cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}…`, size };
}

/** The Discontrol mark (components/ui/brand-mark geometry), `size` px wide. */
function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const k = size / 512;
  const cx = x + 256 * k;
  const cy = y + 256 * k;
  ctx.fillStyle = "#1c1c1e";
  ctx.beginPath();
  ctx.arc(cx, cy, 232 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 5 * k;
  for (const r of [204, 178, 152]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = ACCENT_FILL;
  ctx.beginPath();
  ctx.arc(cx, cy, 112 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((40 * Math.PI) / 180);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 26 * k;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, -30 * k);
  ctx.lineTo(0, -92 * k);
  ctx.stroke();
  ctx.restore();
}

export interface WinStoryText {
  /** "Vencedor do leilão" */
  eyebrow: string;
  trackTitle: string;
  trackArtist: string;
  /** "Discontrol" */
  brand: string;
  venueName: string;
}

/** The colours of a piece of art, read from a small copy of it. */
function paletteOf(cover: CanvasImageSource | null): StoryPalette {
  if (!cover) return BRAND_PALETTE;
  const thumb = offscreen(24, 24);
  const g = thumb?.getContext("2d", { willReadFrequently: true });
  if (!thumb || !g) return BRAND_PALETTE;
  try {
    g.drawImage(cover, 0, 0, 24, 24);
    return storyPalette(g.getImageData(0, 0, 24, 24).data);
  } catch {
    // A cross-origin picture cannot be read: the brand colours instead.
    return BRAND_PALETTE;
  }
}

/** Draws the whole story on `ctx` (1080×1920). */
export function drawWinStory(
  ctx: CanvasRenderingContext2D,
  print: CanvasImageSource,
  palette: StoryPalette,
  text: WinStoryText,
  family: string,
) {
  const bg = ctx.createLinearGradient(0, 0, 0, STORY_H);
  bg.addColorStop(0, palette.top);
  bg.addColorStop(1, palette.bottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  const measure = (s: string, size: number, weight = 700) => {
    ctx.font = `${weight} ${size}px ${family}`;
    return ctx.measureText(s).width;
  };
  const inner = IMG_W;
  const title = fitLine((s, size) => measure(s, size), text.trackTitle, inner, [64, 58, 52, 46]);
  const artist = fitLine((s, size) => measure(s, size, 500), text.trackArtist, inner, [40, 36]);

  // Card height from its content, centred in the story.
  const eyebrowH = 30;
  const footerH = 60;
  const cardH = PAD + IMG_H + 40 + eyebrowH + 18 + title.size + 14 + artist.size + 44 + footerH + PAD;
  const x = (STORY_W - CARD_W) / 2;
  // A little above the middle: Instagram's reply bar covers the bottom of a Story.
  const y = Math.round((STORY_H - cardH) * 0.44);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  ctx.fillStyle = palette.card;
  roundRect(ctx, x, y, CARD_W, cardH, 36);
  ctx.fill();
  ctx.restore();

  // The still of the animation, with the card's rounded corners.
  ctx.save();
  roundRect(ctx, x + PAD, y + PAD, IMG_W, IMG_H, 22);
  ctx.clip();
  ctx.drawImage(print, x + PAD, y + PAD, IMG_W, IMG_H);
  ctx.restore();

  let cy = y + PAD + IMG_H + 40;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = ACCENT;
  ctx.font = `700 26px ${family}`;
  ctx.fillText(text.eyebrow.toUpperCase(), x + PAD, cy);
  cy += eyebrowH + 18;

  ctx.fillStyle = WHITE;
  ctx.font = `700 ${title.size}px ${family}`;
  ctx.fillText(title.text, x + PAD, cy);
  cy += title.size + 14;

  ctx.fillStyle = GREY;
  ctx.font = `500 ${artist.size}px ${family}`;
  ctx.fillText(artist.text, x + PAD, cy);
  cy += artist.size + 44;

  // Footer: the mark and the name on the left, the venue on the right.
  const mark = 56;
  drawMark(ctx, x + PAD, cy + (footerH - mark) / 2, mark);
  ctx.fillStyle = WHITE;
  ctx.font = `700 38px ${family}`;
  ctx.textBaseline = "middle";
  ctx.fillText(text.brand, x + PAD + mark + 16, cy + footerH / 2);
  const brandW = ctx.measureText(text.brand).width;
  const venueMax = inner - mark - 16 - brandW - 32;
  if (venueMax > 80) {
    const venue = fitLine((s, size) => measure(s, size, 600), text.venueName, venueMax, [30, 26]);
    ctx.font = `600 ${venue.size}px ${family}`;
    ctx.fillStyle = GREY;
    ctx.textAlign = "right";
    ctx.fillText(venue.text, x + PAD + inner, cy + footerH / 2);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** The still of the winner's animation, at the story's moment. */
function renderPrint(cover: CanvasImageSource | null): HTMLCanvasElement | null {
  const c = offscreen(PRINT_W, PRINT_H);
  const g = c?.getContext("2d");
  if (!c || !g) return null;
  const scene = createWinScene({ cover });
  scene.prepare();
  scene.draw(g, PRINT_W, PRINT_H, PRINT_AT_SECONDS);
  return c;
}

/** The finished picture, as a file for the share sheet. */
export async function buildWinStory(cover: CanvasImageSource | null, text: WinStoryText): Promise<File> {
  // The page's own type (SF Pro on iPhone, Inter elsewhere) must be ready.
  await document.fonts?.ready;
  const print = renderPrint(cover);
  const canvas = offscreen(STORY_W, STORY_H);
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx || !print) throw new Error("no_canvas");
  drawWinStory(ctx, print, paletteOf(cover), text, sceneFont());
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("no_blob");
  return new File([blob], "discontrol-vencedor.jpg", { type: "image/jpeg" });
}
