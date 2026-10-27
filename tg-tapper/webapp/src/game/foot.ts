// Foot geometry: a procedural placeholder (SDF + marching cubes) or a real 3D scan (.glb).
//
// Conventions (both cases): metres, foot length along +Y (heel ≈ 0 → toes ≈ 0.25),
// width along X (big toe at -X), sole facing +Z (toward the default camera).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { edgeTable as edgeTableT, triTable as triTableT } from 'three/examples/jsm/objects/MarchingCubes.js';

// @types/three declares these as Int32Array[], but at runtime they are flat Int32Arrays.
const edgeTable = edgeTableT as unknown as Int32Array;
const triTable = triTableT as unknown as Int32Array;
import type { ModelDef } from '@shared/game.ts';

export interface FootAsset {
  geometry: THREE.BufferGeometry;
  map: THREE.Texture;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
  /** Nails and other static meshes attached to the foot. */
  extras: THREE.Object3D[];
  /** Toe joints (base → tip) so toes can curl and spread. Empty for scans. */
  toes: { a: THREE.Vector3; b: THREE.Vector3; r: number }[];
  /** Ankle pivot for whole-foot flinches. */
  ankle: THREE.Vector3;
  length: number;
  /** World metres → UV units (for brush sizes). */
  uvPerMeter: number;
  landmarks: { heel: THREE.Vector3; arch: THREE.Vector3; ball: THREE.Vector3; toes: THREE.Vector3; center: THREE.Vector3 };
}

// ---------------------------------------------------------------------------
// SDF helpers

type V3 = [number, number, number];

function sdEllipsoid(px: number, py: number, pz: number, c: V3, r: V3) {
  const x = px - c[0];
  const y = py - c[1];
  const z = pz - c[2];
  // Math.hypot is slow in V8; this runs ~10M times while building the mesh.
  const ax = x / r[0];
  const ay = y / r[1];
  const az = z / r[2];
  const bx = ax / r[0];
  const by = ay / r[1];
  const bz = az / r[2];
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  return (k0 * (k0 - 1)) / k1;
}

