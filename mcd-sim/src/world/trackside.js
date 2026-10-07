// Контактная сеть, светофоры, путевые знаки. Собственная геометрия (готовых моделей российской КС нет в открытом доступе);
// при наличии модели Sketchfab light_signals она заменяет головку светофора.
import * as THREE from 'three';
import { assets } from '../core/assets.js';
import { placeMatrix, mergeGeoms, tf, sweep } from './geom.js';
import { signalPlateTex, speedBoardTex, kmPostTex } from './signs.js';
import { PLATFORM_EDGE } from '../sim/route.js';
import { getSignalProto, instantiate } from '../core/realModels.js';

export const MAST_STEP = 62;
const CW_H = 6.1; // высота контактного провода, м
const MW_H = 7.55; // несущий трос у опоры

let R = null;
function res() {
  if (R) return R;
  const concrete = assets.pbr('brushed_concrete', { repeat: 1, color: 0xc8c6c0 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.85, roughness: 0.45 });
  const galv = assets.pbr('metal_plate', { repeat: 1, color: 0xa9adb2, metalness: 1 });
  const insul = new THREE.MeshStandardMaterial({ color: 0x5b3a2a, roughness: 0.35, metalness: 0.0 });
  const wire = new THREE.MeshStandardMaterial({ color: 0x6b4a32, metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide });
  // опора: коническая железобетонная стойка (основание на −1.0, высота 10.6 м)
  const mast = new THREE.CylinderGeometry(0.15, 0.22, 10.6, 12, 1); mast.translate(0, -1.0 + 5.3, 0);
  // консоль: горизонтальная тяга, наклонная труба, фиксатор, изоляторы. +X — к пути.
  const arm = (len) => {
    const parts = [];
    const t1 = new THREE.CylinderGeometry(0.03, 0.03, len, 8); t1.rotateZ(Math.PI / 2); t1.translate(len / 2, MW_H + 0.05, 0); parts.push(t1);
    const L2 = Math.hypot(len, 1.3);
    parts.push(tf(new THREE.CylinderGeometry(0.035, 0.035, L2, 8), { x: len / 2, y: MW_H - 0.65, rz: Math.PI / 2 + Math.atan2(1.3, len) }));
    const fix = tf(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6), { x: len - 0.4, y: CW_H + 0.15, rz: Math.PI / 2 - 0.25 }); parts.push(fix);
    const brack = tf(new THREE.BoxGeometry(0.25, 0.4, 0.12), { x: 0.2, y: MW_H, z: 0 }); parts.push(brack);
    const brack2 = tf(new THREE.BoxGeometry(0.25, 0.4, 0.12), { x: 0.2, y: MW_H - 1.3, z: 0 }); parts.push(brack2);
    return mergeGeoms(parts.map((g) => g.index ? g : g));
  };
  const insulator = () => {
    const parts = [];
    for (let i = 0; i < 5; i++) parts.push(tf(new THREE.CylinderGeometry(0.08, 0.08, 0.025, 12), { y: i * 0.07 }));
    parts.push(tf(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8), { y: 0.14 }));
    return mergeGeoms(parts);
  };
  const ins = insulator();
  const insH = tf(ins.clone(), { rz: Math.PI / 2, x: 0.55, y: MW_H + 0.05 });
  const insD = tf(ins.clone(), { rz: Math.PI / 2, x: 0.55, y: MW_H - 1.3 });
  R = { concrete, steel, galv, insul, wire, mast, arm, insH: mergeGeoms([insH, insD]), armCache: new Map() };
  return R;
}

function armGeo(len) {
  const r = res();
  const k = Math.round(len * 4) / 4;
  if (!r.armCache.has(k)) r.armCache.set(k, r.arm(k));
  return r.armCache.get(k);
}

// Боковое положение опоры для стороны side (−1 левая, +1 правая) с учётом платформ
function mastLat(route, s, side) {
  const o = Math.abs(route.trackOffset(s, side));
  const st = route.stationAt(s, 10);
  if (st && !st.island) return side * (o + PLATFORM_EDGE + st.platformWidth + 0.6);
  return side * (o + 3.1);
}

