/**
 * The winner's moment (three.js, loaded only when someone wins). One
 * timeline, filmed like a product shot:
 *   0.00  flash + gold shockwave, the camera starts a slow dolly-in
 *   0.05  the vinyl (their album art as the label) drops in on a spring,
 *         spinning; a fixed specular wedge sells the grooves
 *   0.30  confetti cannons fire from both bottom corners (paper + gold
 *         foil that flutters, catches the light, drifts on air drag)
 *   0.50  two champagne bottles rise; 0.95 the corks pop (mist puff,
 *         camera kick) and the wine sprays as glinting droplets
 *   1.60  confetti rains from above; sparkles twinkle round the record
 * Bloom post-processing makes the light read as light. Returns cleanup.
 */

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const GRAVITY = -9.8 * 0.55;
// High enough that the words below never touch the record on a phone.
const RECORD_Y = 1.7;
const PAPER = 220;
const FOIL = 90;
const DROPS = 900;
const MIST = 40;
const SPARKS = 70;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const easeOut = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!];
}

function texture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A soft round dot: droplets, mist, sparkles. */
function dotTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return texture(c, false);
}

/** Deep red pool fading to black: the room. */
function backdropTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512);
  const g = ctx.createRadialGradient(256, 210, 0, 256, 256, 330);
  g.addColorStop(0, "#4a0812");
  g.addColorStop(0.45, "#1a0306");
  g.addColorStop(1, "#000000");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  return texture(c);
}

/** Gold god-rays, soft-edged (light through haze, not a sunburst), fading out from the centre. */
function raysTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024);
  ctx.translate(512, 512);
  ctx.filter = "blur(10px)";
  for (let i = 0; i < 22; i += 1) {
    ctx.rotate((Math.PI * 2) / 22 + rand(-0.08, 0.08));
    const w = rand(0.02, 0.07);
    const g = ctx.createLinearGradient(0, 0, 512, 0);
    g.addColorStop(0, "rgba(255,214,120,0.5)");
    g.addColorStop(0.55, "rgba(255,214,120,0.12)");
    g.addColorStop(1, "rgba(255,214,120,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(512, -512 * w);
    ctx.lineTo(512, 512 * w);
    ctx.closePath();
    ctx.fill();
  }
  return texture(c);
}

/** Grooves (with track gaps) + the label: album art when it loads, red until then. */
function recordTexture(coverUrl: string | null): THREE.CanvasTexture {
  const size = 1024;
  const [c, ctx] = canvas(size);
  const m = size / 2;
  ctx.fillStyle = "#070708";
  ctx.fillRect(0, 0, size, size);
  const gaps = [0.52, 0.63, 0.74, 0.86];
  for (let r = 0.37; r < 0.985; r += 0.0035) {
    const gap = gaps.some((g) => Math.abs(r - g) < 0.006);
    const v = () => Math.round(18 + Math.random() * 10);
    ctx.strokeStyle = gap ? "#030303" : `rgb(${v()},${v()},${v() + 2})`;
    ctx.lineWidth = gap ? 4 : 1.2;
    ctx.beginPath();
    ctx.arc(m, m, r * m, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = "#1c1c1f";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(m, m, m * 0.99, 0, Math.PI * 2);
  ctx.stroke();
  const t = texture(c);
  t.anisotropy = 8;
  const label = (draw: () => void) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(m, m, m * 0.345, 0, Math.PI * 2);
    ctx.clip();
    draw();
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(m, m, m * 0.345, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#050505";
    ctx.beginPath();
    ctx.arc(m, m, m * 0.025, 0, Math.PI * 2);
    ctx.fill();
    t.needsUpdate = true;
  };
  label(() => {
    const g = ctx.createRadialGradient(m, m, 0, m, m, m * 0.35);
    g.addColorStop(0, "#ff3b4e");
    g.addColorStop(1, "#b50e24");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
  if (coverUrl) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => label(() => ctx.drawImage(img, m - m * 0.345, m - m * 0.345, m * 0.69, m * 0.69));
    img.src = coverUrl;
  }
  return t;
}

/** The two opposite wedges of light every vinyl shows: they stay put while it spins. */
function sheenTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512);
  ctx.translate(256, 256);
  for (const base of [0, Math.PI]) {
    const g = ctx.createConicGradient(base - 0.5, 0, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.04, "rgba(255,255,255,0.55)");
    g.addColorStop(0.08, "rgba(255,255,255,0.08)");
    g.addColorStop(0.16, "rgba(255,255,255,0)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 252, 0, Math.PI * 2);
    ctx.arc(0, 0, 92, 0, Math.PI * 2, true);
    ctx.fill();
  }
  return texture(c, false);
}

/** Cream label with the house name, gold rules. */
function bottleLabelTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512);
  ctx.fillStyle = "#f3ead2";
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = "#c9a227";
  ctx.fillRect(0, 40, 512, 10);
  ctx.fillRect(0, 462, 512, 10);
  ctx.fillStyle = "#b50e24";
  ctx.font = "bold 92px Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("BETBEAT", 256, 230);
  ctx.fillStyle = "#3a2a10";
  ctx.font = "600 40px Helvetica, Arial, sans-serif";
  ctx.fillText("BRUT · CUVÉE DA NOITE", 256, 320);
  return texture(c);
}

