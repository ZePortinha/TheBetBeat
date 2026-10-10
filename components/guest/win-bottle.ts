/**
 * The champagne bottle of the winner's scene (2026-10-10): dark green glass,
 * translucent enough to see the champagne move inside, with a glowing BetBeat
 * label and a cork that leaves at speed.
 *
 * It is drawn as a surface of revolution, shaded per pixel: a profile of
 * (y, half-width) gives every point a normal, and two lights that live in the
 * room — not on the bottle — slide over it as it tilts. Each angle is shaded
 * once into two images and cached: `m` is what the glass lets through (drawn
 * with `multiply`, which is what makes it read as glass) and `a` is what it
 * reflects (drawn with `lighter`). Shading is spread over the first frames
 * (`warm`), so opening the screen never blocks.
 *
 * Local space: the origin is the lip, +y runs down the bottle, and every
 * measurement is a fraction of `H`, the bottle's height on screen.
 */

import {
  type Canvas2D,
  clamp,
  hgrad,
  offscreen,
  rng,
  roundRect,
  sceneFont,
  smoothstep,
  spaced,
  sprite,
  glowSprite,
} from "./win-canvas";

export interface BottleState {
  /** Scene time, in seconds. */
  t: number;
  /** The bottle's angle on screen: it decides how the room's light falls on it. */
  rot: number;
  /** How lit the label is, 0..1. */
  lit: number;
  /** How much champagne has left the bottle, 0..1. */
  drained: number;
}

export interface Bottle {
  /** Shades at most `max` more light angles; call once a frame until `ready`. */
  warm(max?: number): void;
  ready(): boolean;
  draw(ctx: CanvasRenderingContext2D, H: number, state: BottleState): void;
}

/** The label's neon, and the glass it shines through. */
const LABEL_RGB = "150,210,255";
const LABEL_CORE = "240,248,255";

// Dom Pérignon proportions: capsule dome and bulge, the ring under it, a long
// neck opening into long sloping shoulders, then the straight body.
const PROFILE: readonly (readonly [number, number])[] = [
  [-0.012, 0], [-0.007, 0.03], [0, 0.046], [0.015, 0.056], [0.035, 0.058], [0.06, 0.055],
  [0.075, 0.05], [0.09, 0.049], [0.18, 0.05], [0.26, 0.053], [0.32, 0.06], [0.38, 0.082],
  [0.43, 0.108], [0.48, 0.13], [0.53, 0.145], [0.57, 0.15], [0.975, 0.15], [0.993, 0.145], [1.002, 0.12],
];
const TOP = PROFILE[0]![0];
const BOTTOM = PROFILE[PROFILE.length - 1]![0];
const SLOPES = PROFILE.map((p, i) => {
  const a = PROFILE[Math.max(0, i - 1)]!;
  const b = PROFILE[Math.min(PROFILE.length - 1, i + 1)]!;
  return (b[1] - a[1]) / (b[0] - a[0] || 1);
});

/** The bottle's half-width at `y`, on a smooth (Hermite) curve through the profile. */
function halfWidth(y: number): number {
  if (y <= TOP || y >= BOTTOM) return 0;
  let i = 1;
  while (PROFILE[i]![0] < y) i += 1;
  const [y0, w0] = PROFILE[i - 1]!;
  const [y1, w1] = PROFILE[i]!;
  const d = y1 - y0;
  const k = (y - y0) / d;
  const k2 = k * k;
  const k3 = k2 * k;
  const v =
    (2 * k3 - 3 * k2 + 1) * w0 +
    (k3 - 2 * k2 + k) * d * SLOPES[i - 1]! +
    (-2 * k3 + 3 * k2) * w1 +
    (k3 - k2) * d * SLOPES[i]!;
  return Math.max(0, Math.min(Math.max(w0, w1), v));
}