export function buildCatenary(route, s0, s1, origin) {
  const r = res();
  const g = new THREE.Group();
  const first = Math.ceil(s0 / MAST_STEP), last = Math.floor(s1 / MAST_STEP);
  const masts = [];
  for (let i = first; i <= last; i++) for (const side of [-1, 1]) masts.push({ s: i * MAST_STEP, side, i });
  if (!masts.length) return g;
  const mastMesh = new THREE.InstancedMesh(r.mast, r.concrete, masts.length);
  const insMesh = new THREE.InstancedMesh(r.insH, r.insul, masts.length);
  const m = new THREE.Matrix4();
  // консоли разной длины → группируем по длине
  const byLen = new Map();
  masts.forEach((mm, k) => {
    const lat = mastLat(route, mm.s, mm.side);
    placeMatrix(route, mm.s, lat, 0, origin, { yaw: mm.side > 0 ? Math.PI : 0, out: m });
    mastMesh.setMatrixAt(k, m);
    insMesh.setMatrixAt(k, m);
    const len = Math.abs(lat - route.trackOffset(mm.s, mm.side)) + 0.25;
    const key = Math.round(len * 4) / 4;
    if (!byLen.has(key)) byLen.set(key, []);
    byLen.get(key).push(m.clone());
  });
  mastMesh.castShadow = true; mastMesh.receiveShadow = true;
  g.add(mastMesh, insMesh);
  for (const [len, mats] of byLen) {
    const im = new THREE.InstancedMesh(armGeo(len), r.galv, mats.length);
    mats.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.castShadow = true;
    g.add(im);
  }
  // провода: контактный (зигзаг ±0.3 м) и несущий трос (провис), струны
  const zig = (s) => {
    const k = s / MAST_STEP; const i = Math.floor(k), t = k - i;
    const a = (i % 2 === 0 ? 1 : -1) * 0.3, b = -a;
    return a + (b - a) * t;
  };
  const sag = (s) => { const t = (s / MAST_STEP) % 1; return 1.25 * 4 * t * (1 - t); };
  const tube = (rad) => [0, 1, 2, 3].map((k) => ({ dl: Math.cos(k * Math.PI / 2) * rad, dh: Math.sin(k * Math.PI / 2) * rad }));
  const ring = tube(0.0065);
  const droppers = [];
  for (const track of [-1, 1]) {
    const cw = sweep(route, s0, s1, 3, (s) => {
      const c = route.trackOffset(s, track) + zig(s);
      return ring.map((p) => ({ lat: c + p.dl, h: CW_H + p.dh }));
    }, origin, { closed: true });
    const mw = sweep(route, s0, s1, 3, (s) => {
      const c = route.trackOffset(s, track);
      return ring.map((p) => ({ lat: c + p.dl, h: MW_H - sag(s) + p.dh }));
    }, origin, { closed: true });
    g.add(new THREE.Mesh(cw, r.wire), new THREE.Mesh(mw, r.wire));
    const firstD = Math.ceil(s0 / 8.5), lastD = Math.floor(s1 / 8.5);
    for (let i = firstD; i <= lastD; i++) {
      const s = i * 8.5;
      const t = (s / MAST_STEP) % 1; if (t < 0.06 || t > 0.94) continue;
      droppers.push({ s, lat: route.trackOffset(s, track), hTop: MW_H - sag(s), zig: zig(s) });
    }
  }
  if (droppers.length) {
    const dg = new THREE.CylinderGeometry(0.004, 0.004, 1, 4); dg.translate(0, 0.5, 0);
    const dm = new THREE.InstancedMesh(dg, r.wire, droppers.length);
    droppers.forEach((d, i) => {
      placeMatrix(route, d.s, d.lat + d.zig * 0.5, CW_H, origin, { out: m });
      const len = d.hTop - CW_H;
      m.multiply(new THREE.Matrix4().makeScale(1, len, 1));
      dm.setMatrixAt(i, m);
    });
    g.add(dm);
  }
  return g;
}