/** Crinkled foil: noise as a bump map. */
function crinkleTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256);
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + Math.random() * 120;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.filter = "blur(1.2px)";
  ctx.drawImage(c, 0, 0);
  return texture(c, false);
}

function makeBottle(labelTex: THREE.Texture, crinkle: THREE.Texture) {
  const group = new THREE.Group();
  const curve = new THREE.SplineCurve(
    [
      [0.0, -1.25], [0.3, -1.25], [0.345, -1.18], [0.35, -0.9], [0.35, 0.2], [0.33, 0.42],
      [0.24, 0.62], [0.16, 0.82], [0.135, 1.0], [0.13, 1.17], [0.145, 1.22], [0.0, 1.24],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
  );
  const glass = new THREE.Mesh(
    new THREE.LatheGeometry(curve.getPoints(60), 64),
    new THREE.MeshPhysicalMaterial({
      color: 0x0a2c17,
      roughness: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMapIntensity: 2.2,
    }),
  );
  const foil = new THREE.Mesh(
    new THREE.CylinderGeometry(0.148, 0.215, 0.66, 48, 8, true),
    new THREE.MeshStandardMaterial({
      color: 0xd8b04a,
      metalness: 1,
      roughness: 0.32,
      bumpMap: crinkle,
      bumpScale: 2.5,
      envMapIntensity: 2,
      side: THREE.DoubleSide,
    }),
  );
  foil.position.y = 0.9;
  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(0.353, 0.353, 0.62, 64, 1, true, -Math.PI * 0.55, Math.PI * 1.1),
    new THREE.MeshStandardMaterial({ map: labelTex, color: 0xb9b2a4, roughness: 0.6 }),
  );
  label.position.y = -0.4;
  label.rotation.y = Math.PI / 2;
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.245, 0.27, 0.1, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 1, roughness: 0.25, envMapIntensity: 2, side: THREE.DoubleSide }),
  );
  collar.position.y = 0.56;
  // Mushroom cork.
  const cork = new THREE.Group();
  const corkMat = new THREE.MeshStandardMaterial({ color: 0xbf9a62, roughness: 0.85 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.125, 0.16, 24), corkMat);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), corkMat);
  cap.position.y = 0.08;
  cork.add(stem, cap);
  cork.position.y = 1.3;
  const neck = new THREE.Object3D();
  neck.position.y = 1.26;
  group.add(glass, foil, label, collar, cork, neck);
  return { group, cork, neck };
}

interface Flake {
  p: THREE.Vector3;
  v: THREE.Vector3;
  q: THREE.Quaternion;
  axis: THREE.Vector3;
  spin: number;
  sway: number;
  phase: number;
  size: number;
  alive: boolean;
}

