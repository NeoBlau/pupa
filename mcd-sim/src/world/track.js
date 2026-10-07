// Верхнее строение пути: рельсы Р65, железобетонные шпалы, балластная призма, земляное полотно и грунт.
import * as THREE from 'three';
import { assets } from '../core/assets.js';
import { sweep, placeMatrix, mergeGeoms, tf } from './geom.js';

const GAUGE_HALF = 0.7965; // ось головки рельса от оси пути (колея 1520 мм)
export const SLEEPER_STEP = 0.545; // 1840 шпал/км

let shared = null;
function sharedRes(season) {
  if (shared && shared.season === season) return shared;
  const winter = season === 'winter';
  // профиль рельса Р65 (упрощённый), x — поперёк, y — от головки вниз
  const railProfile = [
    [0.075, -0.18], [0.075, -0.168], [0.012, -0.15], [0.009, -0.045], [0.036, -0.035], [0.037, -0.006], [0.03, 0],
    [-0.03, 0], [-0.037, -0.006], [-0.036, -0.035], [-0.009, -0.045], [-0.012, -0.15], [-0.075, -0.168], [-0.075, -0.18],
  ];
  // шпала Ш1: трапеция в сечении + подрельсовые площадки и клеммы
  const sl = new THREE.BufferGeometry();
  {
    const L = 1.35, hb = 0.15, ht = 0.085, H = 0.19;
    const shape = new THREE.Shape();
    shape.moveTo(-hb, -H / 2); shape.lineTo(hb, -H / 2); shape.lineTo(ht + 0.01, H / 2 - 0.01); shape.lineTo(ht, H / 2); shape.lineTo(-ht, H / 2); shape.lineTo(-ht - 0.01, H / 2 - 0.01); shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 2 * L, bevelEnabled: false });
    g.translate(0, 0, -L);
    g.rotateY(Math.PI / 2); // длина шпалы — поперёк пути (ось X)
    // UV по длине
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
    sl.copy(g);
  }
  const clipParts = [];
  for (const sx of [-GAUGE_HALF, GAUGE_HALF]) {
    clipParts.push(tf(new THREE.BoxGeometry(0.2, 0.012, 0.18), { x: sx, y: 0.101 })); // прокладка
    for (const d of [-1, 1]) {
      clipParts.push(tf(new THREE.BoxGeometry(0.05, 0.05, 0.14), { x: sx + d * 0.1, y: 0.12 })); // упор/клемма
      clipParts.push(tf(new THREE.CylinderGeometry(0.014, 0.014, 0.07, 6), { x: sx + d * 0.13, y: 0.13 })); // болт
    }
  }
  const clips = mergeGeoms(clipParts.map((g) => g.toNonIndexed ? g : g));
  const concrete = assets.pbr('rough_concrete', { repeat: 1, color: winter ? 0xd8dade : 0xb8b4ac });
  const fastening = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.7, metalness: 0.5 });
  const railSide = assets.pbr('rusty_metal', { repeat: 1, color: 0x8a6a55, roughness: 0.9, side: THREE.DoubleSide });
  const railHead = new THREE.MeshStandardMaterial({ color: 0xc9cdd2, roughness: 0.22, metalness: 1.0 });
  const ballast = assets.pbr(winter ? 'snow_02' : 'gravel_stones', { repeat: 1, color: winter ? 0xf2f4f8 : 0xb9b2a8, normalScale: 1.4 });
  const nearGround = assets.pbr(winter ? 'snow_02' : 'grass_path_2', { repeat: 1 }).clone();
  const farGround = assets.pbr(winter ? 'snow_02' : 'leafy_grass', { repeat: 1 }).clone();
  nearGround.vertexColors = true; farGround.vertexColors = true;
  ballast.vertexColors = false;
  shared = { season, railProfile, sleeper: sl, clips, concrete, fastening, railSide, railHead, ballast, nearGround, farGround };
  return shared;
}

// Гладкий шум для рельефа (непрерывен между чанками)
function h2(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return (h2(xi, zi) * (1 - u) + h2(xi + 1, zi) * u) * (1 - v) + (h2(xi, zi + 1) * (1 - u) + h2(xi + 1, zi + 1) * u) * v;
}
// крупномасштабная вариация цвета травы (пятна выгоревшей/сочной травы, тень у опушек)
export function groundColor(x, z, season) {
  const n = vnoise(x / 60, z / 60) * 0.6 + vnoise(x / 17, z / 17) * 0.4;
  const m = vnoise(x / 230 + 7, z / 230 + 3);
  if (season === 'winter') { const k = 0.9 + n * 0.12; return [k, k, k * 1.02]; }
  const dry = Math.max(0, m - 0.5) * 1.4;
  if (season === 'autumn') return [0.95 + n * 0.2 + dry * 0.2, 0.85 + n * 0.15, 0.6 + n * 0.1];
  // летом подкрашиваем в зелёный, сухие пятна — желтее
  return [0.62 + n * 0.22 + dry * 0.35, 0.95 + n * 0.25 + dry * 0.1, 0.48 + n * 0.14 - dry * 0.1];
}