/** The bottle's silhouette as a path, for clipping what is inside the glass. */
function bottlePath(ctx: CanvasRenderingContext2D, H: number) {
  const N = 160;
  const pts: [number, number][] = [];
  for (let i = 0; i <= N; i += 1) {
    const y = TOP + ((BOTTOM - TOP) * i) / N;
    pts.push([halfWidth(y) * H, y * H]);
  }
  ctx.beginPath();
  ctx.moveTo(0, TOP * H);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  for (let i = pts.length - 1; i >= 0; i -= 1) ctx.lineTo(-pts[i]![0], pts[i]![1]);
  ctx.closePath();
}

// ---------- shading ----------

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** The crumpled black foil on the neck. */
const crinkle = (x: number, y: number) =>
  vnoise(x, y) * 0.6 + vnoise(x * 2.3 + 17, y * 2.1 + 5) * 0.3 + vnoise(x * 5.1 + 3, y * 4.7 + 11) * 0.1;

type Vec3 = [number, number, number];
const norm3 = (x: number, y: number, z: number): Vec3 => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};
const rotXY = (v: Vec3, a: number): Vec3 => [
  v[0] * Math.cos(a) - v[1] * Math.sin(a),
  v[0] * Math.sin(a) + v[1] * Math.cos(a),
  v[2],
];

// The lights are fixed in the room, so when the bottle tilts the light slides over it.
const KEY = norm3(-0.55, -0.4, 0.73);
const RIM = norm3(0.88, -0.15, 0.45);

/** The studio as seen in a reflection: two tall softboxes and the warm room. */
function studio(rx: number, ry: number): [number, number] {
  const tall = 1 - smoothstep(0.55, 0.95, Math.abs(ry));
  const left = (1 - smoothstep(0.03, 0.09, Math.abs(rx + 0.6))) * tall;
  const right = (1 - smoothstep(0.02, 0.05, Math.abs(rx - 0.62))) * tall * 0.55;
  const room = 0.05 + 0.1 * smoothstep(0, 0.8, ry);
  return [left + right, room];
}

/** The glass as a filter in the middle of the bottle and at its rim, and its reflections. */
const GLASS = {
  keyPow: 160,
  rimPow: 80,
  keyK: 1.4,
  rimK: 0.5,
  boxK: 0.2,
  midT: [0.15, 0.42, 0.26] as const,
  edgeT: [0.013, 0.058, 0.03] as const,
  env: [6, 15, 9] as const,
  sp: [30, 56, 38] as const,
};

interface Geometry {
  W: number;
  Hc: number;
  x0: number;
  y0: number;
  idx: Int32Array;
  N: Float32Array;
  info: Float32Array;
}

/** Normals, coverage and the foil mask do not depend on the light, so they are worked out once. */
function bottleGeometry(H: number): Geometry {
  const pad = 2;
  const x0 = -Math.ceil(0.152 * H) - pad;
  const y0 = Math.floor(TOP * H) - pad;
  const W = -x0 * 2;
  const Hc = Math.ceil(BOTTOM * H) - y0 + pad;
  const idx: number[] = [];
  const N: number[] = [];
  const info: number[] = [];
  const k = 1 / H;
  const fs = 90;
  for (let py = 0; py < Hc; py += 1) {
    const y = (py + y0 + 0.5) * k;
    const r = halfWidth(y);
    if (r <= 0) continue;
    const dr = (halfWidth(y + 0.002) - halfWidth(y - 0.002)) / 0.004;
    for (let px = 0; px < W; px += 1) {
      const X = (px + x0 + 0.5) * k;
      const cover = clamp((r - Math.abs(X)) * H + 0.5);
      if (cover <= 0) continue;
      const nx0 = clamp(X / r, -1, 1);
      const nz0 = Math.sqrt(Math.max(0, 1 - nx0 * nx0));
      // where the foil ends and the base begins, both follow the curve of the glass
      if (y > 0.986 + 0.013 * nz0) continue;
      const foil = y < 0.31 + 0.016 * nz0;
      let nx = nx0;
      let ny = -dr;
      const nz = nz0;
      if (foil) {
        const u = Math.asin(nx0) * r * fs * 1.3;
        const v = y * fs * 0.22;
        const e = 0.3;
        const n0 = crinkle(u, v);
        nx += (crinkle(u + e, v) - n0) * 1.5;
        ny += (crinkle(u, v + e) - n0) * 0.5;
      }
      const n = norm3(nx, ny, nz);
      idx.push(py * W + px);
      N.push(n[0], n[1], n[2]);
      info.push(cover, nz0, foil ? 1 : 0);
    }
  }
  return { W, Hc, x0, y0, idx: Int32Array.from(idx), N: Float32Array.from(N), info: Float32Array.from(info) };
}

