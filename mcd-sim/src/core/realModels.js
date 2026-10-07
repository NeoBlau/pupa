// Подготовка готовых моделей (Sketchfab) к игре: запекание трансформаций, разрезка состава на вагоны,
// приведение осей (−Z — вперёд, +X — вправо, Y — вверх, 0 — уровень головки рельса), масштаб под реальные размеры,
// исправление материалов (AO во втором UV, полупрозрачность кузовов).
import * as THREE from 'three';
import { assets } from './assets.js';

// ── утилиты ──
export function bake(root, filter = null) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (filter && !filter(o)) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    parts.push({ geometry: g, material: o.material, name: o.name });
  });
  return parts;
}

function partsBox(parts) {
  const b = new THREE.Box3();
  for (const p of parts) { p.geometry.computeBoundingBox(); b.union(p.geometry.boundingBox); }
  return b;
}

function transformParts(parts, m) { for (const p of parts) { p.geometry.applyMatrix4(m); if (m.determinant() < 0) flipWinding(p.geometry); p.geometry.computeBoundingBox(); p.geometry.computeBoundingSphere(); } }

function flipWinding(g) {
  if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.index.needsUpdate = true; }
}

// Разрезка по координате центроида треугольника (по оси axis), bounds — отсортированные границы
function splitParts(parts, axis, bounds) {
  const buckets = Array.from({ length: bounds.length + 1 }, () => []);
  for (const p of parts) {
    const g = p.geometry.index ? p.geometry : null;
    if (!g) { buckets[0].push(p); continue; }
    const pos = g.attributes.position.array, idx = g.index.array;
    const lists = buckets.map(() => []);
    for (let t = 0; t < idx.length; t += 3) {
      const c = (pos[idx[t] * 3 + axis] + pos[idx[t + 1] * 3 + axis] + pos[idx[t + 2] * 3 + axis]) / 3;
      let k = 0; while (k < bounds.length && c > bounds[k]) k++;
      lists[k].push(idx[t], idx[t + 1], idx[t + 2]);
    }
    lists.forEach((l, k) => {
      if (!l.length) return;
      const ng = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(g.attributes)) ng.setAttribute(name, attr);
      ng.setIndex(l);
      buckets[k].push({ geometry: compact(ng), material: p.material, name: p.name });
    });
  }
  return buckets;
}

// Удаляет неиспользуемые вершины (после разрезки)
function compact(g) {
  const idx = g.index.array; const n = g.attributes.position.count;
  const remap = new Int32Array(n).fill(-1); let m = 0;
  const out = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) { const v = idx[i]; if (remap[v] < 0) remap[v] = m++; out[i] = remap[v]; }
  const ng = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const k = attr.itemSize; const src = attr.array; const dst = new src.constructor(m * k);
    for (let v = 0; v < n; v++) if (remap[v] >= 0) for (let j = 0; j < k; j++) dst[remap[v] * k + j] = src[v * k + j];
    ng.setAttribute(name, new THREE.BufferAttribute(dst, k, attr.normalized));
  }
  ng.setIndex(new THREE.BufferAttribute(m > 65535 ? out : new Uint16Array(out), 1));
  return ng;
}

function toGroup(parts, { cast = true, receive = true } = {}) {
  const g = new THREE.Group();
  for (const p of parts) {
    const m = new THREE.Mesh(p.geometry, p.material);
    m.name = p.name || '';
    m.castShadow = cast; m.receiveShadow = receive;
    g.add(m);
  }
  return g;
}

// Исправления материалов
const fixed = new WeakSet();
export function fixMaterials(root, { aoUV1 = false, opaqueBlend = false, glassRe = /glass|steklo|lob|window|okn/i } = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || fixed.has(m)) continue;
      fixed.add(m);
      if (aoUV1 && o.geometry.attributes.uv1) {
        // упакованная карта ORM у этой модели развёрнута во втором UV-канале
        for (const k of ['aoMap', 'roughnessMap', 'metalnessMap']) if (m[k]) m[k].channel = 1;
        m.needsUpdate = true;
      }
      if (opaqueBlend && m.transparent && !glassRe.test(m.name) && m.opacity > 0.9) {
        m.transparent = false; m.alphaTest = 0.5; m.depthWrite = true; m.needsUpdate = true;
      }
      if (m.map) m.map.anisotropy = 8;
      m.envMapIntensity = 1.0;
    }
  });
}