// ── светофоры ──
let SG = null;
function sigRes() {
  if (SG) return SG;
  const body = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.4 });
  const mastM = new THREE.MeshStandardMaterial({ color: 0x9a9fa5, roughness: 0.6, metalness: 0.6 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
  const lensGeo = new THREE.CircleGeometry(0.085, 20);
  const visor = new THREE.BoxGeometry(0.24, 0.015, 0.2);
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  SG = { body, mastM, stripe, lensGeo, visor, glowTex };
  return SG;
}
const ASPECT_COLORS = { green: 0x22ff66, yellow: 0xffc020, red: 0xff2a1a };
const LENS_ORDER = ['green', 'yellow', 'red'];

export function buildSignal(route, sig, origin) {
  const r = sigRes();
  const g = new THREE.Group();
  const track = sig.dir;
  const s = sig.s;
  const st = route.stationAt(s, 30);
  let lat = route.trackOffset(s, track) + track * 2.45;
  if (st && !st.island) lat = route.trackOffset(s, track) + track * (PLATFORM_EDGE + st.platformWidth + 1.2);
  const m = placeMatrix(route, s, lat, 0, origin, { yaw: sig.dir > 0 ? 0 : Math.PI });
  g.applyMatrix4(m);
  const proto = getSignalProto();
  let lenses = {};
  let H = sig.kind === 'exit' || sig.kind === 'end' ? 4.6 : 5.6;
  if (proto) {
    // готовая модель российского светофора (Sketchfab): мачта с полосами, головка на 5 линз
    const m = instantiate(proto.parts, { cast: true });
    m.position.y = -1.0;
    g.add(m);
    H = 6.2 - 1.0;
    for (const asp of LENS_ORDER) {
      const [x, y, z] = proto.lenses[asp];
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: r.glowTex, color: ASPECT_COLORS[asp], transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      glow.position.set(x, y - 1.0, z + 0.05); g.add(glow);
      const disc = new THREE.Mesh(r.lensGeo, new THREE.MeshBasicMaterial({ color: 0x111111 }));
      disc.scale.setScalar(1.05); disc.position.set(x, y - 1.0, z + 0.01); g.add(disc);
      lenses[asp] = { mat: disc.material, glow };
    }
  } else {
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, H + 1, 10), r.mastM);
  mast.position.y = (H + 1) / 2 - 1.0; mast.castShadow = true; g.add(mast);
  if (sig.kind !== 'block') {
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.1, 0.35, 10), r.stripe); b.position.y = 1.2 + i * 0.75; g.add(b); }
  }
  const head = new THREE.Group();
  head.position.set(0, H, 0.05);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.05, 0.26), r.body); box.castShadow = true; head.add(box);
  LENS_ORDER.forEach((asp, i) => {
    const y = 0.33 - i * 0.33;
    const mat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const lens = new THREE.Mesh(r.lensGeo, mat); lens.position.set(0, y, 0.135); head.add(lens);
    const vis = new THREE.Mesh(r.visor, r.body); vis.position.set(0, y + 0.11, 0.23); head.add(vis);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: r.glowTex, color: ASPECT_COLORS[asp], transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glow.position.set(0, y, 0.2); glow.scale.setScalar(0.9); head.add(glow);
    lenses[asp] = { mat, glow };
  });
  g.add(head);
  }
  // табличка с номером
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3), new THREE.MeshStandardMaterial({ map: signalPlateTex(sig.name), roughness: 0.7 }));
  plate.position.set(proto ? proto.lenses.red[0] : 0, proto ? 2.3 : H - 0.75, 0.25); g.add(plate);
  g.userData.signal = sig;
  g.userData.update = (night) => {
    for (const asp of LENS_ORDER) {
      const on = sig.aspect === asp;
      lenses[asp].mat.color.setHex(on ? ASPECT_COLORS[asp] : 0x141414);
      lenses[asp].glow.material.opacity = on ? 0.55 + night * 0.45 : 0;
      lenses[asp].glow.scale.setScalar(on ? 0.7 + night * 2.2 : 0.1);
    }
  };
  g.userData.update(0);
  return g;
}

// ── путевые знаки: ограничения скорости и километровые столбы ──
export function buildSigns(route, s0, s1, origin) {
  const g = new THREE.Group();
  const post = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.7 });
  for (const seg of route.limits) {
    for (const dir of [1, -1]) {
      const s = dir > 0 ? seg.s0 : seg.s1;
      if (s < s0 || s >= s1 || s <= 0 || s >= route.length) continue;
      const lat = route.trackOffset(s, dir) + dir * 2.7;
      const st = route.stationAt(s, 15);
      if (st) continue;
      const grp = new THREE.Group();
      grp.applyMatrix4(placeMatrix(route, s - dir * 1, lat, 0, origin, { yaw: dir > 0 ? 0 : Math.PI }));
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 3.2, 8), post); p.position.y = 0.6; grp.add(p);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshStandardMaterial({ map: speedBoardTex(seg.v), roughness: 0.6 }));
      b.position.set(0, 2.1, 0.06); grp.add(b);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshStandardMaterial({ color: 0x777777 })); back.position.set(0, 2.1, 0.05); back.rotation.y = Math.PI; grp.add(back);
      g.add(grp);
    }
  }
  const kmFirst = Math.ceil(s0 / 1000), kmLast = Math.floor(s1 / 1000);
  for (let k = kmFirst; k <= kmLast; k++) {
    const s = k * 1000;
    if (route.stationAt(s, 20)) continue;
    const lat = -(Math.abs(route.trackOffset(s, -1)) + 3.6);
    const grp = new THREE.Group();
    grp.applyMatrix4(placeMatrix(route, s, lat, 0, origin, { yaw: Math.PI / 2 }));
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.9, 0.16), new THREE.MeshStandardMaterial({ map: kmPostTex(k), roughness: 0.7 }));
    p.position.y = -0.1; p.castShadow = true; grp.add(p);
    g.add(grp);
  }
  return g;
}