export function terrainH(route, s, lat) {
  const p = route.point(s, lat, 0);
  const n = vnoise(p.x / 90, p.z / 90) * 2.2 + vnoise(p.x / 23, p.z / 23) * 0.5 - 1.3;
  const t = Math.min(1, Math.max(0, (Math.abs(lat) - 14) / 40));
  return -1.05 + n * t;
}

// Строит меши пути для участка [s0, s1]; tracks — список {track: ±1}
export function buildTrack(route, s0, s1, origin, season, lod) {
  const R = sharedRes(season);
  const group = new THREE.Group();
  const offs = (s) => [Math.abs(route.trackOffset(s, -1)), Math.abs(route.trackOffset(s, 1))];

  // балластная призма (общая для двух путей)
  const ballastG = sweep(route, s0, s1, 4, (s) => {
    const [oL, oR] = offs(s);
    return [
      { lat: -(oL + 3.4), h: -1.0 }, { lat: -(oL + 1.75), h: -0.33 }, { lat: -(oL - 1.5), h: -0.36 },
      { lat: oR - 1.5, h: -0.36 }, { lat: oR + 1.75, h: -0.33 }, { lat: oR + 3.4, h: -1.0 },
    ].map((p) => ({ ...p, u: p.lat }));
  }, origin, { uScale: 0.45, vScale: 0.45 });
  const ballast = new THREE.Mesh(ballastG, R.ballast);
  ballast.receiveShadow = true;
  group.add(ballast);

  // грунт по сторонам
  for (const side of [-1, 1]) {
    const nearG = sweep(route, s0, s1, 5, (s) => {
      const o = offs(s)[side < 0 ? 0 : 1];
      const pts = [o + 3.4, o + 6, o + 10, o + 14];
      return (side < 0 ? pts.reverse() : pts).map((l) => ({ lat: side * l, h: l === o + 3.4 ? -1.0 : -1.05 + (l > o + 9 ? -0.15 : 0), u: side * l }));
    }, origin, { uScale: 0.35, vScale: 0.35, colorFn: (x, z) => groundColor(x, z, season) });
    const near = new THREE.Mesh(nearG, R.nearGround); near.receiveShadow = true; group.add(near);
    const farG = sweep(route, s0, s1, 10, (s) => {
      const o = offs(s)[side < 0 ? 0 : 1];
      const pts = [o + 14, o + 24, o + 40, o + 60, o + 90, o + 130, o + 180];
      return (side < 0 ? pts.reverse() : pts).map((l) => ({ lat: side * l, h: l === o + 14 ? -1.2 : terrainH(route, s, side * l), u: side * l }));
    }, origin, { uScale: 0.22, vScale: 0.22, colorFn: (x, z) => groundColor(x, z, season) });
    const far = new THREE.Mesh(farG, R.farGround); far.receiveShadow = true; group.add(far);
  }

  // рельсы
  for (const track of [-1, 1]) {
    for (const rs of [-1, 1]) {
      const rail = sweep(route, s0, s1, 2, (s) => {
        const c = route.trackOffset(s, track) + rs * GAUGE_HALF;
        return R.railProfile.map(([x, y]) => ({ lat: c + x, h: y }));
      }, origin, { uScale: 2, vScale: 0.5, flipNormals: track * rs > 99 });
      const m = new THREE.Mesh(rail, R.railSide); m.castShadow = lod === 0; m.receiveShadow = true; group.add(m);
      const head = sweep(route, s0, s1, 2, (s) => {
        const c = route.trackOffset(s, track) + rs * GAUGE_HALF;
        return [{ lat: c - 0.031, h: 0.0008 }, { lat: c + 0.031, h: 0.0008 }];
      }, origin, { uScale: 1, vScale: 0.1, flipNormals: false });
      group.add(new THREE.Mesh(head, R.railHead));
    }
  }

  // шпалы и скрепления (инстансинг)
  const first = Math.ceil(s0 / SLEEPER_STEP), last = Math.floor(s1 / SLEEPER_STEP);
  const count = (last - first + 1) * 2;
  if (count > 0) {
    const sleepers = new THREE.InstancedMesh(R.sleeper, R.concrete, count);
    const clips = lod === 0 ? new THREE.InstancedMesh(R.clips, R.fastening, count) : null;
    const m = new THREE.Matrix4();
    let k = 0;
    for (let i = first; i <= last; i++) {
      const s = i * SLEEPER_STEP;
      for (const track of [-1, 1]) {
        placeMatrix(route, s, route.trackOffset(s, track), -0.285, origin, { out: m });
        sleepers.setMatrixAt(k, m);
        if (clips) clips.setMatrixAt(k, m);
        k++;
      }
    }
    sleepers.receiveShadow = true; sleepers.castShadow = false;
    group.add(sleepers);
    if (clips) group.add(clips);
  }
  return group;
}