// ── составы ──
const TRAIN_CFG = {
  es2g: {
    pieces: [
      // модель: 3 вагона вдоль +X, нос головного — на −X; ось колёсных пар внизу
      { file: 'es2g_exterior', axis: 0, cuts: [17.6, 36.8], keep: ['head', 'mid', 'mid2'], forward: '-x', scale: { L: 1.29, W: 1.2, H: 1.05 } },
    ],
    roles: (i, n) => {
      // 5-вагонные секции: Г П П П Г; сдвоенный — две секции
      const k = i % 5;
      if (k === 0) return { piece: 'head', flip: false };
      if (k === 4 || i === n - 1) return { piece: 'head', flip: true };
      return { piece: k === 2 ? 'mid2' : 'mid', flip: k === 3 };
    },
    cab: { file: 'es2g_cab', aoUV1: true, eye: [0, 1.3, -1.45], floor: 1.12, frontInset: 1.55 },
    hideInCab: /lob|Material #1287/i,
  },
  ed4m: {
    pieces: [
      { file: 'ed4m_train', axis: 2, keep: ['head'], forward: '+z', scale: { L: 1.075, W: 1.0, H: 1.0 }, opaqueBlend: true },
      { file: 'ed4m_exterior', axis: 2, keep: ['mid'], forward: '+z', scale: { L: 1.055, W: 1.0, H: 1.0 }, opaqueBlend: true },
    ],
    roles: (i, n) => (i === 0 ? { piece: 'head', flip: false } : i === n - 1 ? { piece: 'head', flip: true } : { piece: 'mid', flip: i % 2 === 0 }),
    cabInModel: { eye: [0.62, 2.85, 7.3] }, // точка глаз машиниста в координатах модели головного вагона
  },
};

const trainCache = new Map();
export function hasRealTrain(id) {
  const c = TRAIN_CFG[id];
  return !!c && c.pieces.every((p) => assets.hasSketchfab(p.file));
}

export async function loadRealTrain(id) {
  if (trainCache.has(id)) return trainCache.get(id);
  const cfg = TRAIN_CFG[id];
  const p = (async () => {
    const pieces = {};
    for (const pc of cfg.pieces) {
      const gltf = await assets.sketch(pc.file);
      if (!gltf) return null;
      fixMaterials(gltf.scene, { opaqueBlend: pc.opaqueBlend });
      // изнутри кабины кузов должен быть виден (стены, крыша)
      gltf.scene.traverse((o) => { if (o.isMesh && !o.material.transparent) o.material.side = THREE.DoubleSide; });
      const parts = bake(gltf.scene);
      const box = partsBox(parts);
      const railY = box.min.y;
      // перевод в систему вагона
      const { L, W, H } = pc.scale;
      const m = new THREE.Matrix4();
      if (pc.forward === '-x') m.set(0, 0, -W, 0, 0, H, 0, -railY * H, L, 0, 0, 0, 0, 0, 0, 1); // (x,y,z)→(−z·W, (y−r)·H, x·L)
      else if (pc.forward === '+z') m.set(-W, 0, 0, 0, 0, H, 0, -railY * H, 0, 0, -L, 0, 0, 0, 0, 1); // (x,y,z)→(−x·W, (y−r)·H, −z·L)
      transformParts(parts, m);
      let buckets;
      if (pc.cuts) {
        // границы в новых координатах: z = x·L
        buckets = splitParts(parts, 2, pc.cuts.map((c) => c * L));
      } else buckets = [parts];
      pc.keep.forEach((name, k) => {
        const bp = buckets[k];
        const b = partsBox(bp);
        const cz = (b.min.z + b.max.z) / 2;
        const cx = (b.min.x + b.max.x) / 2;
        const shift = new THREE.Matrix4().makeTranslation(-cx, 0, -cz);
        transformParts(bp, shift);
        pieces[name] = { parts: bp, length: b.max.z - b.min.z, box: partsBox(bp), matrix: shift.clone().multiply(m) };
      });
    }
    let cab = null;
    if (cfg.cab && assets.hasSketchfab(cfg.cab.file)) {
      const g = await assets.sketch(cfg.cab.file);
      fixMaterials(g.scene, { aoUV1: cfg.cab.aoUV1 });
      const parts = bake(g.scene);
      // пульт смотрит в +Z модели → поворачиваем к −Z вагона
      transformParts(parts, new THREE.Matrix4().makeRotationY(Math.PI));
      cab = { parts, ...cfg.cab, box: partsBox(parts) };
    }
    return { id, cfg, pieces, cab };
  })();
  trainCache.set(id, p);
  return p;
}