interface Shaded {
  m: Canvas2D;
  a: Canvas2D;
  x: number;
  y: number;
  w: number;
  h: number;
  H: number;
}

/** Two images for one light angle: what the glass transmits, and what it reflects. */
function renderBottle(G: Geometry, H: number, rot: number): Shaded | null {
  const mc = offscreen(G.W, G.Hc);
  const ac = offscreen(G.W, G.Hc);
  const mctx = mc?.getContext("2d");
  const actx = ac?.getContext("2d");
  if (!mc || !ac || !mctx || !actx) return null;
  const mi = mctx.createImageData(G.W, G.Hc);
  const ai = actx.createImageData(G.W, G.Hc);
  const md = mi.data;
  const ad = ai.data;
  // the room's lights, seen from the bottle's own frame
  const key = rotXY(KEY, -rot);
  const rim = rotXY(RIM, -rot);
  const hk = norm3(key[0], key[1], key[2] + 1);
  const hr = norm3(rim[0], rim[1], rim[2] + 1);
  const cr = Math.cos(rot);
  const sr0 = Math.sin(rot);
  for (let j = 0, n = G.idx.length; j < n; j += 1) {
    const nx = G.N[j * 3]!;
    const ny = G.N[j * 3 + 1]!;
    const nz = G.N[j * 3 + 2]!;
    const cover = G.info[j * 3]!;
    const nz0 = G.info[j * 3 + 1]!;
    const foil = G.info[j * 3 + 2]! > 0;
    const diff = Math.max(0, nx * key[0] + ny * key[1] + nz * key[2]);
    const sk = Math.max(0, nx * hk[0] + ny * hk[1] + nz * hk[2]);
    const sr = Math.max(0, nx * hr[0] + ny * hr[1] + nz * hr[2]);
    // reflection direction, turned back into the room
    const rlx = 2 * nz * nx;
    const rly = 2 * nz * ny;
    const rx = rlx * cr - rly * sr0;
    const ry = rlx * sr0 + rly * cr;
    const fres = Math.pow(1 - nz, 4);
    const i = G.idx[j]! * 4;
    const A = 255 * cover;
    if (foil) {
      const [box, room] = studio(rx, ry);
      const sp = Math.pow(sk, 30) * 0.4 + Math.pow(sr, 24) * 0.18;
      const env = box * (0.1 + 0.25 * fres) + room * 0.3;
      const l = 6 + diff * 11 + env * 150 + sp * 170;
      md[i] = 6;
      md[i + 1] = 6;
      md[i + 2] = 7;
      md[i + 3] = A; // foil blocks the light
      ad[i] = l;
      ad[i + 1] = l;
      ad[i + 2] = l * 1.04;
      ad[i + 3] = A;
    } else {
      const [box, room] = studio(rx, ry);
      // thicker glass at the rim lets less through
      const th = Math.pow(1 - nz0, 1.2);
      for (let ch = 0; ch < 3; ch += 1) md[i + ch] = 255 * (GLASS.midT[ch]! + (GLASS.edgeT[ch]! - GLASS.midT[ch]!) * th);
      md[i + 3] = A;
      const refl = 0.05 + 0.95 * fres;
      const sp = Math.pow(sk, GLASS.keyPow) * GLASS.keyK + Math.pow(sr, GLASS.rimPow) * GLASS.rimK;
      const env = box * (GLASS.boxK + 0.35 * refl) + room * refl * 0.45;
      ad[i] = Math.min(255, diff * 1 + env * GLASS.env[0] + sp * GLASS.sp[0]);
      ad[i + 1] = Math.min(255, diff * 3 + env * GLASS.env[1] + sp * GLASS.sp[1]);
      ad[i + 2] = Math.min(255, diff * 1.5 + env * GLASS.env[2] + sp * GLASS.sp[2]);
      ad[i + 3] = A;
    }
  }
  mctx.putImageData(mi, 0, 0);
  actx.putImageData(ai, 0, 0);
  return { m: mc, a: ac, x: G.x0, y: G.y0, w: G.W, h: G.Hc, H };
}