function flakes(n: number): Flake[] {
  return Array.from({ length: n }, () => ({
    p: new THREE.Vector3(0, -99, 0),
    v: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    axis: new THREE.Vector3(rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)).normalize(),
    spin: rand(7, 15),
    sway: rand(0.4, 1.1),
    phase: rand(0, 6.28),
    size: rand(0.7, 1.3),
    alive: false,
  }));
}

/** Points that live, move under gravity and fade (additive: light, not paint). */
class Spray {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private next = 0;

  constructor(
    private readonly n: number,
    size: number,
    private readonly tint: THREE.Color,
    map: THREE.Texture,
    private readonly drag: number,
    private readonly gravity: number,
  ) {
    this.pos = new Float32Array(n * 3).fill(-99);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size,
        map,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    this.points.frustumCulled = false;
  }

  emit(at: THREE.Vector3, vel: THREE.Vector3, life: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([at.x, at.y, at.z], i * 3);
    this.vel.set([vel.x, vel.y, vel.z], i * 3);
    this.life[i] = life;
    this.max[i] = life;
  }

  update(dt: number, twinkle = 0, t = 0) {
    const d = 1 - Math.min(0.95, this.drag * dt);
    for (let i = 0; i < this.n; i += 1) {
      const o = i * 3;
      const life = this.life[i]!;
      if (life <= 0) {
        this.col[o] = this.col[o + 1] = this.col[o + 2] = 0;
        continue;
      }
      this.life[i] = life - dt;
      const k = Math.max(0, (life - dt) / this.max[i]!);
      this.vel[o + 1] = this.vel[o + 1]! + this.gravity * dt;
      this.vel[o] = this.vel[o]! * d;
      this.vel[o + 1] = this.vel[o + 1]! * d;
      this.vel[o + 2] = this.vel[o + 2]! * d;
      this.pos[o] = this.pos[o]! + this.vel[o]! * dt;
      this.pos[o + 1] = this.pos[o + 1]! + this.vel[o + 1]! * dt;
      this.pos[o + 2] = this.pos[o + 2]! + this.vel[o + 2]! * dt;
      const glint = twinkle ? 0.35 + 0.65 * Math.abs(Math.sin(t * twinkle + i * 1.7)) : 1;
      const a = Math.min(1, k * 1.6) * glint;
      this.col[o] = this.tint.r * a;
      this.col[o + 1] = this.tint.g * a;
      this.col[o + 2] = this.tint.b * a;
    }
    this.points.geometry.attributes.position!.needsUpdate = true;
    this.points.geometry.attributes.color!.needsUpdate = true;
  }
}