function sdCapsule(px: number, py: number, pz: number, a: V3, b: V3, r: number) {
  const pax = px - a[0];
  const pay = py - a[1];
  const paz = pz - a[2];
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  const dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function smax(a: number, b: number, k: number) {
  return -smin(-a, -b, k);
}

// Toes: base → tip, radius. Big toe at -X. Measured on the reference sole photo
// (24 cm foot): short, round toes that sit close together.
const TOES: { a: V3; b: V3; r: number }[] = [
  { a: [-0.018, 0.196, -0.024], b: [-0.0175, 0.224, -0.02], r: 0.0128 },
  { a: [0.003, 0.195, -0.024], b: [0.0045, 0.219, -0.021], r: 0.0086 },
  { a: [0.02, 0.19, -0.024], b: [0.025, 0.212, -0.021], r: 0.0081 },
  { a: [0.034, 0.181, -0.025], b: [0.039, 0.198, -0.022], r: 0.0076 },
  { a: [0.046, 0.169, -0.026], b: [0.0525, 0.181, -0.023], r: 0.007 },
];

function footSdf(x: number, y: number, z: number) {
  // Heel: wide, round calcaneus plus a domed fat pad bulging toward the sole.
  let d = sdEllipsoid(x, y, z, [0.01, 0.045, -0.034], [0.037, 0.043, 0.036]);
  d = smin(d, sdEllipsoid(x, y, z, [0.01, 0.043, -0.014], [0.033, 0.036, 0.02]), 0.02);
  d = smin(d, sdEllipsoid(x, y, z, [0.014, 0.105, -0.04], [0.04, 0.07, 0.033]), 0.03); // midfoot
  // Lateral column: keeps the outer edge almost straight from heel to ball.
  d = smin(d, sdCapsule(x, y, z, [0.038, 0.055, -0.03], [0.047, 0.16, -0.028], 0.014), 0.03);
  d = smin(d, sdEllipsoid(x, y, z, [0.01, 0.166, -0.032], [0.052, 0.033, 0.027]), 0.03); // wide ball
  d = smin(d, sdEllipsoid(x, y, z, [0.008, 0.11, -0.062], [0.034, 0.08, 0.034]), 0.03); // dorsum
  d = smin(d, sdCapsule(x, y, z, [0.005, 0.06, -0.075], [0.005, 0.07, -0.2], 0.034), 0.03); // ankle → leg
  // medial arch: hollow on the inner sole
  d = smax(d, -sdEllipsoid(x, y, z, [-0.036, 0.1, 0.004], [0.024, 0.052, 0.022]), 0.02);
  d = smin(d, toesSdf(x, y, z), 0.009);
  // cut the leg off behind the foot
  return Math.max(d, -(z + 0.16));
}

// ---------------------------------------------------------------------------
// Foot shaped from a traced sole outline (foot space, metres): the outline is
// extruded between a domed sole surface and the instep, with rounded edges.

function outline2D(points: [number, number][]) {
  const X0 = -0.07;
  const Y0 = -0.03;
  const C = 0.001;
  const NX = 170;
  const NY = 290;
  const grid = new Float32Array(NX * NY);
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const px = X0 + i * C;
      const py = Y0 + j * C;
      let best = Infinity;
      let inside = false;
      for (let k = 0, l = points.length - 1; k < points.length; l = k++) {
        const [ax, ay] = points[l];
        const [bx, by] = points[k];
        const vx = bx - ax;
        const vy = by - ay;
        const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
        const dx = ax + vx * t - px;
        const dy = ay + vy * t - py;
        best = Math.min(best, dx * dx + dy * dy);
        if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
      }
      grid[j * NX + i] = inside ? -Math.sqrt(best) : Math.sqrt(best);
    }
  return (x: number, y: number) => {
    const fx = (x - X0) / C;
    const fy = (y - Y0) / C;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= NX - 1 || j >= NY - 1) return 0.05;
    const tx = fx - i;
    const ty = fy - j;
    const a = grid[j * NX + i] * (1 - tx) + grid[j * NX + i + 1] * tx;
    const b = grid[(j + 1) * NX + i] * (1 - tx) + grid[(j + 1) * NX + i + 1] * tx;
    return a * (1 - ty) + b * ty;
  };
}

const gauss = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));
const smooth01 = (v: number, a: number, b: number) => THREE.MathUtils.smoothstep(v, a, b);

function toesSdf(x: number, y: number, z: number) {
  let toes = Infinity;
  for (const t of TOES) {
    toes = Math.min(toes, sdCapsule(x, y, z, t.a, t.b, t.r));
    // plump toe pad on the sole side
    toes = smin(toes, sdEllipsoid(x, y, z, [t.b[0], t.b[1] - t.r * 0.6, t.b[2] + t.r * 0.25], [t.r * 1.05, t.r * 1.1, t.r * 0.9]), 0.004);
  }
  return toes;
}

function makeOutlineSdf(points: [number, number][]) {
  const d2 = outline2D(points);
  return (x: number, y: number, z: number) => {
    const inner = d2(x, y);
    // Sole surface (+Z): convex from the edges inward, domed heel pad and ball, recessed medial arch.
    const zs =
      -0.004 +
      0.008 * smooth01(-inner, 0, 0.022) +
      0.009 * gauss(x, y, 0.012, 0.035, 0.03, 0.03) +
      0.005 * gauss(x, y, 0.015, 0.165, 0.04, 0.022) -
      0.018 * gauss(x, y, -0.03, 0.1, 0.018, 0.05) -
      0.005 * gauss(x, y, 0.012, 0.1, 0.04, 0.05);
    // Instep (−Z): heel → high midfoot → thin forefoot, lower on the outer side.
    const zb = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-0.058, -0.075, smooth01(y, 0.03, 0.12)), -0.044, smooth01(y, 0.12, 0.2)) + 0.012 * smooth01(x, 0.02, 0.06);
    const h = (zs - zb) / 2;
    const zc = (zs + zb) / 2;
    const R = Math.min(h * 0.95, 0.026);
    const wx = inner + R;
    const wy = Math.abs(z - zc) - h + R;
    let d = Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) - R;
    d = smin(d, sdCapsule(x, y, z, [0.008, 0.05, -0.07], [0.008, 0.06, -0.2], 0.036), 0.03); // ankle → leg
    d = smin(d, toesSdf(x, y, z), 0.009);
    return Math.max(d, -(z + 0.16));
  };
}