// ---------- the champagne inside ----------

const BUBBLES = (() => {
  const r = rng(31);
  return Array.from({ length: 30 }, () => ({
    x: (r() - 0.5) * 1.5,
    r: 0.3 + r() * 0.8,
    sp: 0.35 + r() * 0.55,
    off: r(),
    wob: r() * 6.3,
  }));
})();

const settle = (x: number) => {
  const k = clamp(x / 0.25);
  return k * k * (3 - 2 * k);
};

/** The level, and the slosh that follows the pop; both are read by the two liquid passes. */
function surface(H: number, t: number, rot: number, drained: number, pop: number) {
  const top = 0.33 * H;
  const bottom = 0.972 * H;
  const yS = top + (0.1 + 0.27 * drained) * H;
  const slosh = Math.sin(t * 3.4) * 0.05 * Math.exp(-Math.max(0, t - pop) * 0.5) * settle(t - pop);
  return { top, bottom, yS, deep: bottom - yS, tilt: -rot + slosh, w: 0.145 * H, fw: 0.26 * H };
}

/** The champagne, drawn before the glass so the glass tints it. */
function drawLiquid(ctx: CanvasRenderingContext2D, H: number, t: number, rot: number, drained: number, pop: number) {
  const s = surface(H, t, rot, drained, pop);
  ctx.save();
  bottlePath(ctx, H);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(-0.3 * H, s.top, 0.6 * H, s.bottom - s.top);
  ctx.clip();
  ctx.translate(0, s.yS);
  ctx.rotate(s.tilt);
  const g = ctx.createLinearGradient(-s.w, 0, s.w, 0);
  g.addColorStop(0, "rgba(104,68,14,0.96)");
  g.addColorStop(0.24, "rgba(226,164,62,0.96)");
  g.addColorStop(0.48, "rgba(252,218,138,0.96)");
  g.addColorStop(0.74, "rgba(218,158,58,0.96)");
  g.addColorStop(1, "rgba(92,60,10,0.96)");
  ctx.fillStyle = g;
  ctx.fillRect(-s.fw, 0, s.fw * 2, H);
  for (const b of BUBBLES) {
    const q = (t * b.sp + b.off) % 1;
    const y = s.deep * (1 - q);
    const x = b.x * s.w * 0.62 + Math.sin(q * 7 + b.wob) * s.w * 0.07;
    ctx.globalAlpha = 0.5 * Math.min(1, q * 6) * (1 - q * 0.5);
    ctx.fillStyle = "#fff6dd";
    ctx.beginPath();
    ctx.arc(x, y, b.r * 0.012 * H, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // the surface itself: the far edge curves up, the near edge catches the light
  ctx.fillStyle = "rgba(188,140,46,0.9)";
  ctx.beginPath();
  ctx.ellipse(0, 0, s.w * 1.12, s.w * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,252,238,0.95)";
  ctx.beginPath();
  ctx.ellipse(0, 0, s.w * 1.12, s.w * 0.22, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(-s.w * 1.12, -s.w * 0.045, s.w * 2.24, s.w * 0.09);
  ctx.restore();
}

/**
 * The light the champagne throws back through the glass. Drawn over the glass,
 * so the wine reads without turning the whole bottle pale.
 */
function drawLiquidGlow(ctx: CanvasRenderingContext2D, H: number, t: number, rot: number, drained: number, pop: number) {
  const s = surface(H, t, rot, drained, pop);
  ctx.save();
  bottlePath(ctx, H);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(-0.3 * H, s.top, 0.6 * H, s.bottom - s.top);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  ctx.translate(0, s.yS);
  ctx.rotate(s.tilt);
  let g = ctx.createLinearGradient(0, 0, 0, s.deep);
  g.addColorStop(0, "rgba(236,172,74,0.3)");
  g.addColorStop(0.35, "rgba(206,140,52,0.18)");
  g.addColorStop(1, "rgba(140,88,22,0.08)");
  ctx.fillStyle = g;
  ctx.fillRect(-s.fw, 0, s.fw * 2, s.deep + s.w);
  // the pool of light the surface itself throws, soft in every direction
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, s.w * 1.5);
  g.addColorStop(0, "rgba(255,222,150,0.42)");
  g.addColorStop(0.45, "rgba(248,196,104,0.16)");
  g.addColorStop(1, "rgba(220,160,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(-s.w * 1.6, -s.w * 1.6, s.w * 3.2, s.w * 3.2);
  for (const b of BUBBLES) {
    const q = (t * b.sp + b.off) % 1;
    const y = s.deep * (1 - q);
    const x = b.x * s.w * 0.62 + Math.sin(q * 7 + b.wob) * s.w * 0.07;
    ctx.globalAlpha = 0.75 * Math.min(1, q * 6) * (1 - q * 0.45);
    ctx.fillStyle = "#fff2d4";
    ctx.beginPath();
    ctx.arc(x, y, b.r * 0.013 * H, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // the near edge of the surface is the brightest line on the bottle, and it fades at the glass
  const edgeFade = (a: string) => {
    const lg = ctx.createLinearGradient(-s.w * 1.02, 0, s.w * 1.02, 0);
    lg.addColorStop(0, "rgba(255,240,200,0)");
    lg.addColorStop(0.22, a);
    lg.addColorStop(0.78, a);
    lg.addColorStop(1, "rgba(255,240,200,0)");
    return lg;
  };
  ctx.fillStyle = edgeFade("rgba(255,224,152,0.34)");
  ctx.beginPath();
  ctx.ellipse(0, 0, s.w * 1.12, s.w * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = edgeFade("rgba(255,244,210,0.5)");
  ctx.beginPath();
  ctx.ellipse(0, 0, s.w * 1.12, s.w * 0.2, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = edgeFade("rgba(255,252,240,0.62)");
  ctx.fillRect(-s.w * 1.12, -s.w * 0.028, s.w * 2.24, s.w * 0.056);
  ctx.restore();
}

// ---------- the label ----------

/** The shield: two dipping arcs meeting in a point, straight sides, a soft point below. */
function shieldPath(ctx: CanvasRenderingContext2D, W: number, Hh: number, y: number) {
  ctx.beginPath();
  ctx.moveTo(-W / 2, y);
  ctx.quadraticCurveTo(-W * 0.26, y + Hh * 0.13, 0, y + Hh * 0.025);
  ctx.quadraticCurveTo(W * 0.26, y + Hh * 0.13, W / 2, y);
  ctx.lineTo(W / 2, y + Hh * 0.56);
  ctx.bezierCurveTo(W / 2, y + Hh * 0.84, W * 0.16, y + Hh * 0.9, 0, y + Hh);
  ctx.bezierCurveTo(-W * 0.16, y + Hh * 0.9, -W / 2, y + Hh * 0.84, -W / 2, y + Hh * 0.56);
  ctx.closePath();
}

function starPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

/** Neon in passes: wide and faint, then narrow and bright, then a white-hot core. */
function glowPasses(ctx: CanvasRenderingContext2D, lit: number, base: number) {
  for (const [k, a] of [[7, 0.06], [3.5, 0.16], [1.6, 0.55]] as const) {
    ctx.strokeStyle = `rgba(${LABEL_RGB},${a * lit})`;
    ctx.lineWidth = base * k;
    ctx.stroke();
  }
  ctx.strokeStyle = `rgba(${LABEL_CORE},${0.85 * lit})`;
  ctx.lineWidth = base * 0.7;
  ctx.stroke();
}

interface Placed {
  c: Canvas2D;
  x: number;
  y: number;
  w: number;
  h: number;
}

function renderLabel(H: number, LW: number, LH: number, LY: number): Placed | null {
  const pad = 0.06 * H;
  const x = -LW / 2 - pad;
  const y = LY - pad;
  const w = LW + pad * 2;
  const h = LH + pad * 2;
  const c = offscreen(w, h);
  const ctx = c?.getContext("2d");
  if (!c || !ctx) return null;
  ctx.translate(-x, -y);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const base = Math.max(0.8, 0.006 * H);
  shieldPath(ctx, LW, LH, LY);
  glowPasses(ctx, 1, base);
  shieldPath(ctx, LW * 0.86, LH * 0.88, LY + LH * 0.07);
  glowPasses(ctx, 0.6, base * 0.6);
  for (let i = 0; i < 4; i += 1) {
    const yy = LY + LH * (0.58 + i * 0.07);
    const half = LW * (0.3 - i * 0.06);
    ctx.beginPath();
    ctx.moveTo(-half, yy);
    ctx.lineTo(0, yy + LH * 0.05);
    ctx.lineTo(half, yy);
    glowPasses(ctx, 0.6, base * 0.5);
  }
  const font = sceneFont();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const txt = (s: string, f: string, yy: number, a = 1, sp = 0) => {
    ctx.font = f;
    ctx.shadowColor = `rgba(${LABEL_RGB},1)`;
    ctx.shadowBlur = 0.03 * H;
    ctx.fillStyle = `rgba(${LABEL_CORE},${0.95 * a})`;
    if (sp) spaced(ctx, s, 0, yy, sp);
    else ctx.fillText(s, 0, yy);
  };
  txt("CUVÉE · MILLÉSIME", `700 ${0.0095 * H}px ${font}`, LY + LH * 0.19, 0.9, 0.0008 * H);
  txt("Champagne", `italic 500 ${0.015 * H}px ${font}`, LY + LH * 0.27, 0.8);
  txt("BetBeat", `italic 800 ${0.029 * H}px ${font}`, LY + LH * 0.385);
  txt("Vintage", `italic 500 ${0.016 * H}px ${font}`, LY + LH * 0.49, 0.8);
  ctx.shadowBlur = 0.04 * H;
  starPath(ctx, 0, LY + LH * 0.64, LW * 0.075);
  ctx.fillStyle = `rgba(${LABEL_CORE},0.95)`;
  ctx.fill();
  txt("Brut", `italic 600 ${0.013 * H}px ${font}`, LY + LH * 0.78, 0.8);
  return { c, x, y, w, h };
}

/** The flat label wrapped round the cylinder: columns near the edge are squeezed, as on real glass. */
function wrapLabel(flat: Placed, H: number): Placed | null {
  const bw = halfWidth(0.75) * H;
  const c = offscreen(flat.c.width, flat.c.height);
  const g = c?.getContext("2d");
  if (!c || !g) return null;
  for (let dx = 0; dx < flat.w; dx += 1) {
    const X = flat.x + dx + 0.5;
    if (Math.abs(X) >= bw * 0.995) continue;
    const nx = X / bw;
    const sx = bw * Math.asin(nx) - flat.x;
    if (sx < 0 || sx >= flat.w) continue;
    g.globalAlpha = 0.45 + 0.55 * Math.sqrt(1 - nx * nx);
    g.drawImage(flat.c, sx, 0, 1, flat.h, dx, 0, 1, flat.h);
  }
  return { c, x: flat.x, y: flat.y, w: flat.w, h: flat.h };
}

// ---------- the bank of shaded angles ----------

export interface BottleOptions {
  /** The bottle's height on screen, in canvas pixels. */
  height: number;
  /** The range of angles the scene will pass through, in radians. */
  from: number;
  to: number;
  /** When the cork leaves, in scene seconds. */
  pop: number;
  /** Shading runs at this height at most, then the result is scaled up. */
  cap?: number;
  /** Angles per radian: coarser on a slow phone. */
  step?: number;
}

export function createBottle(opts: BottleOptions): Bottle {
  const step = opts.step ?? 0.055;
  const cap = opts.cap ?? 520;
  const Hr = Math.min(opts.height, cap);
  const q0 = Math.floor(opts.from / step);
  const q1 = Math.ceil(opts.to / step);
  const shaded = new Map<number, Shaded>();
  let geom: Geometry | null = null;
  let next = q1; // the resting angle first: it is the one on screen longest
  let label: Placed | null | undefined;
  let scratch: Canvas2D | null = null;
  const halo = glowSprite(LABEL_RGB, 0.3);

  const shade = (q: number) => {
    if (shaded.has(q)) return;
    geom = geom ?? bottleGeometry(Hr);
    const s = renderBottle(geom, Hr, q * step);
    if (s) shaded.set(q, s);
  };

  /** The nearest angle already shaded, so a frame never waits for one. */
  const nearest = (q: number): Shaded | null => {
    const exact = shaded.get(q);
    if (exact) return exact;
    for (let d = 1; d <= q1 - q0 + 1; d += 1) {
      const a = shaded.get(q - d);
      if (a) return a;
      const b = shaded.get(q + d);
      if (b) return b;
    }
    shade(clamp(q, q0, q1));
    return shaded.get(clamp(q, q0, q1)) ?? null;
  };

  /** Two angles mixed on a scratch canvas, so each layer is composited exactly once. */
  const mix = (A: Shaded, B: Shaded, f: number, layer: "m" | "a"): Canvas2D | null => {
    if (!scratch || scratch.width < A.w || scratch.height < A.h) scratch = offscreen(A.w, A.h);
    const g = scratch?.getContext("2d");
    if (!scratch || !g) return null;
    g.clearRect(0, 0, scratch.width, scratch.height);
    g.drawImage(A[layer], 0, 0);
    g.globalAlpha = f;
    g.drawImage(B[layer], 0, 0);
    g.globalAlpha = 1;
    return scratch;
  };

  return {
    ready: () => next < q0,
    warm(max = 1) {
      for (let i = 0; i < max && next >= q0; i += 1) {
        shade(next);
        next -= 1;
      }
    },
    draw(ctx, H, state) {
      const bw = 0.15 * H;
      const LW = 0.23 * H;
      const LH = 0.3 * H;
      const LY = 0.64 * H;
      const lit = state.lit;
      // a soft halo of the label's light, behind and around the glass
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      sprite(ctx, halo, 0, LY + LH * 0.45, LH * 2.2, 0.22 * lit);
      ctx.restore();

      drawLiquid(ctx, H, state.t, state.rot, state.drained, opts.pop);

      const q = state.rot / step;
      const qf = Math.floor(q);
      const f = q - qf;
      const A = nearest(qf);
      if (A) {
        const B = f > 0.02 ? shaded.get(qf + 1) : undefined;
        const k = H / A.H;
        const put = (layer: "m" | "a", op: GlobalCompositeOperation) => {
          ctx.save();
          ctx.globalCompositeOperation = op;
          const blended = B ? mix(A, B, f, layer) : null;
          if (blended) ctx.drawImage(blended, 0, 0, A.w, A.h, A.x * k, A.y * k, A.w * k, A.h * k);
          else ctx.drawImage(A[layer], A.x * k, A.y * k, A.w * k, A.h * k);
          ctx.restore();
        };
        put("m", "multiply"); // what the glass lets through
        put("a", "lighter"); // what it reflects
      }

      drawLiquidGlow(ctx, H, state.t, state.rot, state.drained, opts.pop);

      // the label's light spilling inside the glass
      const g = ctx.createRadialGradient(0, LY + LH * 0.45, 0, 0, LY + LH * 0.45, LH);
      g.addColorStop(0, `rgba(${LABEL_RGB},${0.16 * lit})`);
      g.addColorStop(1, `rgba(${LABEL_RGB},0)`);
      ctx.save();
      bottlePath(ctx, H);
      ctx.clip();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = g;
      ctx.fillRect(-bw, LY + LH * 0.45 - LH, bw * 2, LH * 2);
      ctx.restore();

      // the glowing label, wrapped on the glass, drawn once and lit by alpha
      if (label === undefined) {
        const flat = renderLabel(H, LW, LH, LY);
        label = flat ? wrapLabel(flat, H) : null;
      }
      if (label) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = lit;
        ctx.drawImage(label.c, label.x, label.y, label.w, label.h);
        ctx.restore();
      }
    },
  };
}

/** How lit the label is: dim before the pop, then it switches on with a flicker and breathes. */
export function labelLight(t: number, pop: number): number {
  if (t < pop) return 0.12;
  const dt = t - pop;
  const flick = dt < 0.06 ? 1 : dt < 0.1 ? 0.25 : dt < 0.16 ? 1 : dt < 0.2 ? 0.5 : 1;
  return flick * (0.88 + 0.12 * Math.sin(t * 2.4));
}

/**
 * The cork, gone in a quarter of a second, with its own streak behind it.
 * `at(dt)` is where it is `dt` seconds after the pop, in canvas pixels.
 */
export function drawCork(
  ctx: CanvasRenderingContext2D,
  H: number,
  dt: number,
  at: (dt: number) => { x: number; y: number },
) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  for (let i = 5; i >= 0; i -= 1) {
    const gdt = dt - i * 0.012;
    if (gdt <= 0) continue;
    const c = at(gdt);
    const alpha = (1 - i / 6) * Math.min(1, (0.9 - dt) * 4);
    if (alpha <= 0) continue;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(-0.5 + gdt * 34);
    ctx.globalAlpha = alpha * (i ? 0.3 : 1);
    const cw = 0.072 * H;
    const ch = 0.058 * H;
    ctx.fillStyle = hgrad(ctx, -cw, cw, ["#3b2a17", "#c9a271", "#8a6a44", "#e4c89c", "#2e2112"]);
    roundRect(ctx, -cw, -ch, cw * 2, ch * 1.15, cw * 0.42);
    ctx.fill(); // the head
    ctx.fillStyle = hgrad(ctx, -cw * 0.6, cw * 0.6, ["#2a1d10", "#9d7c53", "#5f482c"]);
    roundRect(ctx, -cw * 0.6, ch * 0.1, cw * 1.2, ch * 1.0, cw * 0.18);
    ctx.fill(); // the shank
    ctx.strokeStyle = "rgba(255,240,214,0.75)";
    ctx.lineWidth = Math.max(1, 0.004 * H);
    roundRect(ctx, -cw, -ch, cw * 2, ch * 1.15, cw * 0.42);
    ctx.stroke(); // a rim of light, so it reads at speed
    ctx.restore();
  }
  ctx.restore();
}
