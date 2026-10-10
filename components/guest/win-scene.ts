/**
 * The winner's moment, "Gold & Smoke" (2026-10-10, chosen from five options and
 * refined with the venue over five rounds). Plain Canvas 2D, no dependencies,
 * and a PURE function of time: `draw(ctx, w, h, t)` paints the same frame for
 * the same `t`, so the live screen and the Instagram video are one animation.
 *
 *   0.00  a gold line draws itself across the middle; smoke drifts, dust lifts
 *   0.15  the sparkler on the bottle's neck catches
 *   0.30  the record irises open out of the line and starts turning
 *   0.36  the cork leaves at speed; the label switches on; champagne sprays
 *   0.80  the title, the amount and the track fade up under the record
 *
 * Particles are seeded once (`createWinScene`) and placed analytically
 * (ballistics with drag), so nothing accumulates frame to frame. The bottle's
 * shading (win-bottle) is spread over the first frames, and everything else
 * expensive — smoke, the stage's warm wash, the record — is baked once and
 * blitted, so a phone holds the frame rate.
 *
 * Canvas colours are literal by necessity; they mirror the tokens (accent red
 * #e8112d) plus the warm gold of the stage.
 */

import {
  type Canvas2D,
  blobSprite,
  clamp,
  easeInOut,
  easeOut,
  fit,
  glowSprite,
  offscreen,
  rng,
  sceneFont,
  shine,
  spaced,
  sprite,
  smokeSprite,
} from "./win-canvas";
import { createBottle, drawCork, labelLight, type Bottle } from "./win-bottle";
import { createVinyl, type Vinyl } from "./win-vinyl";

export interface WinText {
  eyebrow: string;
  title: string;
  amount: string;
  trackTitle: string;
  trackArtist: string;
  brand: string;
  footer: string;
}

export interface WinSceneOptions {
  /** Album art, pressed into the record. Without it the record is brand red. */
  cover?: CanvasImageSource | null;
  /** Everything drawn in the canvas, text included (the video). */
  text?: WinText | null;
  /** Fewer particles and coarser shading (small or slow phones). */
  lite?: boolean;
}

export interface WinScene {
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void;
  /** Shades every light angle now, instead of one a frame (the video). */
  prepare(): void;
}

/** When the cork leaves, in scene seconds. */
const POP = 0.36;
/** The bottle's angles over the whole animation: what gets shaded ahead of time. */
const ROT_FROM = -0.64;
const ROT_TO = 0.06;

interface Spark {
  a: number;
  v: number;
  off: number;
  life: number;
}

interface Foam {
  te: number;
  sp: number;
  spread: number;
  size: number;
  drop: boolean;
}

interface Dust {
  ang: number;
  sp: number;
  x0: number;
  y0: number;
  size: number;
  tw: number;
  ph: number;
  rise: number;
  d: number;
}

interface Smoke {
  x: number;
  y: number;
  sc: number;
  sp: number;
  ph: number;
}

interface Layout {
  u: number;
  s: number;
  cx: number;
  cy: number;
}

const layout = (w: number, h: number): Layout => ({ u: w / 360, s: w * 0.58, cx: w / 2, cy: h * 0.355 });