// ---------------------------------------------------------------------------
// Marching cubes with shared vertices

function polygonize(f: (x: number, y: number, z: number) => number, min: V3, max: V3, step: number) {
  const nx = Math.ceil((max[0] - min[0]) / step) + 1;
  const ny = Math.ceil((max[1] - min[1]) / step) + 1;
  const nz = Math.ceil((max[2] - min[2]) / step) + 1;
  const val = new Float32Array(nx * ny * nz);
  const idx = (i: number, j: number, k: number) => i + j * nx + k * nx * ny;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) val[idx(i, j, k)] = f(min[0] + i * step, min[1] + j * step, min[2] + k * step);

  const pos: number[] = [];
  const index: number[] = [];
  const cache = new Map<number, number>();
  // corner offsets in three.js / Bourke order
  const C = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const E = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const vert = (i: number, j: number, k: number, e: number) => {
    const [ca, cb] = E[e];
    const a = C[ca];
    const b = C[cb];
    const ia = idx(i + a[0], j + a[1], k + a[2]);
    const ib = idx(i + b[0], j + b[1], k + b[2]);
    const key = ia < ib ? ia * 4_000_000 + ib : ib * 4_000_000 + ia;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const va = val[ia];
    const vb = val[ib];
    const t = va / (va - vb);
    const n = pos.length / 3;
    pos.push(min[0] + (i + a[0] + (b[0] - a[0]) * t) * step, min[1] + (j + a[1] + (b[1] - a[1]) * t) * step, min[2] + (k + a[2] + (b[2] - a[2]) * t) * step);
    cache.set(key, n);
    return n;
  };
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let ci = 0;
        for (let c = 0; c < 8; c++) {
          cv[c] = val[idx(i + C[c][0], j + C[c][1], k + C[c][2])];
          if (cv[c] < 0) ci |= 1 << c;
        }
        if (!edgeTable[ci]) continue;
        const o = ci << 4;
        for (let t = 0; triTable[o + t] !== -1; t += 3) index.push(vert(i, j, k, triTable[o + t]), vert(i, j, k, triTable[o + t + 1]), vert(i, j, k, triTable[o + t + 2]));
      }
  return { pos, index };
}

// ---------------------------------------------------------------------------
// 4K skin textures (albedo, normal, roughness), painted in planar sole UV space

const TEX = 4096;

/** Tileable value-noise tile, used as a pattern at several scales. */
function noiseTile(size: number, cell: number, seed = Math.random()) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(size, size);
  const n = Math.ceil(size / cell);
  const grid = Array.from({ length: n * n }, (_, i) => Math.abs(Math.sin((i + 1) * 12.9898 * (seed + 1)) * 43758.5453) % 1);
  const at = (x: number, y: number) => grid[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const gx = x / cell;
      const gy = y / cell;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const fx = gx - ix;
      const fy = gy - iy;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const v = (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
      const o = (y * size + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v * 255;
      img.data[o + 3] = 255;
    }
  c.putImageData(img, 0, 0);
  return cv;
}

/** Tile of skin pores: small dark pits with a faint raised rim. */
function poreTile(size: number, count: number) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#808080';
  c.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.8 + Math.random() * 1.6;
    for (const [ox, oy] of [[0, 0], [size, 0], [0, size], [-size, 0], [0, -size]]) {
      const g = c.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r * 2);
      g.addColorStop(0, 'rgba(0,0,0,0.55)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.15)');
      g.addColorStop(0.75, 'rgba(255,255,255,0.12)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(x + ox - r * 2, y + oy - r * 2, r * 4, r * 4);
    }
  }
  return cv;
}

