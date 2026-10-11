/**
 * The winning cover as a record pressed in smoked glass (2026-10-10): the art
 * fills the whole face, the grooves catch the light, and the stage shows
 * faintly through it. It irises open out of the gold line of the stage.
 *
 * Nothing on the record turns except the art, so the glass, the grooves, the
 * wedges of light and the gold rim are baked once per size into a plate, and
 * the art is cut into a disc once. A frame is then two blits, with no clipping.
 */

import { type Canvas2D, offscreen, sprite } from "./win-canvas";

const TAU = Math.PI * 2;
/** The brand red, for a winner with no album art. */
const ACCENT = "#e8112d";

export interface Vinyl {
  /** `open` irises the record out of the gold line: 0 is the line, 1 the full record. */
  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: number, open: number): void;
}

function vinylPlate(R: number, px: number): Canvas2D | null {
  const c = offscreen(px, px);
  const g = c?.getContext("2d");
  if (!c || !g) return null;
  const k = px / (2 * R);
  g.translate(px / 2, px / 2);
  g.scale(k, k);
  g.beginPath();
  g.arc(0, 0, R, 0, TAU);
  g.clip();
  let gr = g.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
  gr.addColorStop(0, "rgba(5,7,9,0.16)");
  gr.addColorStop(0.62, "rgba(5,7,9,0.22)");
  gr.addColorStop(0.9, "rgba(5,7,9,0.46)");
  gr.addColorStop(1, "rgba(255,240,205,0.12)");
  g.fillStyle = gr;
  g.fillRect(-R, -R, R * 2, R * 2);
  g.strokeStyle = "rgba(0,0,0,0.16)";
  g.lineWidth = Math.max(0.6 / k, R * 0.007);
  for (let r = R * 0.34; r < R * 0.985; r += R * 0.021) {
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.stroke();
  }
  g.strokeStyle = "rgba(255,246,222,0.07)";
  for (let r = R * 0.35; r < R * 0.985; r += R * 0.021) {
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.stroke();
  }
  // the two soft wedges of light a record always carries
  if (g.createConicGradient) {
    g.globalCompositeOperation = "lighter";
    const cg = g.createConicGradient(-0.7, 0, 0);
    for (const [q, a] of [[0, 0], [0.05, 0.22], [0.12, 0], [0.5, 0], [0.55, 0.17], [0.62, 0], [1, 0]] as const) {
      cg.addColorStop(q, `rgba(255,238,200,${a})`);
    }
    g.fillStyle = cg;
    g.fillRect(-R, -R, R * 2, R * 2);
    g.globalCompositeOperation = "source-over";
  }
  // the spindle hole, the ring etched round it and the gold rim
  g.fillStyle = "rgba(4,5,6,0.8)";
  g.beginPath();
  g.arc(0, 0, R * 0.045, 0, TAU);
  g.fill();
  g.strokeStyle = "rgba(226,198,140,0.5)";
  g.lineWidth = Math.max(0.8 / k, R * 0.008);
  g.beginPath();
  g.arc(0, 0, R * 0.26, 0, TAU);
  g.stroke();
  gr = g.createLinearGradient(-R, -R, R, R);
  gr.addColorStop(0, "#7a5c22");
  gr.addColorStop(0.35, "#f0d79a");
  gr.addColorStop(0.6, "#b58f45");
  gr.addColorStop(1, "#fff1cc");
  g.strokeStyle = gr;
  g.lineWidth = Math.max(1 / k, R * 0.02) * 2;
  g.beginPath();
  g.arc(0, 0, R, 0, TAU);
  g.stroke();
  return c;
}

/** The art cut into a disc once, so turning it every frame costs one blit and no clipping. */
function vinylDisc(R: number, px: number, cover: CanvasImageSource | null): Canvas2D | null {
  const c = offscreen(px, px);
  const g = c?.getContext("2d");
  if (!c || !g) return null;
  const k = px / (2 * R);
  g.translate(px / 2, px / 2);
  g.scale(k, k);
  if (cover) {
    // a touch wider than the record, so the corners of a square cover fall outside it
    const cs = R * 2.34;
    g.globalAlpha = 0.88;
    g.drawImage(cover, -cs / 2, -cs / 2, cs, cs);
    g.globalAlpha = 1;
  } else {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, R);
    gr.addColorStop(0, "#2a0710");
    gr.addColorStop(0.55, ACCENT);
    gr.addColorStop(1, "#3d0612");
    g.fillStyle = gr;
    g.fillRect(-R, -R, R * 2, R * 2);
  }
  g.globalCompositeOperation = "destination-in";
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(0, 0, R, 0, TAU);
  g.fill();
  return c;
}

export function createVinyl(cover: CanvasImageSource | null, halo: Canvas2D | null): Vinyl {
  const plates = new Map<number, Canvas2D | null>();
  const discs = new Map<number, Canvas2D | null>();
  const at = <T,>(map: Map<number, T>, key: number, make: () => T): T => {
    const hit = map.get(key);
    if (hit !== undefined) return hit;
    const made = make();
    map.set(key, made);
    return made;
  };

  return {
    draw(ctx, cx, cy, R, t, open) {
      if (R <= 0 || open <= 0) return;
      const spin = t * 1.55;
      const px = Math.min(1024, Math.ceil(2 * R));
      const key = Math.round(R);
      const plate = at(plates, key, () => vinylPlate(R, px));
      const disc = at(discs, key, () => vinylDisc(R, px, cover));
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = "lighter";
      sprite(ctx, halo, 0, 0, R * 2.5, 0.17 * open);
      ctx.globalCompositeOperation = "source-over";
      ctx.scale(1, Math.max(0.02, open));
      if (disc) {
        ctx.save();
        ctx.rotate(spin);
        ctx.drawImage(disc, -R, -R, R * 2, R * 2);
        ctx.restore();
      }
      if (plate) ctx.drawImage(plate, -R, -R, R * 2, R * 2);
      // a band of light sweeping over the glass
      const sw = (((((t - 1) % 4.2) + 4.2) % 4.2) / 1.1);
      if (sw > 0 && sw < 1) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, TAU);
        ctx.clip();
        ctx.globalCompositeOperation = "lighter";
        ctx.translate(-R + sw * R * 2, 0);
        ctx.rotate(0.4);
        const g = ctx.createLinearGradient(-R * 0.22, 0, R * 0.22, 0);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, "rgba(255,255,255,0.14)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(-R * 0.22, -R * 2, R * 0.44, R * 4);
        ctx.restore();
      }
      ctx.strokeStyle = "rgba(217,181,109,0.3)";
      ctx.lineWidth = Math.max(0.8, R * 0.007);
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.06, 0, TAU);
      ctx.stroke();
      ctx.restore();
    },
  };
}
