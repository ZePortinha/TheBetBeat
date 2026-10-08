/**
 * The winner's moment, flat and sharp (2026-10-08, replaces the three.js
 * stage that froze some phones). Plain Canvas 2D, no dependencies, and a
 * PURE function of time: `drawWinFrame(t)` paints the same frame for the
 * same `t`, so the live screen and the Instagram video are one animation.
 *
 *   0.00  white flash + a ring from the centre; the mirror ball spins
 *   0.10  coloured stage lights start to sweep and strobe (≤ 2 flashes/s)
 *   0.20  confetti cannons fire from both bottom corners
 *   0.15  two champagne bottles slide in; 0.70 the corks pop and the
 *         champagne sprays in gold streaks
 *   1.20  confetti keeps raining from above; light spots from the ball
 *         drift across the room
 *
 * Particles are seeded once (`createWinScene`) and placed analytically
 * (ballistics with drag), so nothing accumulates frame to frame. Canvas
 * colours are literal by necessity; they mirror the tokens (accent red
 * #e8112d, amber #ff9f0a) plus the multi-colour stage lights.
 */

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
  /** Album art, drawn in the middle (the video). The live screen shows it in HTML. */
  cover?: CanvasImageSource | null;
  /** Everything drawn in the canvas, text included (the video). */
  text?: WinText | null;
  /** Fewer particles (small or slow phones). */
  lite?: boolean;
}

export interface WinScene {
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void;
}

const ACCENT = "#e8112d";
const AMBER = "#ff9f0a";
const LIGHTS = ["#ff2d95", "#32d4ff", "#ffb020", "#e8112d", "#9b5cff", "#2bff88"];
const CONFETTI = ["#e8112d", "#ffffff", "#ff9f0a", "#ff2d95", "#32d4ff", "#ffd60a", "#9b5cff"];
const G = 1.35; // gravity, in scene heights per s²

/** Small seeded PRNG: the same scene every time (the video matches the screen). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (k: number) => Math.min(1, Math.max(0, k));
const easeOut = (k: number) => 1 - Math.pow(1 - clamp01(k), 3);
/** Critically-damped-ish spring with a touch of overshoot for the pop-ins. */
const springIn = (k: number) => {
  const x = clamp01(k);
  return 1 - Math.exp(-6 * x) * Math.cos(9 * x);
};

interface Flake {
  start: number; // s
  x0: number; // fraction of width
  y0: number; // fraction of height
  vx: number; // widths / s
  vy: number; // heights / s (down +)
  drag: number;
  size: number; // fraction of width
  ratio: number;
  color: string;
  spin: number;
  phase: number;
  sway: number;
  life: number;
  period: number; // > 0: rains again every `period` s
}

interface Drop {
  start: number;
  side: -1 | 1;
  speed: number;
  spread: number;
  size: number;
  life: number;
}

interface Spot {
  x: number;
  y: number;
  r: number;
  color: string;
  speed: number;
  phase: number;
}

/** Where the mirror ball hangs, for this canvas size. */
export function ballGeometry(w: number, h: number) {
  const r = Math.min(w * 0.12, h * 0.06);
  const top = h * 0.03;
  return { cx: w / 2, cy: top + h * 0.035 + r, r, top };
}