export function createWinScene(opts: WinSceneOptions = {}): WinScene {
  const lite = opts.lite ?? false;
  const SP = {
    gold: glowSprite("255,214,140"),
    white: glowSprite("255,255,255"),
    foam: blobSprite("255,253,246"),
    smoke: smokeSprite("214,168,92", 7),
  };
  const vinyl: Vinyl = createVinyl(opts.cover ?? null, SP.gold);

  // Per-size state: the particles, the baked stage wash and the bottle's shading.
  let size = "";
  let dust: Dust[] = [];
  let smoke: Smoke[] = [];
  let foam: Foam[] = [];
  let sparks: Spark[] = [];
  let bottle: Bottle | null = null;
  let glowBuf: Canvas2D | null = null;
  let smokeBuf: Canvas2D | null = null;

  function build(w: number, h: number, L: Layout) {
    const r = rng(20261010);
    dust = Array.from({ length: lite ? 48 : 78 }, () => {
      const a = r() * Math.PI * 2;
      const m = 0.5 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      return {
        ang: a + (r() - 0.5) * 0.6,
        sp: 0.2 + r() * 0.8,
        x0: L.cx + Math.cos(a) * L.s * m,
        y0: L.cy + Math.sin(a) * L.s * m,
        size: 0.6 + r() * 1.6,
        tw: 2 + r() * 4,
        ph: r() * 6.3,
        rise: 6 + r() * 20,
        d: r() * 0.3,
      };
    });
    smoke = Array.from({ length: lite ? 4 : 7 }, () => ({
      x: r() * w,
      y: h * (0.35 + r() * 0.8),
      sc: 0.8 + r() * 0.8,
      sp: 0.6 + r(),
      ph: r() * 6.3,
    }));
    foam = Array.from({ length: lite ? 110 : 170 }, () => {
      const k = r();
      return {
        te: POP + 2.4 * Math.pow(k, 2.2),
        sp: 0.85 + r() * 0.7,
        spread: (r() - 0.5) * 0.32,
        size: 0.6 + r() * 1.0,
        drop: r() < 0.28,
      };
    });
    sparks = Array.from({ length: lite ? 44 : 70 }, () => ({
      a: -Math.PI / 2 + (r() - 0.5) * 1.6,
      v: 0.25 + r() * 0.45,
      off: r(),
      life: 0.35 + r() * 0.35,
    }));
    bottle = createBottle({
      height: h * 0.54,
      from: ROT_FROM,
      to: ROT_TO,
      pop: POP,
      cap: lite ? 340 : 520,
      step: lite ? 0.08 : 0.055,
    });
    // the stage's warm wash and the smoke are soft and slow, so they live at half
    // size: seven screen-sized blends a frame cost far more than one blit
    const bw = Math.ceil(w * 0.5);
    const bh = Math.ceil(h * 0.5);
    glowBuf = offscreen(bw, bh);
    const gg = glowBuf?.getContext("2d");
    if (gg) {
      gg.scale(0.5, 0.5);
      const gr = gg.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, w * 0.95);
      gr.addColorStop(0, "rgba(201,160,82,0.3)");
      gr.addColorStop(0.45, "rgba(110,76,28,0.14)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      gg.fillStyle = gr;
      gg.fillRect(0, 0, w, h);
    }
    smokeBuf = offscreen(bw, bh);
  }

  /** Where the bottle is, how it leans, and where its mouth points, at time `t`. */
  function pose(w: number, h: number, t: number) {
    const enter = easeOut(t / 0.35);
    const kick = t > POP ? Math.exp(-(t - POP) * 7) * Math.sin((t - POP) * 26) * 0.05 : 0;
    const sway = Math.sin(t * 1.25) * 0.045 * easeOut((t - 0.6) / 0.8);
    const ang = -0.14 - 0.45 * (1 - enter) + kick + sway;
    return {
      ang,
      H: h * 0.54,
      x: w * 0.8 + (1 - enter) * w * 0.3,
      y: h * 0.47 + (1 - enter) * h * 0.35,
      dir: { x: Math.sin(ang), y: -Math.cos(ang) },
    };
  }

  function drawStage(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, L: Layout) {
    ctx.fillStyle = "#050403";
    ctx.fillRect(0, 0, w, h);
    const gl = easeOut((t - 0.35) / 1.2) * (0.85 + 0.15 * Math.sin(t * 1.6));
    if (glowBuf) {
      ctx.globalAlpha = gl;
      ctx.drawImage(glowBuf, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    const sg = smokeBuf?.getContext("2d");
    if (smokeBuf && sg) {
      sg.setTransform(1, 0, 0, 1, 0, 0);
      sg.clearRect(0, 0, smokeBuf.width, smokeBuf.height);
      sg.setTransform(0.5, 0, 0, 0.5, 0, 0);
      for (const s of smoke) {
        const span = h * 1.6;
        const y = h * 1.25 - ((h * 1.25 - s.y + t * h * 0.03 * s.sp) % span);
        const x = s.x + Math.sin(t * 0.3 + s.ph) * w * 0.08;
        sprite(sg, SP.smoke, x, y, w * 0.95 * s.sc, 0.55 * easeOut(t / 1.5));
      }
      ctx.globalCompositeOperation = "screen";
      ctx.drawImage(smokeBuf, 0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
    }
    // two rings of pressure leaving the middle as the record opens
    for (let k = 0; k < 2; k += 1) {
      const p = (t - 0.45 - k * 0.2) / 1.5;
      if (p <= 0 || p >= 1) continue;
      ctx.strokeStyle = `rgba(236,200,126,${(1 - p) * 0.75})`;
      ctx.lineWidth = (2.4 - 1.6 * p) * L.u;
      ctx.beginPath();
      ctx.arc(L.cx, L.cy, L.s * 0.6 + easeOut(p) * w * 0.7, 0, Math.PI * 2);
      ctx.stroke();
    }
    // the gold line draws itself, then the record irises open out of it
    const open = easeInOut((t - 0.3) / 0.5);
    if (open > 0) vinyl.draw(ctx, L.cx, L.cy, L.s * 0.52, t, open);
    const grow = easeOut(t / 0.3);
    const lw = L.s * grow * 1.12;
    const fade = 1 - easeOut((t - 0.3) / 0.35);
    if (fade > 0.01) {
      const gx = ctx.createLinearGradient(L.cx - lw / 2, 0, L.cx + lw / 2, 0);
      gx.addColorStop(0, "rgba(226,186,110,0)");
      gx.addColorStop(0.5, `rgba(255,241,204,${fade})`);
      gx.addColorStop(1, "rgba(226,186,110,0)");
      ctx.fillStyle = gx;
      ctx.fillRect(L.cx - lw / 2, L.cy - 0.8 * L.u, lw, 1.6 * L.u);
    }
    // gold dust lifting off the record
    ctx.globalCompositeOperation = "lighter";
    for (const p of dust) {
      const dt = t - 0.45 - p.d;
      if (dt <= 0) continue;
      const k = 2.2;
      const out = (1 - Math.exp(-k * dt)) / k;
      const x = p.x0 + Math.cos(p.ang) * p.sp * w * 0.4 * out + Math.sin(t * 0.7 + p.ph) * 4 * L.u;
      const y = p.y0 + Math.sin(p.ang) * p.sp * w * 0.4 * out - p.rise * L.u * dt;
      const a = Math.min(1, dt * 4) * (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * p.tw + p.ph)));
      sprite(ctx, SP.gold, x, y, p.size * L.u * 7, a * 0.9);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawText(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, text: WinText) {
    const u = w / 360;
    const cx = w / 2;
    const font = sceneFont();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = 14 * u;
    const t0 = 0.8;
    const line = (at: number, fn: () => void) => {
      const a = easeOut((t - at) / 0.5);
      if (a <= 0) return;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(0, (1 - a) * 12 * u);
      fn();
      ctx.restore();
    };
    line(t0, () => {
      ctx.font = `600 ${11 * u}px ${font}`;
      ctx.fillStyle = "#d9b56d";
      spaced(ctx, text.eyebrow.toUpperCase(), cx, h * 0.64, 2.8 * u);
    });
    line(t0 + 0.1, () => {
      ctx.font = `800 ${50 * u}px ${font}`;
      const sp = -1.4 * u;
      const tw = ctx.measureText(text.title).width + sp * (text.title.length - 1);
      ctx.fillStyle = shine(ctx, cx - tw / 2, cx + tw / 2, ((t * 0.5) % 1.8) - 0.3, "#d9b56d", "#fff6dc");
      spaced(ctx, text.title, cx, h * 0.715, sp);
    });
    line(t0 + 0.22, () => {
      ctx.font = `600 ${30 * u}px ${font}`;
      ctx.fillStyle = "#f3e3bf";
      ctx.fillText(text.amount, cx, h * 0.783);
    });
    line(t0 + 0.34, () => {
      ctx.font = `600 ${17 * u}px ${font}`;
      ctx.fillStyle = "#f5efe4";
      ctx.fillText(fit(ctx, text.trackTitle, w * 0.86), cx, h * 0.838);
      ctx.font = `400 ${14 * u}px ${font}`;
      ctx.fillStyle = "rgba(245,239,228,0.6)";
      ctx.fillText(fit(ctx, text.trackArtist, w * 0.86), cx, h * 0.868);
    });
    line(t0 + 0.5, () => {
      ctx.font = `600 ${10 * u}px ${font}`;
      ctx.fillStyle = "rgba(245,239,228,0.6)";
      spaced(ctx, text.brand.toUpperCase(), cx, h * 0.93, 2.4 * u);
      ctx.font = `500 ${9 * u}px ${font}`;
      ctx.fillText(text.footer, cx, h * 0.962);
    });
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }

  return {
    prepare() {
      bottle?.warm(1e3);
    },
    draw(ctx, w, h, t) {
      const L = layout(w, h);
      const key = `${Math.round(w)}x${Math.round(h)}`;
      if (key !== size) {
        size = key;
        build(w, h, L);
      }
      // One more light angle per frame, so opening the screen never blocks.
      bottle?.warm(1);

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      drawStage(ctx, w, h, t, L);

      const u = L.u;
      const p = pose(w, h, t);
      const tip = { x: p.x, y: p.y };
      const corkV = h * 3.3;
      const corkG = h * 1.3;
      const corkAt = (dt: number) => ({
        x: tip.x + p.dir.x * corkV * dt - w * 0.5 * dt * dt,
        y: tip.y + p.dir.y * corkV * dt + 0.5 * corkG * dt * dt,
      });

      // the crack: a flat ring of pressure leaving the muzzle
      if (t > POP && t < POP + 0.45) {
        const k = (t - POP) / 0.45;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.translate(tip.x, tip.y);
        ctx.rotate(p.ang);
        ctx.strokeStyle = `rgba(255,246,228,${(1 - k) * 0.8})`;
        ctx.lineWidth = (3.4 - 2.6 * k) * u;
        ctx.beginPath();
        ctx.ellipse(0, -easeOut(k) * h * 0.1, easeOut(k) * w * 0.52, easeOut(k) * w * 0.16, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      const lit = labelLight(t, POP);
      ctx.globalCompositeOperation = "lighter";
      sprite(ctx, SP.gold, p.x + Math.sin(-p.ang) * 0.75 * p.H, p.y + Math.cos(p.ang) * 0.75 * p.H, p.H * 0.75, 0.2 * lit);
      ctx.globalCompositeOperation = "source-over";
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.ang);
      bottle?.draw(ctx, p.H, { t, rot: p.ang, lit, drained: clamp((t - POP) / 2.6) });
      ctx.restore();

      // the pop: a flash and a starburst
      ctx.globalCompositeOperation = "lighter";
      if (t > POP - 0.02 && t < POP + 0.3) {
        const a = 1 - (t - POP) / 0.3;
        sprite(ctx, SP.white, tip.x, tip.y, w * 0.3 * a, a * 0.8);
      }
      if (t > POP && t < POP + 0.7) {
        const k = (t - POP) / 0.7;
        const a = (1 - k) * 0.6;
        for (let i = 0; i < 14; i += 1) {
          const ra = (i / 14) * Math.PI * 2 + k * 0.4;
          const len = w * (0.25 + 0.5 * easeOut(k)) * (i % 2 ? 0.6 : 1);
          const wd = 0.035;
          const g = ctx.createLinearGradient(tip.x, tip.y, tip.x + Math.cos(ra) * len, tip.y + Math.sin(ra) * len);
          g.addColorStop(0, `rgba(255,255,255,${a})`);
          g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(tip.x, tip.y);
          ctx.lineTo(tip.x + Math.cos(ra - wd) * len, tip.y + Math.sin(ra - wd) * len);
          ctx.lineTo(tip.x + Math.cos(ra + wd) * len, tip.y + Math.sin(ra + wd) * len);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = "source-over";
      if (t > POP && t < POP + 0.9) drawCork(ctx, p.H, t - POP, corkAt);

      // the sparkler fixed to the neck
      const sx = p.x + Math.cos(p.ang) * 0.075 * p.H + p.dir.x * 0.1 * p.H;
      const sy = p.y + Math.sin(p.ang) * 0.075 * p.H + p.dir.y * 0.1 * p.H;
      const on = easeOut((t - 0.15) / 0.3);
      if (on > 0) {
        ctx.strokeStyle = "#8a8f96";
        ctx.lineWidth = 1.6 * u;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(p.ang) * 0.06 * p.H - p.dir.x * 0.18 * p.H, p.y + Math.sin(p.ang) * 0.06 * p.H - p.dir.y * 0.18 * p.H);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        ctx.globalCompositeOperation = "lighter";
        sprite(ctx, SP.gold, sx, sy, (40 + 10 * Math.sin(t * 40)) * u, on);
        sprite(ctx, SP.white, sx, sy, 16 * u, on);
        for (const s of sparks) {
          const age = (t + s.off * s.life) % s.life;
          const q = age / s.life;
          const x = sx + Math.cos(s.a) * s.v * h * age;
          const y = sy + Math.sin(s.a) * s.v * h * age + 0.5 * h * 1.2 * age * age;
          ctx.strokeStyle = `rgba(255,${200 - 80 * q},${140 - 100 * q},${(1 - q) * on})`;
          ctx.lineWidth = 1.3 * u;
          ctx.beginPath();
          ctx.moveTo(x - Math.cos(s.a) * 14 * u, y - Math.sin(s.a) * 14 * u + 4 * u);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
      }

      // the champagne leaving the bottle: drag along the jet, gravity down
      for (const f of foam) {
        const dt = t - f.te;
        const life = f.drop ? 2.4 : 1.5;
        if (dt <= 0 || dt > life) continue;
        const I = Math.max(0.3, 1 - (f.te - POP) / 2.4);
        const v = h * 1.45 * f.sp * I;
        const a = Math.atan2(p.dir.y, p.dir.x) + f.spread;
        const k = f.drop ? 0.9 : 1.8;
        const out = (1 - Math.exp(-k * dt)) / k;
        const g = h * (f.drop ? 1.1 : 0.55);
        const x = tip.x + Math.cos(a) * v * out;
        const y = tip.y + Math.sin(a) * v * out + 0.5 * g * dt * dt;
        const fade = Math.pow(1 - dt / life, 1.4);
        if (f.drop) sprite(ctx, SP.gold, x, y, (5 + f.size * 5) * u, fade);
        else sprite(ctx, SP.foam, x, y, (5 + dt * 20) * u * f.size, fade * 0.8);
      }

      if (opts.text) drawText(ctx, w, h, t, opts.text);
    },
  };
}

/**
 * Runs the scene full screen on a canvas until `stop()`. The canvas is drawn in
 * device pixels (DPR capped at 2, 1.5 on a slow phone) so the record's grooves
 * and the glass stay sharp; reduced motion paints one still frame.
 */
export function startWinScene(canvas: HTMLCanvasElement, opts: WinSceneOptions & { still?: boolean }): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const lowEnd = (navigator.hardwareConcurrency ?? 8) <= 4;
  const scene = createWinScene({ ...opts, lite: opts.lite ?? lowEnd });
  let raf = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };
  resize();
  if (opts.still) {
    scene.prepare();
    scene.draw(ctx, canvas.width, canvas.height, 2.6);
    return () => {};
  }
  const start = performance.now();
  const frame = (now: number) => {
    scene.draw(ctx, canvas.width, canvas.height, (now - start) / 1000);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  window.addEventListener("resize", resize);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
  };
}
