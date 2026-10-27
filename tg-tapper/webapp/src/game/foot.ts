// Foot geometry: a procedural placeholder (SDF + marching cubes) or a real 3D scan (.glb).
//
// Conventions (both cases): metres, foot length along +Y (heel ≈ 0 → toes ≈ 0.25),
// width along X (big toe at -X), sole facing +Z (toward the default camera).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';
import type { ModelDef } from '@shared/game.ts';

export interface FootAsset {
  geometry: THREE.BufferGeometry;
  map: THREE.Texture;
  normalMap: THREE.Texture | null;
  /** Nails and other static meshes attached to the foot. */
  extras: THREE.Object3D[];
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

// Toes: base → tip, radius. Big toe at -X.
const TOES: { a: V3; b: V3; r: number }[] = [
  { a: [-0.027, 0.192, -0.03], b: [-0.031, 0.243, -0.026], r: 0.0135 },
  { a: [-0.005, 0.197, -0.03], b: [-0.006, 0.238, -0.027], r: 0.0094 },
  { a: [0.012, 0.194, -0.03], b: [0.014, 0.231, -0.028], r: 0.009 },
  { a: [0.027, 0.187, -0.03], b: [0.031, 0.221, -0.029], r: 0.0086 },
  { a: [0.041, 0.177, -0.031], b: [0.047, 0.205, -0.03], r: 0.0078 },
];

function footSdf(x: number, y: number, z: number) {
  let d = sdEllipsoid(x, y, z, [0, 0.038, -0.036], [0.033, 0.042, 0.036]); // heel
  d = smin(d, sdEllipsoid(x, y, z, [0.006, 0.105, -0.043], [0.037, 0.075, 0.034]), 0.03); // midfoot
  d = smin(d, sdEllipsoid(x, y, z, [0, 0.172, -0.033], [0.049, 0.034, 0.027]), 0.03); // ball
  d = smin(d, sdEllipsoid(x, y, z, [0.002, 0.11, -0.062], [0.034, 0.085, 0.034]), 0.03); // dorsum
  d = smin(d, sdCapsule(x, y, z, [0, 0.05, -0.065], [0, 0.065, -0.2], 0.033), 0.03); // ankle → leg
  // medial arch: hollow on the inner sole
  d = smax(d, -sdEllipsoid(x, y, z, [-0.042, 0.105, 0.004], [0.024, 0.055, 0.022]), 0.02);
  let toes = Infinity;
  for (const t of TOES) {
    toes = Math.min(toes, sdCapsule(x, y, z, t.a, t.b, t.r));
    // plump toe pad on the sole side
    toes = smin(toes, sdEllipsoid(x, y, z, [t.b[0], t.b[1] - t.r * 0.6, t.b[2] + t.r * 0.25], [t.r * 1.05, t.r * 1.1, t.r * 0.9]), 0.004);
  }
  d = smin(d, toes, 0.009);
  // cut the leg off behind the foot
  return Math.max(d, -(z + 0.16));
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
// Skin textures (albedo + normal), painted in planar sole UV space

const TEX = 1024;

function skinTextures(tone: THREE.Color, uvOf: (x: number, y: number) => [number, number]) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX;
  const c = cv.getContext('2d')!;
  const base = `#${tone.getHexString()}`;
  c.fillStyle = base;
  c.fillRect(0, 0, TEX, TEX);

  // Blotchy natural variation
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * TEX;
    const y = Math.random() * TEX;
    const r = 8 + Math.random() * 40;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const tint = Math.random() < 0.5 ? '255,170,150' : '120,70,50';
    g.addColorStop(0, `rgba(${tint},${0.02 + Math.random() * 0.04})`);
    g.addColorStop(1, `rgba(${tint},0)`);
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Pressure areas are pinker: heel, ball, toe pads
  const pink = (x: number, y: number, rx: number, ry: number, a: number) => {
    const [u, v] = uvOf(x, y);
    c.save();
    c.translate(u * TEX, (1 - v) * TEX);
    c.scale(rx, ry);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(240,110,110,${a})`);
    g.addColorStop(1, 'rgba(240,110,110,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, 1, 0, Math.PI * 2);
    c.fill();
    c.restore();
  };
  const px = TEX / 0.26;
  pink(0, 0.03, 0.035 * px, 0.04 * px, 0.32);
  pink(0, 0.17, 0.05 * px, 0.028 * px, 0.28);
  for (const t of TOES) pink(t.b[0], t.b[1] - t.r * 0.5, t.r * 1.2 * px, t.r * 1.2 * px, 0.35);

  // Height map for the normal map: pores + creases
  const hc = document.createElement('canvas');
  hc.width = hc.height = TEX;
  const h = hc.getContext('2d')!;
  h.fillStyle = '#808080';
  h.fillRect(0, 0, TEX, TEX);
  for (let i = 0; i < 60000; i++) {
    h.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.12)';
    h.fillRect(Math.random() * TEX, Math.random() * TEX, 1.5, 1.5);
  }
  // sole creases (arch & ball), drawn into both height and albedo
  const crease = (pts: [number, number][], w: number, a: number) => {
    for (const ctx of [h, c]) {
      ctx.strokeStyle = ctx === h ? `rgba(0,0,0,${a})` : `rgba(110,55,40,${a * 0.25})`;
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
  for (let i = 0; i < 26; i++) {
    const x = -0.03 + Math.random() * 0.06;
    const y = 0.07 + Math.random() * 0.08;
    crease([
      [x, y],
      [x + 0.01 * (Math.random() - 0.5), y + 0.012 + Math.random() * 0.015],
    ], 1.5 + Math.random() * 2, 0.35);
  }
  crease(
    [
      [-0.045, 0.152],
      [-0.01, 0.148],
      [0.03, 0.15],
      [0.05, 0.158],
    ],
    3,
    0.45,
  );
  for (const t of TOES)
    crease(
      [
        [t.a[0] - t.r, t.a[1] + 0.004],
        [t.a[0] + t.r, t.a[1] + 0.004],
      ],
      2.5,
      0.5,
    );

  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return { map, normalMap: heightToNormal(hc, 2.5) };
}

function heightToNormal(src: HTMLCanvasElement, strength: number) {
  const w = src.width;
  const hgt = src.getContext('2d')!.getImageData(0, 0, w, w).data;
  const out = new ImageData(w, w);
  const H = (x: number, y: number) => hgt[(((y + w) % w) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * w + x) * 4;
      out.data[o] = ((-dx / l) * 0.5 + 0.5) * 255;
      out.data[o + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      out.data[o + 2] = (1 / l) * 0.5 * 255 + 127;
      out.data[o + 3] = 255;
    }
  const cv = document.createElement('canvas');
  cv.width = cv.height = w;
  cv.getContext('2d')!.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------------------

const TONES: Record<string, string> = {
  anna: '#f0c3a6',
  kate: '#f5cfb6',
  kim: '#eec7a1',
  tiffany: '#8e5a3b',
  mia: '#e5b691',
  lola: '#c88e6a',
};

const LANDMARKS = {
  heel: new THREE.Vector3(0, 0.035, 0),
  arch: new THREE.Vector3(0, 0.1, -0.01),
  ball: new THREE.Vector3(0, 0.17, -0.006),
  toes: new THREE.Vector3(0.005, 0.225, -0.015),
  center: new THREE.Vector3(0, 0.12, -0.005),
};

export function proceduralFoot(def: ModelDef): FootAsset {
  const { pos, index } = polygonize(footSdf, [-0.07, -0.015, -0.17], [0.075, 0.265, 0.01], 0.0022);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);

  // Smooth normals from the SDF gradient; fix winding to match them.
  const n = new Float32Array(pos.length);
  const e = 0.0005;
  for (let i = 0; i < pos.length; i += 3) {
    const [x, y, z] = [pos[i], pos[i + 1], pos[i + 2]];
    const gx = footSdf(x + e, y, z) - footSdf(x - e, y, z);
    const gy = footSdf(x, y + e, z) - footSdf(x, y - e, z);
    const gz = footSdf(x, y, z + e) - footSdf(x, y, z - e);
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

  const tone = new THREE.Color(TONES[def.id] ?? '#e9bfa0');
  const { map, normalMap } = skinTextures(tone, uvOf);

  // Toenails on the top side of each toe.
  const nailMat = new THREE.MeshPhysicalMaterial({ color: tone.clone().lerp(new THREE.Color('#ffd6d0'), 0.55), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
  const extras: THREE.Object3D[] = TOES.map((t) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), nailMat);
    m.scale.set(t.r * 0.75, t.r * 0.85, t.r * 0.22);
    m.position.set(t.b[0], t.b[1] - t.r * 0.15, t.b[2] - t.r * 0.92);
    return m;
  });

  return { geometry: g, map, normalMap, extras, length: 0.25, uvPerMeter: 1 / S, landmarks: LANDMARKS };
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
    extras: [],
    length: 0.25,
    uvPerMeter: Math.sqrt(uvA / Math.max(wA, 1e-9)),
    landmarks: LANDMARKS,
  };
}