export function instantiate(pieceParts, opts) { return toGroup(pieceParts.map((p) => ({ ...p })), opts); }

// ── светофор ──
let signalProto = null;
export function getSignalProto() { return signalProto || null; }
export async function loadSignalModel() {
  if (signalProto !== null) return signalProto;
  const g = await assets.sketch('light_signals');
  if (!g) { signalProto = false; return false; }
  // убираем «горящие» вставки линз, берём правую мачту
  const parts = bake(g.scene, (o) => !/Object_1[234]/.test(o.name));
  const [, right] = splitParts(parts, 0, [-0.2]);
  const b = partsBox(right);
  const cx = 1.45; // ось мачты
  transformParts(right, new THREE.Matrix4().makeTranslation(-cx, 0, -0.04));
  // центры линз (сверху вниз): Ж, З, К, Б, Ж
  const lx = 0.85 - cx;
  signalProto = { parts: right, lenses: { yellow: [lx, 6.2, 0.16], green: [lx, 5.78, 0.16], red: [lx, 5.35, 0.16], white: [lx, 4.92, 0.16] }, box: b };
  return signalProto;
}

// ── дома ──
// floors — этажность для масштаба по высоте (≈2.8 м на этаж), height — целевая высота, filter — отбор узлов
const HOUSES = [
  { key: 'panel_house_1', height: 49, zone: ['city', 'town'] },
  { key: 'panel_house_3', height: 14.7, zone: ['town', 'city'] },
  { key: 'panel_house_2', height: 15.5, filter: (o) => { o.geometry.computeBoundingBox(); return o.geometry.boundingBox.max.y - o.geometry.boundingBox.min.y > 6; }, zone: ['town', 'city'] },
  { key: 'house_9storey', height: 34, zone: ['city', 'town'] },
  { key: 'house_lowpoly_8k', height: 27, zone: ['town', 'city'] },
  { key: 'house_moscow_multi', height: 100, zone: ['city'], rare: true },
  { key: 'house_soviet2', height: 50, zone: ['city'] },
  { key: 'khrushchevka', height: 14.5, zone: ['town'] },
];
let houseList = null;
export async function loadHouses() {
  if (houseList) return houseList;
  houseList = [];
  for (const h of HOUSES) {
    const g = await assets.sketch(h.key);
    if (!g) continue;
    fixMaterials(g.scene, { opaqueBlend: true });
    const parts = bake(g.scene, h.filter ? (o) => h.filter(o) : null);
    if (!parts.length) continue;
    const b = partsBox(parts);
    const s = h.height / (b.max.y - b.min.y);
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    transformParts(parts, new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-cx, -b.min.y, -cz)));
    const box = partsBox(parts);
    houseList.push({ ...h, parts, box, radius: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 });
  }
  return houseList;
}

// ── берёзы ──
export async function loadBirches() {
  const out = [];
  for (const key of ['birch_1', 'birch_2']) {
    const g = await assets.sketch(key);
    if (!g) continue;
    fixMaterials(g.scene, {});
    g.scene.traverse((o) => { if (o.isMesh && o.material.transparent) { o.material.transparent = false; o.material.alphaTest = 0.4; o.material.side = THREE.DoubleSide; } });
    const parts = bake(g.scene);
    const b = partsBox(parts);
    const s = (key === 'birch_1' ? 16 : 13) / (b.max.y - b.min.y);
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    transformParts(parts, new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-cx, -b.min.y, -cz)));
    const holder = toGroup(parts);
    out.push({ key, parts, holder });
  }
  return out;
}