export function startWinScene(container: HTMLElement, opts: { coverUrl: string | null }): () => void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  } catch {
    return () => undefined; // No WebGL: the words still celebrate.
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  container.appendChild(renderer.domElement);

  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const pmrem = keep(new THREE.PMREMGenerator(renderer));
  const env = keep(pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
  scene.environment = env;
  scene.environmentIntensity = 0.5;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  let baseZ = 9;

  // Lights: warm key, red rim, a gold light circling the record.
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.4);
  key.position.set(3, 5, 6);
  const rim = new THREE.PointLight(0xe8112d, 40, 25);
  rim.position.set(-3.5, -1, 2.5);
  const orbit = new THREE.PointLight(0xffd36a, 30, 18);
  scene.add(key, rim, orbit);

  // The room: red pool + slow gold rays.
  const dot = keep(dotTexture());
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshBasicMaterial({ map: keep(backdropTexture()), toneMapped: false }),
  );
  backdrop.position.z = -8;
  const rays = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 26),
    new THREE.MeshBasicMaterial({
      map: keep(raysTexture()),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  rays.position.set(0, RECORD_Y, -6);
  scene.add(backdrop, rays);

  // The record.
  const tilt = new THREE.Group();
  tilt.position.y = RECORD_Y;
  const vinylSide = new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.06 });
  const record = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.045, 160), [
    vinylSide,
    // A touch under white: the art keeps its colours and never blooms.
    new THREE.MeshBasicMaterial({ map: keep(recordTexture(opts.coverUrl)), color: 0xc8c8c8 }),
    vinylSide,
  ]);
  const sheen = new THREE.Mesh(
    new THREE.CircleGeometry(1.01, 96),
    new THREE.MeshBasicMaterial({
      map: keep(sheenTexture()),
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  sheen.rotation.x = -Math.PI / 2;
  sheen.position.y = 0.024;
  tilt.add(record, sheen);
  tilt.scale.setScalar(0.001);
  scene.add(tilt);

  // Flash + shockwave.
  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: dot, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  flash.position.set(0, RECORD_Y, 1);
  const wave = new THREE.Mesh(
    new THREE.RingGeometry(0.96, 1, 128),
    new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  wave.position.set(0, RECORD_Y, 0.2);
  scene.add(flash, wave);

  // Champagne.
  const labelTex = keep(bottleLabelTexture());
  const crinkle = keep(crinkleTexture());
  const bottles = [-1, 1].map((side) => {
    const b = makeBottle(labelTex, crinkle);
    b.group.scale.setScalar(0.5);
    b.group.rotation.z = -side * 0.3;
    b.group.rotation.y = side * 0.5;
    scene.add(b.group);
    return { ...b, side, corkV: new THREE.Vector3(), corkW: rand(10, 16), popped: false };
  });

  // Wine spray, mist and sparkles.
  const drops = new Spray(DROPS, 0.075, new THREE.Color(1, 0.93, 0.72), dot, 0.6, GRAVITY);
  const mist = new Spray(MIST, 0.9, new THREE.Color(0.55, 0.5, 0.42), dot, 2.2, 0.3);
  const sparks = new Spray(SPARKS, 0.13, new THREE.Color(1, 0.86, 0.45), dot, 0, 0);
  scene.add(drops.points, mist.points, sparks.points);

  // Confetti: matte paper and gold foil, lit (so a flip reads as a flash of light).
  const flakeGeo = new THREE.PlaneGeometry(0.085, 0.15);
  const paper = new THREE.InstancedMesh(flakeGeo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.65 }), PAPER);
  const foil = new THREE.InstancedMesh(
    flakeGeo,
    new THREE.MeshStandardMaterial({ color: 0xe9c25a, metalness: 1, roughness: 0.22, envMapIntensity: 2.5, side: THREE.DoubleSide }),
    FOIL,
  );
  const paperColors = [0xe8112d, 0xffffff, 0xf3ead2, 0xff453a, 0xffd60a, 0x8a0b1c];
  const color = new THREE.Color();
  for (let i = 0; i < PAPER; i += 1) paper.setColorAt(i, color.setHex(paperColors[i % paperColors.length]!));
  // Instances start hidden: a bounds check made then would cull them for good.
  paper.frustumCulled = false;
  foil.frustumCulled = false;
  scene.add(paper, foil);
  const paperFlakes = flakes(PAPER);
  const foilFlakes = flakes(FOIL);

  const zAxis = new THREE.Vector3(0, 0, 1);
  function cannon(list: Flake[], count: number, from: THREE.Vector3, dir: THREE.Vector3, speed: number) {
    let n = 0;
    for (const f of list) {
      if (f.alive || n >= count) continue;
      n += 1;
      f.alive = true;
      f.p.copy(from).add(new THREE.Vector3(rand(-0.1, 0.1), rand(-0.1, 0.1), rand(-0.1, 0.1)));
      f.v.copy(dir).applyAxisAngle(zAxis, rand(-0.32, 0.32)).multiplyScalar(speed * rand(0.55, 1.1));
      f.v.z += rand(-1.2, 2.2);
      f.q.setFromEuler(new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)));
    }
  }

  function rain(list: Flake[], count: number, halfWidth: number) {
    let n = 0;
    for (const f of list) {
      if (f.alive || n >= count) continue;
      n += 1;
      f.alive = true;
      f.p.set(rand(-halfWidth, halfWidth), rand(4.2, 7.5), rand(-1.5, 2));
      f.v.set(rand(-0.3, 0.3), rand(-0.6, 0), 0);
    }
  }

  const dummy = new THREE.Object3D();
  const spinQ = new THREE.Quaternion();
  function stepFlakes(mesh: THREE.InstancedMesh, list: Flake[], dt: number, t: number) {
    // Paper falls at a walking pace: strong air drag, a sideways sway.
    const drag = 1 - Math.min(0.95, 2.4 * dt);
    list.forEach((f, i) => {
      if (f.alive) {
        f.v.y += GRAVITY * dt;
        f.v.multiplyScalar(drag);
        f.p.addScaledVector(f.v, dt);
        f.p.x += Math.sin(t * 2.2 + f.phase) * f.sway * dt;
        f.q.multiply(spinQ.setFromAxisAngle(f.axis, f.spin * dt));
        if (f.p.y < -6) f.alive = false;
      }
      dummy.position.copy(f.p);
      dummy.quaternion.copy(f.q);
      dummy.scale.setScalar(f.alive ? f.size : 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  // Post: bloom makes gold, sparks and the flash glow like real light.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.45, 0.88);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let halfWidth = 2;
  let halfHeight = 3;
  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    camera.aspect = w / h;
    // Keep the stage in frame on tall phones.
    baseZ = w / h < 0.6 ? 11.5 : 9;
    camera.updateProjectionMatrix();
    halfHeight = Math.tan(THREE.MathUtils.degToRad(17.5)) * baseZ;
    halfWidth = halfHeight * camera.aspect;
    // Bottles flank the record like trophies (the words own the lower half).
    for (const b of bottles) b.group.position.setX(b.side * Math.min(1.7, halfWidth - 0.32));
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const start = performance.now();
  let last = start;
  let raf = 0;
  const fired = { cannons: false, rain: false, rain2: false };
  let shake = 0;
  const up = new THREE.Vector3(0, 1, 0);
  const worldQ = new THREE.Quaternion();

  const tick = (now: number) => {
    const t = (now - start) / 1000;
    const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
    last = now;
    const bottom = -halfHeight + 0.2;

    // Camera: slow dolly-in, a kick when the corks pop.
    shake *= Math.exp(-6 * dt);
    camera.position.set(Math.sin(t * 43) * shake * 0.06, 0.15 + Math.cos(t * 37) * shake * 0.06, baseZ + 1.4 * (1 - easeOut(t / 2.2)));
    camera.lookAt(0, 0.35, 0);

    // Room.
    (rays.material as THREE.MeshBasicMaterial).opacity = 0.075 * easeOut(t / 1.2);
    rays.rotation.z = t * 0.06;

    // Record: drops in on a spring, spins fast then settles, gentle wobble.
    const k = Math.min(1, t / 1.0);
    tilt.scale.setScalar(Math.max(0.001, 1 - Math.exp(-5.5 * k) * Math.cos(10 * k)));
    tilt.position.y = RECORD_Y + (1 - easeOut(t / 0.7)) * 2.2;
    tilt.rotation.x = 1.12 + Math.sin(t * 1.1) * 0.05;
    tilt.rotation.z = Math.sin(t * 0.8) * 0.07;
    record.rotation.y -= dt * (3.5 + 14 * Math.exp(-2.2 * t));
    orbit.position.set(Math.cos(t * 1.4) * 3, RECORD_Y + 1.5 + Math.sin(t * 1.9) * 0.5, 2.8);

    // Flash + shockwave.
    const fk = t / 0.45;
    flash.scale.setScalar(2 + fk * 9);
    flash.material.opacity = Math.max(0, 1 - fk) * 1.6;
    const wt = (t - 0.12) / 1.0;
    wave.scale.setScalar(0.4 + easeOut(wt) * 5);
    (wave.material as THREE.MeshBasicMaterial).opacity = wt > 0 && wt < 1 ? 0.9 * (1 - wt) : 0;

    // Confetti.
    if (!fired.cannons && t > 0.3) {
      fired.cannons = true;
      for (const side of [-1, 1]) {
        const from = new THREE.Vector3(side * halfWidth * 0.95, bottom, 1.2);
        const dir = new THREE.Vector3(-side * 0.32, 1, 0).normalize();
        cannon(paperFlakes, 85, from, dir, 13);
        cannon(foilFlakes, 32, from, dir, 13);
      }
    }
    if (!fired.rain && t > 1.6) {
      fired.rain = true;
      rain(paperFlakes, 45, halfWidth + 0.5);
      rain(foilFlakes, 22, halfWidth + 0.5);
    }
    if (!fired.rain2 && t > 3.4) {
      fired.rain2 = true;
      rain(paperFlakes, 40, halfWidth + 0.5);
      rain(foilFlakes, 20, halfWidth + 0.5);
    }
    stepFlakes(paper, paperFlakes, dt, t);
    stepFlakes(foil, foilFlakes, dt, t);

    // Champagne: rise, tremble, pop, spray.
    for (const b of bottles) {
      b.group.position.y = bottom - 1.5 + easeOut((t - 0.5) / 0.6) * (RECORD_Y - 0.5 - bottom + 1.5);
      b.group.rotation.x = t > 0.75 && t < 0.95 ? Math.sin(t * 90) * 0.012 : 0;
      const mouth = b.neck.getWorldPosition(new THREE.Vector3());
      const dir = up.clone().applyQuaternion(b.group.getWorldQuaternion(worldQ));
      if (!b.popped && t > 0.95) {
        b.popped = true;
        shake = 1;
        b.cork.removeFromParent();
        b.cork.position.copy(mouth);
        b.cork.scale.setScalar(0.5);
        scene.add(b.cork);
        b.corkV.copy(dir).multiplyScalar(11).add(new THREE.Vector3(0, 0, 2));
        for (let i = 0; i < 14; i += 1) {
          const v = dir.clone().multiplyScalar(rand(0.6, 1.6)).add(new THREE.Vector3(rand(-0.5, 0.5), rand(-0.2, 0.5), rand(-0.3, 0.3)));
          mist.emit(mouth, v, rand(0.6, 1.1));
        }
      }
      if (b.popped) {
        b.corkV.y += GRAVITY * dt;
        b.cork.position.addScaledVector(b.corkV, dt);
        b.cork.rotation.x += dt * b.corkW;
        b.cork.rotation.z += dt * b.corkW * 0.6;
        const since = t - 0.95;
        if (since < 2.2) {
          // A gush that tapers off: most of the wine in the first half second.
          const rate = since < 0.5 ? 26 : since < 1.2 ? 12 : 5;
          for (let i = 0; i < rate; i += 1) {
            const spread = new THREE.Vector3(rand(-0.55, 0.55), rand(-0.15, 0.4), rand(-0.45, 0.7));
            drops.emit(mouth, dir.clone().multiplyScalar(rand(4.5, 8.5)).add(spread), rand(0.8, 1.5));
          }
        }
      }
    }
    drops.update(dt);
    mist.update(dt);

    // Sparkles round the record once it has landed.
    if (t > 0.8 && Math.random() < 0.8) {
      const a = rand(0, Math.PI * 2);
      const r = rand(1.2, 2.1);
      sparks.emit(
        new THREE.Vector3(Math.cos(a) * r, RECORD_Y + Math.sin(a) * r * 0.75, rand(0, 1)),
        new THREE.Vector3(0, rand(0.05, 0.3), 0),
        rand(0.6, 1.4),
      );
    }
    sparks.update(dt, 9, t);

    composer.render();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Sprite) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
    for (const d of disposables) d.dispose();
    composer.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