export function createWinScene(opts: WinSceneOptions = {}): WinScene {
  const rnd = mulberry32(20261008);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rnd() * list.length)] as T;
  const lite = opts.lite ?? false;

  // Confetti cannons (bottom corners) + the rain that follows.
  const flakes: Flake[] = [];
  const cannon = lite ? 90 : 150;
  for (let i = 0; i < cannon; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const angle = (-Math.PI / 2) + side * (0.28 + rnd() * 0.42); // up and inwards
    const speed = 1.7 + rnd() * 1.1;
    flakes.push({
      start: 0.2 + rnd() * 0.18,
      x0: side < 0 ? -0.02 : 1.02,
      y0: 0.98,
      vx: Math.cos(angle) * speed * 0.62,
      vy: Math.sin(angle) * speed,
      drag: 1.3 + rnd() * 0.9,
      size: 0.02 + rnd() * 0.014,
      ratio: 0.45 + rnd() * 0.35,
      color: pick(CONFETTI),
      spin: 5 + rnd() * 9,
      phase: rnd() * Math.PI * 2,
      sway: 0.01 + rnd() * 0.02,
      life: 5,
      period: 0,
    });
  }
  const rain = lite ? 50 : 80;
  for (let i = 0; i < rain; i += 1) {
    flakes.push({
      start: 1.2 + rnd() * 4.5,
      x0: rnd(),
      y0: -0.04,
      vx: (rnd() - 0.5) * 0.05,
      vy: 0.05,
      drag: 2.6,
      size: 0.018 + rnd() * 0.012,
      ratio: 0.45 + rnd() * 0.35,
      color: pick(CONFETTI),
      spin: 4 + rnd() * 7,
      phase: rnd() * Math.PI * 2,
      sway: 0.015 + rnd() * 0.025,
      life: 4.6,
      period: 4.5,
    });
  }

  // Champagne: gold streaks out of each bottle once the cork pops.
  const drops: Drop[] = [];
  const perBottle = lite ? 70 : 120;
  for (let i = 0; i < perBottle * 2; i += 1) {
    const k = rnd();
    drops.push({
      start: 0.72 + Math.pow(k, 1.8) * 1.6, // most of it right at the pop
      side: i % 2 === 0 ? -1 : 1,
      speed: 0.9 + rnd() * 0.75,
      spread: (rnd() - 0.5) * 0.42,
      size: 0.6 + rnd() * 1.1,
      life: 0.9 + rnd() * 0.6,
    });
  }

  // Light spots thrown around the room by the mirror ball.
  const spots: Spot[] = [];
  for (let i = 0; i < (lite ? 14 : 22); i += 1) {
    spots.push({
      x: rnd(),
      y: 0.12 + rnd() * 0.82,
      r: 0.003 + rnd() * 0.004,
      color: pick(LIGHTS),
      speed: 0.035 + rnd() * 0.05,
      phase: rnd() * Math.PI * 2,
    });
  }

  // Facet brightness of the mirror ball, fixed per tile.
  const facet: number[] = [];
  for (let i = 0; i < 512; i += 1) facet.push(rnd());

  function bottle(side: -1 | 1, w: number, h: number, t: number) {
    // Bottom corners, tilted up towards the centre.
    const slide = easeOut((t - 0.15) / 0.45);
    const kick = t > 0.7 ? Math.exp(-(t - 0.7) * 9) * 0.08 : 0; // recoil at the pop
    const angle = -side * (0.55 + kick);
    const bx = side < 0 ? w * (0.02 - 0.3 * (1 - slide)) : w * (0.98 + 0.3 * (1 - slide));
    const by = h * 0.9;
    const u = w * 0.045; // bottle unit
    return { bx, by, angle, u, slide };
  }

  /** Mouth of the bottle in canvas pixels, and the spray direction. */
  function mouth(side: -1 | 1, w: number, h: number) {
    const { bx, by, angle, u } = bottle(side, w, h, 2);
    const len = u * 7.2;
    return {
      x: bx + Math.sin(angle) * len,
      y: by - Math.cos(angle) * len,
      dir: -Math.PI / 2 + angle,
    };
  }

  function drawBottle(ctx: CanvasRenderingContext2D, side: -1 | 1, w: number, h: number, t: number) {
    const { bx, by, angle, u, slide } = bottle(side, w, h, t);
    if (slide <= 0) return;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(angle);
    // Body: deep green glass with a hard highlight (flat, two tones).
    const body = ctx.createLinearGradient(-u, 0, u, 0);
    body.addColorStop(0, "#06231a");
    body.addColorStop(0.35, "#0f4a35");
    body.addColorStop(0.55, "#0a3526");
    body.addColorStop(1, "#041a12");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-u, u * 1.2);
    ctx.lineTo(-u, -u * 2.4);
    ctx.quadraticCurveTo(-u, -u * 3.6, -u * 0.36, -u * 4.6);
    ctx.lineTo(-u * 0.36, -u * 7.0);
    ctx.lineTo(u * 0.36, -u * 7.0);
    ctx.lineTo(u * 0.36, -u * 4.6);
    ctx.quadraticCurveTo(u, -u * 3.6, u, -u * 2.4);
    ctx.lineTo(u, u * 1.2);
    ctx.closePath();
    ctx.fill();
    // Highlight stripe.
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(-u * 0.62, -u * 2.2, u * 0.16, u * 3.2);
    // Label.
    ctx.fillStyle = "#f3ead2";
    ctx.fillRect(-u, -u * 1.5, u * 2, u * 1.5);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(-u, -u * 1.08, u * 2, u * 0.32);
    // Gold foil on the neck.
    const foil = ctx.createLinearGradient(-u * 0.4, 0, u * 0.4, 0);
    foil.addColorStop(0, "#8a6a1c");
    foil.addColorStop(0.5, "#ffe08a");
    foil.addColorStop(1, "#8a6a1c");
    ctx.fillStyle = foil;
    ctx.fillRect(-u * 0.4, -u * 7.0, u * 0.8, u * 1.9);
    // The cork: on the bottle until the pop, then it flies.
    if (t < 0.7) {
      ctx.fillStyle = "#c79a5b";
      ctx.fillRect(-u * 0.3, -u * 7.7, u * 0.6, u * 0.7);
    }
    ctx.restore();

    if (t >= 0.7) {
      const k = t - 0.7;
      if (k < 1.6) {
        const m = mouth(side, w, h);
        const v = h * 1.6;
        const cx = m.x + Math.cos(m.dir) * v * k * 0.55;
        const cy = m.y + Math.sin(m.dir) * v * k + 0.5 * G * h * k * k;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(k * 14 * side);
        ctx.fillStyle = "#c79a5b";
        ctx.fillRect(-u * 0.3, -u * 0.35, u * 0.6, u * 0.7);
        ctx.restore();
      }
      // Foam puff at the pop.
      const puff = 1 - clamp01(k / 0.45);
      if (puff > 0) {
        const m = mouth(side, w, h);
        ctx.fillStyle = `rgba(255,250,235,${0.32 * puff})`;
        for (let i = 0; i < 4; i += 1) {
          const d = u * (0.6 + i * 0.7) * (1 + k * 3);
          ctx.beginPath();
          ctx.arc(m.x + Math.cos(m.dir) * d, m.y + Math.sin(m.dir) * d, u * (0.3 + i * 0.15) * (1 + k * 1.5), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function drawSpray(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    if (t < 0.72) return;
    const m = [mouth(-1, w, h), mouth(1, w, h)];
    ctx.lineCap = "round";
    for (const d of drops) {
      const k = t - d.start;
      if (k < 0 || k > d.life) continue;
      const origin = m[d.side < 0 ? 0 : 1]!;
      const dir = origin.dir + d.spread;
      const vx = Math.cos(dir) * d.speed * h * 0.62;
      const vy = Math.sin(dir) * d.speed * h;
      const x = origin.x + vx * k;
      const y = origin.y + vy * k + 0.5 * G * h * k * k;
      // Streak along the current velocity: speed reads as light.
      const cvx = vx;
      const cvy = vy + G * h * k;
      const len = 0.022;
      const alpha = 1 - k / d.life;
      ctx.strokeStyle = `rgba(255,214,120,${0.85 * alpha})`;
      ctx.lineWidth = d.size * (w / 400) * 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - cvx * len, y - cvy * len);
      ctx.stroke();
    }
  }

  function drawBeams(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    const on = easeOut((t - 0.1) / 0.5);
    if (on <= 0) return;
    const n = 5;
    for (let i = 0; i < n; i += 1) {
      const x = w * (0.08 + (0.84 * i) / (n - 1));
      const sway = Math.sin(t * (0.9 + i * 0.17) + i * 1.7) * 0.42 + (i - (n - 1) / 2) * -0.1;
      const angle = Math.PI / 2 + sway;
      // Strobe: each beam blinks on its own beat, never faster than 2/s.
      const beat = Math.sin(t * Math.PI * 2 * (0.8 + (i % 3) * 0.3) + i);
      const strobe = 0.35 + 0.65 * clamp01(beat * 1.6);
      const color = LIGHTS[(i + Math.floor(t / 1.5)) % LIGHTS.length]!;
      const len = h * 1.15;
      const half = 0.12;
      ctx.save();
      ctx.translate(x, -h * 0.02);
      ctx.rotate(angle - Math.PI / 2);
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, hexA(color, 0.5 * strobe * on));
      g.addColorStop(0.6, hexA(color, 0.12 * strobe * on));
      g.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-w * 0.008, 0);
      ctx.lineTo(w * 0.008, 0);
      ctx.lineTo(Math.tan(half) * len, len);
      ctx.lineTo(-Math.tan(half) * len, len);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawSpots(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    const on = easeOut((t - 0.2) / 0.8);
    if (on <= 0) return;
    for (const s of spots) {
      const x = (((s.x + t * s.speed) % 1) + 1) % 1;
      const tw = 0.5 + 0.5 * Math.sin(t * 3 + s.phase);
      ctx.fillStyle = hexA(s.color, 0.55 * tw * on);
      ctx.beginPath();
      ctx.arc(x * w, s.y * h, s.r * w * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBall(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    const { cx, cy, r, top } = ballGeometry(w, h);
    // The wire it hangs from.
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = Math.max(1, w / 400);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, cy - r);
    ctx.stroke();
    void top;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#1c1c1e";
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    const rows = 12;
    const cols = 24;
    const rot = t * 0.9;
    for (let i = 0; i < rows; i += 1) {
      const lat0 = -Math.PI / 2 + (Math.PI * i) / rows;
      const lat1 = lat0 + Math.PI / rows;
      const y0 = cy + r * Math.sin(lat0);
      const y1 = cy + r * Math.sin(lat1);
      const half = r * Math.cos((lat0 + lat1) / 2);
      for (let j = 0; j < cols; j += 1) {
        const lon0 = (Math.PI * 2 * j) / cols + rot;
        const lon1 = lon0 + (Math.PI * 2) / cols;
        const s0 = Math.sin(lon0);
        const s1 = Math.sin(lon1);
        const front = Math.cos((lon0 + lon1) / 2);
        if (front <= 0) continue;
        const xa = cx + half * Math.min(s0, s1);
        const xb = cx + half * Math.max(s0, s1);
        const base = facet[(i * cols + j) % facet.length]!;
        // Light from the top left, plus a twinkle as facets turn past it.
        const lit = 0.25 + 0.45 * front * (1 - (i / rows) * 0.6) + 0.3 * base;
        const glint = Math.pow(Math.max(0, Math.sin(t * 4 + base * 40)), 24);
        const v = Math.min(255, Math.round(255 * Math.min(1, lit + glint)));
        ctx.fillStyle = glint > 0.4 ? LIGHTS[(i + j) % LIGHTS.length]! : `rgb(${v},${v},${Math.min(255, v + 12)})`;
        ctx.fillRect(xa + 0.6, y0 + 0.6, Math.max(0, xb - xa - 1.2), Math.max(0, y1 - y0 - 1.2));
      }
    }
    // Shade the far side so it reads round.
    const shade = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.05);
    shade.addColorStop(0, "rgba(255,255,255,0.18)");
    shade.addColorStop(0.6, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = shade;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();

    // Four-point glints on the rim.
    for (let i = 0; i < 3; i += 1) {
      const k = (Math.sin(t * 2.6 + i * 2.1) + 1) / 2;
      if (k < 0.55) continue;
      const a = -2.2 + i * 1.1;
      star(ctx, cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82, r * 0.45 * (k - 0.55) * 2.2, "#ffffff");
    }
  }

  function drawConfetti(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    for (const f of flakes) {
      let k = t - f.start;
      if (k < 0) continue;
      if (f.period > 0) k %= f.period;
      if (k > f.life) continue;
      // Linear drag towards a slow terminal fall, with a flutter.
      const e = (1 - Math.exp(-f.drag * k)) / f.drag;
      const terminal = G / f.drag;
      const x = (f.x0 + f.vx * e + Math.sin(k * 3 + f.phase) * f.sway * clamp01(k)) * w;
      const y = (f.y0 + terminal * k + (f.vy - terminal) * e) * h;
      if (y > h + 20 || x < -20 || x > w + 20) continue;
      const flip = Math.cos(k * f.spin + f.phase);
      const sw = f.size * w;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(k * f.spin * 0.35 + f.phase);
      ctx.scale(1, Math.max(0.12, Math.abs(flip)));
      ctx.fillStyle = flip < 0 ? shadeOf(f.color) : f.color;
      ctx.fillRect(-sw / 2, (-sw * f.ratio) / 2, sw, sw * f.ratio);
      ctx.restore();
    }
  }

  function drawCover(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    const size = w * 0.56;
    const cx = w / 2;
    const cy = h * 0.405;
    const k = springIn((t - 0.08) / 0.6);
    if (k <= 0) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(k, k);
    ctx.shadowColor = hexA(ACCENT, 0.7);
    ctx.shadowBlur = w * 0.08;
    roundRect(ctx, -size / 2, -size / 2, size, size, w * 0.035);
    ctx.fillStyle = "#1c1c1e";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.save();
    ctx.clip();
    if (opts.cover) {
      ctx.drawImage(opts.cover, -size / 2, -size / 2, size, size);
    } else {
      // No art: a vinyl in the brand red.
      ctx.fillStyle = "#0b0b0c";
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.rotate(t * 2.2);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1.2;
      for (let g = 0.2; g < 0.46; g += 0.025) {
        ctx.beginPath();
        ctx.arc(0, 0, size * g, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.17, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0b0b0c";
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.02, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = Math.max(2, w * 0.006);
    roundRect(ctx, -size / 2, -size / 2, size, size, w * 0.035);
    ctx.stroke();
    ctx.restore();
  }

  function drawText(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, text: WinText) {
    const font = typeof document !== "undefined" ? getComputedStyle(document.body).fontFamily : "sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = w * 0.025;
    const appear = (at: number, dur = 0.35) => easeOut((t - at) / dur);

    // Brand line at the top.
    ctx.globalAlpha = appear(0.2);
    ctx.font = `600 ${w * 0.034}px ${font}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text.brand, w / 2, h * 0.04 + w * 0.034);

    // Eyebrow.
    ctx.globalAlpha = appear(0.35);
    ctx.font = `700 ${w * 0.034}px ${font}`;
    ctx.fillStyle = AMBER;
    ctx.fillText(text.eyebrow.toUpperCase(), w / 2, h * 0.64);

    // Title, letter by letter, sliding up.
    ctx.font = `800 ${w * 0.13}px ${font}`;
    const chars = [...text.title];
    const widths = chars.map((c) => ctx.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = w / 2 - total / 2;
    ctx.textAlign = "left";
    chars.forEach((c, i) => {
      const k = easeOut((t - 0.45 - i * 0.05) / 0.4);
      ctx.globalAlpha = k;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(c, x, h * 0.715 + (1 - k) * h * 0.03);
      x += widths[i]!;
    });
    ctx.textAlign = "center";

    // Amount.
    const ka = springIn((t - 0.8) / 0.5);
    ctx.globalAlpha = clamp01(ka);
    ctx.font = `800 ${w * 0.1}px ${font}`;
    ctx.fillStyle = ACCENT;
    ctx.save();
    ctx.translate(w / 2, h * 0.79);
    ctx.scale(0.7 + 0.3 * ka, 0.7 + 0.3 * ka);
    ctx.fillText(text.amount, 0, 0);
    ctx.restore();

    // Track.
    ctx.globalAlpha = appear(1.1);
    ctx.font = `700 ${w * 0.05}px ${font}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(fit(ctx, text.trackTitle, w * 0.86), w / 2, h * 0.845);
    ctx.font = `500 ${w * 0.04}px ${font}`;
    ctx.fillStyle = "rgba(235,235,245,0.75)";
    ctx.fillText(fit(ctx, text.trackArtist, w * 0.86), w / 2, h * 0.88);

    // Footer.
    ctx.globalAlpha = appear(1.4);
    ctx.font = `500 ${w * 0.03}px ${font}`;
    ctx.fillStyle = "rgba(235,235,245,0.6)";
    ctx.fillText(text.footer, w / 2, h * 0.955);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  return {
    draw(ctx, w, h, t) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      // The room: black with a red pool of light that breathes with the beat.
      ctx.fillStyle = "#050505";
      ctx.fillRect(0, 0, w, h);
      const pulse = 0.85 + 0.15 * Math.sin(t * Math.PI * 2 * 0.5);
      const pool = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.62);
      pool.addColorStop(0, hexA(ACCENT, 0.42 * pulse));
      pool.addColorStop(0.45, hexA(ACCENT, 0.1 * pulse));
      pool.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = pool;
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = "lighter";
      drawBeams(ctx, w, h, t);
      drawSpots(ctx, w, h, t);
      ctx.globalCompositeOperation = "source-over";

      drawBall(ctx, w, h, t);
      if (opts.text) drawCover(ctx, w, h, t);

      // Shockwave ring from the centre at the start.
      const ring = clamp01(t / 0.7);
      if (ring < 1) {
        ctx.strokeStyle = `rgba(255,214,120,${0.8 * (1 - ring)})`;
        ctx.lineWidth = w * 0.012 * (1 - ring) + 1;
        ctx.beginPath();
        ctx.arc(w / 2, h * 0.405, easeOut(ring) * Math.max(w, h) * 0.6, 0, Math.PI * 2);
        ctx.stroke();
      }

      drawBottle(ctx, -1, w, h, t);
      drawBottle(ctx, 1, w, h, t);
      ctx.globalCompositeOperation = "lighter";
      drawSpray(ctx, w, h, t);
      ctx.globalCompositeOperation = "source-over";
      drawConfetti(ctx, w, h, t);

      if (opts.text) drawText(ctx, w, h, t, opts.text);

      // The opening flash.
      const flash = 1 - clamp01(t / 0.28);
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${0.7 * flash * flash})`;
        ctx.fillRect(0, 0, w, h);
      }
    },
  };
}

function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/** The back of a confetti piece: the same colour, darker. */
function shadeOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const d = (v: number) => Math.round(v * 0.62);
  return `rgb(${d((n >> 16) & 255)},${d((n >> 8) & 255)},${d(n & 255)})`;
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  if (s <= 0) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x, y, x + s, y);
  ctx.quadraticCurveTo(x, y, x, y + s);
  ctx.quadraticCurveTo(x, y, x - s, y);
  ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Ellipsis when a title is wider than the line. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/**
 * Runs the scene full screen on a canvas until `stop()`. DPR is capped at
 * 2 and frames are skipped when the phone falls behind; reduced motion
 * paints one still frame.
 */
export function startWinScene(canvas: HTMLCanvasElement, opts: WinSceneOptions & { still?: boolean }): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const lowEnd = (navigator.hardwareConcurrency ?? 8) <= 4;
  const scene = createWinScene({ ...opts, lite: opts.lite ?? lowEnd });
  let raf = 0;
  let w = 0;
  let h = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  if (opts.still) {
    scene.draw(ctx, w, h, 2.6);
    return () => {};
  }
  const start = performance.now();
  const frame = (now: number) => {
    scene.draw(ctx, w, h, (now - start) / 1000);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  window.addEventListener("resize", resize);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
  };
}