function overlayPattern(c: CanvasRenderingContext2D, tile: HTMLCanvasElement, scale: number, alpha: number, op: GlobalCompositeOperation) {
  const pat = c.createPattern(tile, 'repeat')!;
  pat.setTransform(new DOMMatrix().scale(scale).rotate(Math.random() * 360));
  c.save();
  c.globalAlpha = alpha;
  c.globalCompositeOperation = op;
  c.fillStyle = pat;
  c.fillRect(0, 0, TEX, TEX);
  c.restore();
}

async function skinTextures(tone: THREE.Color, uvOf: (x: number, y: number) => [number, number], renderer: THREE.WebGLRenderer, sole?: ModelDef['sole']) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX;
  const c = cv.getContext('2d')!;
  c.fillStyle = `#${tone.getHexString()}`;
  c.fillRect(0, 0, TEX, TEX);

  // Natural mottling at three scales, plus warm/cool variation.
  overlayPattern(c, noiseTile(512, 64), 4, 0.1, 'multiply');
  overlayPattern(c, noiseTile(512, 24), 2, 0.07, 'soft-light');
  overlayPattern(c, noiseTile(512, 8), 1, 0.05, 'soft-light');

  const px = TEX / 0.26;
  const blob = (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rgba: string) => {
    const [u, v] = uvOf(x, y);
    ctx.save();
    ctx.translate(u * TEX, (1 - v) * TEX);
    ctx.scale(rx * px, ry * px);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, rgba);
    g.addColorStop(1, rgba.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  // Pressure areas are pinker/redder: heel, ball, toe pads, outer edge.
  blob(c, 0, 0.032, 0.036, 0.042, 'rgba(232,105,100,0.34)');
  blob(c, 0, 0.17, 0.052, 0.03, 'rgba(232,105,100,0.3)');
  blob(c, 0.035, 0.1, 0.012, 0.06, 'rgba(225,120,105,0.18)');
  for (const t of TOES) blob(c, t.b[0], t.b[1] - t.r * 0.5, t.r * 1.25, t.r * 1.25, 'rgba(236,108,108,0.38)');
  // Arch is paler and slightly yellower; callus-like heel rim.
  blob(c, -0.03, 0.105, 0.022, 0.05, 'rgba(250,228,205,0.35)');
  blob(c, 0, 0.012, 0.03, 0.014, 'rgba(240,215,175,0.3)');

  // Height map: pores, fine lines, creases.
  const hc = document.createElement('canvas');
  hc.width = hc.height = TEX;
  const h = hc.getContext('2d')!;
  h.fillStyle = '#808080';
  h.fillRect(0, 0, TEX, TEX);
  overlayPattern(h, poreTile(512, 900), 1, 1, 'source-over');
  overlayPattern(h, noiseTile(512, 6), 1, 0.25, 'overlay');
  overlayPattern(h, noiseTile(512, 40), 2, 0.2, 'overlay');

  // Creases are drawn sharp on separate layers and blurred once at the end
  // (a per-stroke canvas blur at 4K would take minutes).
  const ch = document.createElement('canvas');
  ch.width = ch.height = TEX;
  const chx = ch.getContext('2d')!;
  const cc = document.createElement('canvas');
  cc.width = cc.height = TEX;
  const ccx = cc.getContext('2d')!;
  for (const ctx of [chx, ccx]) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }
  const crease = (pts: [number, number][], w: number, depth: number, tint: number) => {
    for (const ctx of [chx, ccx]) {
      ctx.strokeStyle = ctx === chx ? `rgba(0,0,0,${depth})` : `rgba(120,55,45,${tint})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      pts.forEach(([x, y], i) => {
        const [u, v] = uvOf(x, y);
        if (i) ctx.lineTo(u * TEX, (1 - v) * TEX);
        else ctx.moveTo(u * TEX, (1 - v) * TEX);
      });
      ctx.stroke();
    }
  };
  const wobbly = (x0: number, y0: number, x1: number, y1: number, n = 8, amp = 0.0012): [number, number][] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      return [x0 + (x1 - x0) * t + (Math.random() - 0.5) * amp, y0 + (y1 - y0) * t + (Math.random() - 0.5) * amp];
    });
  // Fine skin lines across the whole sole (dermatoglyphic texture).
  for (let i = 0; i < 700; i++) {
    const x = -0.05 + Math.random() * 0.1;
    const y = 0.01 + Math.random() * 0.2;
    const a = Math.random() * Math.PI;
    const l = 0.002 + Math.random() * 0.006;
    crease(wobbly(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 3, 0.0004), 2 + Math.random() * 2, 0.18, 0);
  }
  // Long arch creases (the classic sole wrinkles when the foot is relaxed).
  for (let i = 0; i < 34; i++) {
    const x = -0.038 + Math.random() * 0.065;
    const y = 0.07 + Math.random() * 0.075;
    crease(wobbly(x, y, x + (Math.random() - 0.5) * 0.02, y + 0.015 + Math.random() * 0.03), 5 + Math.random() * 6, 0.45, 0.04);
  }
  // Transverse crease below the ball and at each toe base.
  crease(wobbly(-0.048, 0.151, 0.052, 0.156, 14, 0.0015), 11, 0.6, 0.18);
  crease(wobbly(-0.044, 0.147, 0.04, 0.149, 14, 0.0015), 6, 0.35, 0.1);
  for (const t of TOES) {
    crease(wobbly(t.a[0] - t.r * 1.1, t.a[1] + 0.002, t.a[0] + t.r * 1.1, t.a[1] + 0.003, 6, 0.0006), 9, 0.65, 0.2);
    crease(wobbly(t.a[0] - t.r * 0.9, t.a[1] + 0.0065, t.a[0] + t.r * 0.9, t.a[1] + 0.007, 6, 0.0005), 5, 0.4, 0.12);
    // fingerprint-like whorls on toe pads
    for (let k = 0; k < 6; k++) {
      const rr = t.r * (0.25 + k * 0.12);
      const cx = t.b[0];
      const cy = t.b[1] - t.r * 0.45;
      crease(Array.from({ length: 13 }, (_, i) => { const a = Math.PI * (0.15 + (i / 12) * 0.7); return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9] as [number, number]; }), 2.5, 0.25, 0.04);
    }
  }
  // Heel: concentric ridges.
  for (let k = 0; k < 9; k++) {
    const rr = 0.006 + k * 0.0035;
    crease(Array.from({ length: 17 }, (_, i) => { const a = Math.PI * (1.15 + (i / 16) * 0.7); return [Math.cos(a) * rr * 1.1, 0.034 + Math.sin(a) * rr] as [number, number]; }), 3, 0.22, 0.04);
  }

  h.filter = 'blur(2px)';
  h.drawImage(ch, 0, 0);
  h.filter = 'none';
  c.filter = 'blur(3px)';
  c.drawImage(cc, 0, 0);
  c.filter = 'none';

  // Real skin from a photographed sole (already warped into this UV space, alpha-feathered).
  if (sole) {
    const load = (src: string) =>
      new Promise<HTMLImageElement>((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = src;
      });
    const [hImg, aImg] = await Promise.all([load(sole.height), sole.albedo ? load(sole.albedo) : Promise.resolve(null)]);
    // Photo relief replaces the painted creases where it exists.
    h.globalAlpha = 0.9;
    h.drawImage(hImg, 0, 0, TEX, TEX);
    h.globalAlpha = 1;
    if (aImg) c.drawImage(aImg, 0, 0, TEX, TEX);
  }

  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();

  // Roughness: creases & pores slightly rougher; pads a bit smoother.
  const rc = document.createElement('canvas');
  rc.width = rc.height = 2048;
  const r = rc.getContext('2d')!;
  r.fillStyle = 'rgb(150,150,150)';
  r.fillRect(0, 0, 2048, 2048);
  r.globalAlpha = 0.35;
  r.drawImage(hc, 0, 0, 2048, 2048);
  const roughnessMap = new THREE.CanvasTexture(rc);

  return { map, normalMap: gpuNormalMap(renderer, hc, 3.2), roughnessMap };
}

/** Height map → tangent-space normal map, computed on the GPU at full resolution. */
function gpuNormalMap(renderer: THREE.WebGLRenderer, height: HTMLCanvasElement, strength: number) {
  const src = new THREE.CanvasTexture(height);
  src.wrapS = src.wrapT = THREE.RepeatWrapping;
  const size = height.width;
  const rt = new THREE.WebGLRenderTarget(size, size, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, depthBuffer: false });
  const mat = new THREE.ShaderMaterial({
    uniforms: { h: { value: src }, texel: { value: 1 / size }, strength: { value: strength } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D h; uniform float texel; uniform float strength; varying vec2 vUv;
      float H(vec2 o){ return texture2D(h, vUv + o * texel).r; }
      void main(){
        float dx = (H(vec2(1.,0.)) - H(vec2(-1.,0.))) * 0.5 + (H(vec2(2.,0.)) - H(vec2(-2.,0.))) * 0.25;
        float dy = (H(vec2(0.,1.)) - H(vec2(0.,-1.))) * 0.5 + (H(vec2(0.,2.)) - H(vec2(0.,-2.))) * 0.25;
        vec3 n = normalize(vec3(-dx * strength, -dy * strength, 1.0));
        gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const scene = new THREE.Scene();
  scene.add(quad);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, new THREE.Camera());
  renderer.setRenderTarget(prev);
  src.dispose();
  mat.dispose();
  quad.geometry.dispose();
  rt.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return rt.texture;
}

// ---------------------------------------------------------------------------

const LANDMARKS = {
  heel: new THREE.Vector3(0.012, 0.03, 0.005),
  arch: new THREE.Vector3(0.015, 0.1, -0.005),
  ball: new THREE.Vector3(0.015, 0.165, 0),
  toes: new THREE.Vector3(0.017, 0.205, -0.012),
  center: new THREE.Vector3(0.015, 0.11, 0),
};

export async function proceduralFoot(def: ModelDef, renderer: THREE.WebGLRenderer): Promise<FootAsset> {
  let sdf = footSdf;
  if (def.sole?.outline) {
    const res = await fetch(def.sole.outline);
    sdf = makeOutlineSdf((await res.json()).points);
  }
  const { pos, index } = polygonize(sdf, [-0.065, -0.02, -0.17], [0.095, 0.25, 0.022], 0.0017);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);

  // Smooth normals from the SDF gradient; fix winding to match them.
  const n = new Float32Array(pos.length);
  const e = 0.0005;
  for (let i = 0; i < pos.length; i += 3) {
    const [x, y, z] = [pos[i], pos[i + 1], pos[i + 2]];
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z);
    const gy = sdf(x, y + e, z) - sdf(x, y - e, z);
    const gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    n[i] = gx / l;
    n[i + 1] = gy / l;
    n[i + 2] = gz / l;
  }
  {
    const [a, b, c] = [index[0] * 3, index[1] * 3, index[2] * 3];
    const ab = new THREE.Vector3(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
    const ac = new THREE.Vector3(pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]);
    const fn = ab.cross(ac);
    if (fn.dot(new THREE.Vector3(n[a], n[a + 1], n[a + 2])) < 0) {
      const idx = g.index!.array as Uint32Array;
      for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    }
  }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));

  // Planar UV seen from the sole; paint is masked to sole-facing surfaces.
  const S = 0.26;
  const uvOf = (x: number, y: number): [number, number] => [(x + 0.13) / S, (y + 0.01) / S];
  const uv = new Float32Array((pos.length / 3) * 2);
  const mask = new Float32Array(pos.length / 3);
  for (let i = 0, v = 0; i < pos.length; i += 3, v++) {
    [uv[v * 2], uv[v * 2 + 1]] = uvOf(pos[i], pos[i + 1]);
    mask[v] = THREE.MathUtils.smoothstep(n[i + 2], 0.05, 0.45);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('paintMask', new THREE.BufferAttribute(mask, 1));

  const tone = new THREE.Color(def.skin);
  const { map, normalMap, roughnessMap } = await skinTextures(tone, uvOf, renderer, def.sole);

  // Toenails on the top side of each toe.
  const nailMat = new THREE.MeshPhysicalMaterial({
    color: tone.clone().lerp(new THREE.Color('#ffd9d2'), 0.6),
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    sheen: 0.3,
    sheenColor: new THREE.Color('#ffffff'),
  });
  const extras: THREE.Object3D[] = TOES.map((t) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), nailMat);
    m.scale.set(t.r * 0.75, t.r * 0.85, t.r * 0.22);
    m.position.set(t.b[0], t.b[1] - t.r * 0.15, t.b[2] - t.r * 0.92);
    return m;
  });

  return {
    geometry: g,
    map,
    normalMap,
    roughnessMap,
    extras,
    toes: TOES.map((t) => ({ a: new THREE.Vector3(...t.a), b: new THREE.Vector3(...t.b), r: t.r })),
    ankle: new THREE.Vector3(0.005, 0.065, -0.08),
    length: 0.24,
    uvPerMeter: 1 / S,
    landmarks: LANDMARKS,
  };
}

/**
 * Loads a scanned foot (e.g. from RealityScan). Expected in models/<id>/foot.glb.
 * The scan is re-centred and scaled to 25 cm; set `scanRotation` in the model config
 * so that toes point +Y and the sole faces +Z.
 */
export async function loadScan(url: string, rotation: [number, number, number] = [0, 0, 0]): Promise<FootAsset> {
  const gltf = await new GLTFLoader().loadAsync(url);
  let mesh: THREE.Mesh | null = null;
  gltf.scene.traverse((o) => {
    if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
  });
  if (!mesh) throw new Error('No mesh in scan');
  const m = mesh as THREE.Mesh;
  const g = m.geometry.clone();
  g.applyMatrix4(m.matrixWorld);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  const s = 0.25 / size.y;
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -bb.max.z);
  g.scale(s, s, s);
  if (!g.attributes.normal) g.computeVertexNormals();
  const count = g.attributes.position.count;
  g.setAttribute('paintMask', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));

  // Estimate texel density: UV area / world area.
  let uvA = 0;
  let wA = 0;
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  const idx = g.index;
  const tri = (k: number) => (idx ? idx.getX(k) : k);
  const triCount = (idx ? idx.count : count) / 3;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < triCount; t += 7) {
    const [i0, i1, i2] = [tri(t * 3), tri(t * 3 + 1), tri(t * 3 + 2)];
    a.fromBufferAttribute(p, i0);
    b.fromBufferAttribute(p, i1);
    c.fromBufferAttribute(p, i2);
    wA += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
    uvA += Math.abs((uv.getX(i1) - uv.getX(i0)) * (uv.getY(i2) - uv.getY(i0)) - (uv.getX(i2) - uv.getX(i0)) * (uv.getY(i1) - uv.getY(i0))) / 2;
  }
  const srcMat = m.material as THREE.MeshStandardMaterial;
  return {
    geometry: g,
    map: srcMat.map ?? new THREE.Texture(),
    normalMap: srcMat.normalMap ?? null,
    roughnessMap: srcMat.roughnessMap ?? null,
    extras: [],
    toes: [],
    ankle: new THREE.Vector3(0, 0.06, -0.08),
    length: 0.25,
    uvPerMeter: Math.sqrt(uvA / Math.max(wA, 1e-9)),
    landmarks: LANDMARKS,
  };
}
