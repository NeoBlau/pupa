// Окружение вдоль линии: лес и деревья (Poly Haven, с импостерами для дальних), кустарник, трава,
// жилая застройка (панельные дома: Sketchfab, при отсутствии — процедурные с PBR), бетонные заборы ПО-2,
// шумозащитные экраны, сетчатые ограждения, гаражи, автомобили, ЛЭП.
import * as THREE from 'three';
import { assets, flattenModel } from '../core/assets.js';
import { placeMatrix, mergeGeoms, tf, sweep } from './geom.js';
import { mulberry32, hashStr } from '../core/rng.js';
import { terrainH } from './track.js';
import { PLATFORM_EDGE } from '../sim/route.js';
import { loadHouses, loadBirches } from '../core/realModels.js';

const LIB = { trees: [], shrubs: [], grass: [], fence: null, car: null, poles: null, buildings: [], factory: null, garage: null };
let renderer = null;

function nodeParts(gltf, name) {
  const node = gltf.scene.getObjectByName(name);
  if (!node) return null;
  const clone = node.clone(true);
  clone.position.set(0, clone.position.y, 0);
  const holder = new THREE.Group(); holder.add(clone);
  return { parts: flattenModel(holder), box: new THREE.Box3().setFromObject(holder) };
}

// Импостор: рендер модели сбоку в текстуру, далее — два скрещённых квада
function makeImpostor(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const w = Math.max(size.x, size.z), h = size.y;
  const res = 512;
  const rt = new THREE.WebGLRenderTarget(res, Math.round(res * Math.min(2, h / w)), { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x4a4a3a, 1.6));
  const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(3, 6, 5); scene.add(dl);
  const o = obj.clone(true); scene.add(o);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h, 0, -100, 100);
  cam.position.set(cx, box.min.y, cz + 50); cam.lookAt(cx, box.min.y, cz);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearAlpha();
  const env = renderer.toneMapping;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(0x000000, prevClear);
  renderer.toneMapping = env;
  const mat = new THREE.MeshStandardMaterial({ map: rt.texture, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, metalness: 0, color: 0xb8c4a8 });
  const q1 = new THREE.PlaneGeometry(w, h); q1.translate(0, h / 2 + box.min.y, 0);
  const q2 = q1.clone(); q2.rotateY(Math.PI / 2);
  const geo = mergeGeoms([q1, q2]);
  // нормали «вверх» — импостор освещается как крона, без тёмной изнанки
  const n = geo.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return { geo, mat, height: h };
}

// Импостер-«коробка» для зданий: 4 стороны рендерятся в атлас 2×2, крыша — тёмная
function makeBoxImpostor(parts) {
  const holder = new THREE.Group();
  for (const p of parts) holder.add(new THREE.Mesh(p.geometry, p.material));
  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const R = 1024, H = R / 2;
  const rt = new THREE.WebGLRenderTarget(R, R, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe8eef5, 0x777066, 1.9));
  const dl = new THREE.DirectionalLight(0xffffff, 1.2); dl.position.set(0.3, 1, 0.5); scene.add(dl);
  scene.add(holder);
  const prevT = renderer.getRenderTarget(), prevA = renderer.getClearAlpha(), prevC = renderer.getClearColor(new THREE.Color());
  renderer.setRenderTarget(rt); renderer.setClearColor(0x808080, 1); renderer.clear();
  const views = [ // [направление взгляда, ширина, квадрант]
    { dir: new THREE.Vector3(0, 0, -1), w: size.x, d: size.z, q: [0, 1] }, // фасад +Z
    { dir: new THREE.Vector3(0, 0, 1), w: size.x, d: size.z, q: [1, 1] }, // −Z
    { dir: new THREE.Vector3(-1, 0, 0), w: size.z, d: size.x, q: [0, 0] }, // +X
    { dir: new THREE.Vector3(1, 0, 0), w: size.z, d: size.x, q: [1, 0] }, // −X
  ];
  rt.scissorTest = true;
  for (const v of views) {
    const cam = new THREE.OrthographicCamera(-v.w / 2, v.w / 2, size.y / 2, -size.y / 2, 0.1, v.d + 200);
    cam.position.copy(c).addScaledVector(v.dir, -(v.d / 2 + 50)); cam.lookAt(c);
    rt.viewport.set(v.q[0] * H, v.q[1] * H, H, H); rt.scissor.set(v.q[0] * H, v.q[1] * H, H, H);
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
  }
  rt.scissorTest = false; rt.viewport.set(0, 0, R, R);
  renderer.setRenderTarget(prevT); renderer.setClearColor(prevC, prevA);
  holder.clear();
  // коробка с UV на квадранты
  const g = new THREE.BoxGeometry(size.x, size.y, size.z); g.translate(c.x, c.y, c.z);
  const uv = g.attributes.uv;
  // порядок граней BoxGeometry: +x, −x, +y, −y, +z, −z (по 4 вершины)
  const quad = { 0: [0, 0], 1: [1, 0], 4: [0, 1], 5: [1, 1] };
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    if (quad[f]) uv.setXY(i, (quad[f][0] + uv.getX(i)) / 2, (quad[f][1] + uv.getY(i)) / 2);
    else uv.setXY(i, 0.25, 0.25 + 0.0 * uv.getY(i));
  }
  const mat = new THREE.MeshStandardMaterial({ map: rt.texture, roughness: 0.9 });
  return { geo: g, mat };
}

export async function loadScenery(r) {
  renderer = r;
  const [pine, fir, small, shrub2, grass, fence, car, poles, factory] = await Promise.all(
    ['pine_tree_01', 'fir_tree_01', 'tree_small_02', 'shrub_02', 'grass_medium_01', 'modular_chainlink_fence', 'covered_car', 'modular_electricity_poles', 'modular_factory_facade'].map((n) => assets.model(n)));
  const addTree = (g, name, kind) => {
    if (!g) return;
    const node = g.scene.getObjectByName(name) || g.scene;
    const holder = new THREE.Group(); const c = node.clone(true); c.position.set(0, 0, 0); holder.add(c);
    holder.traverse((o) => { if (o.isMesh) { const m = o.material; if (m && m.transparent) { m.transparent = false; m.alphaTest = 0.4; } } });
    LIB.trees.push({ kind, parts: flattenModel(holder), imp: makeImpostor(holder) });
  };
  if (pine) for (const v of ['a', 'b', 'c']) addTree(pine, `pine_tree_01_${v}_LOD0`, 'pine');
  if (fir) for (const v of ['a', 'b', 'c']) addTree(fir, `fir_tree_01_${v}_LOD0`, 'fir');
  if (small) addTree(small, 'tree_small_02_LOD0', 'leaf');
  if (shrub2) for (const v of ['a', 'b', 'c', 'd']) { const p = nodeParts(shrub2, `shrub_02_${v}`); if (p) LIB.shrubs.push(p); }
  if (grass) for (const n of ['grass_medium_01_mid_a_LOD0', 'grass_medium_01_mid_c_LOD0', 'grass_medium_01_small_a_LOD0', 'grass_medium_01_tall_a_LOD0']) { const p = nodeParts(grass, n); if (p) LIB.grass.push(p); }
  if (fence) LIB.fence = nodeParts(fence, 'modular_chainlink_fence');
  if (car) { const holder = car.scene.clone(true); LIB.car = { parts: flattenModel(holder), box: new THREE.Box3().setFromObject(holder) }; }
  if (poles) LIB.poles = nodeParts(poles, 'pole') || null;
  if (factory) LIB.factory = factory;
  // жилые дома — готовые модели Sketchfab
  for (const h of await loadHouses()) { h.imp = makeBoxImpostor(h.parts); LIB.buildings.push(h); }
  // берёзы (Sketchfab)
  for (const b of await loadBirches()) {
    LIB.trees.push({ kind: 'birch', parts: b.parts, imp: makeImpostor(b.holder) });
  }
}

// ── процедурный панельный дом (запасной вариант, если нет моделей Sketchfab) ──
let facadeMats = null;
function facadeMaterials() {
  if (facadeMats) return facadeMats;
  const make = (seed, tint, stripe) => {
    const W = 1024, H = 1024; // 8×8 модулей окно/простенок (модуль 3.0 × 2.8 м)
    const rnd = mulberry32(seed);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const e = document.createElement('canvas'); e.width = W; e.height = H;
    const g = c.getContext('2d'), ge = e.getContext('2d');
    g.fillStyle = tint; g.fillRect(0, 0, W, H);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
    const mw = W / 8, mh = H / 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const px = x * mw, py = y * mh;
      // швы панелей
      g.strokeStyle = 'rgba(60,60,60,0.45)'; g.lineWidth = 2; g.strokeRect(px + 1, py + 1, mw - 2, mh - 2);
      if (stripe && y % 2 === 0) { g.fillStyle = stripe; g.fillRect(px, py + mh * 0.82, mw, mh * 0.18); }
      // окно
      const wx = px + mw * 0.22, wy = py + mh * 0.2, ww = mw * 0.56, wh = mh * 0.5;
      const lit = rnd() < 0.35;
      const curtain = rnd();
      g.fillStyle = '#e8e8e4'; g.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
      const glass = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
      glass.addColorStop(0, '#36475a'); glass.addColorStop(1, '#1d2733');
      g.fillStyle = glass; g.fillRect(wx, wy, ww, wh);
      if (curtain < 0.5) { g.fillStyle = `rgba(${180 + rnd() * 60},${150 + rnd() * 60},${120 + rnd() * 60},0.35)`; g.fillRect(wx, wy, ww * 0.35, wh); }
      g.fillStyle = '#f0f0ee'; g.fillRect(wx + ww / 2 - 2, wy, 4, wh); g.fillRect(wx, wy + wh * 0.3, ww, 3);
      if (lit) {
        const col = rnd() < 0.7 ? '#ffd9a0' : '#cfe0ff';
        ge.fillStyle = col; ge.fillRect(wx, wy, ww, wh);
        ge.fillStyle = 'rgba(0,0,0,0.6)'; ge.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      }
      // балкон в половине модулей
      if (x % 4 === 1 && rnd() < 0.85) {
        g.fillStyle = 'rgba(90,90,90,0.5)'; g.fillRect(px + mw * 0.12, py + mh * 0.72, mw * 0.76, mh * 0.2);
        g.fillStyle = tint; g.fillRect(px + mw * 0.12, py + mh * 0.74, mw * 0.76, mh * 0.16);
        g.strokeStyle = 'rgba(40,40,40,0.5)'; g.strokeRect(px + mw * 0.12, py + mh * 0.74, mw * 0.76, mh * 0.16);
      }
    }
    const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8;
    const em = new THREE.CanvasTexture(e); em.colorSpace = THREE.SRGBColorSpace; em.wrapS = em.wrapT = THREE.RepeatWrapping;
    const nor = assets.tex('concrete_panels', 'nor').clone(); nor.needsUpdate = true; nor.repeat.set(1, 1);
    return new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.85, normalMap: nor, normalScale: new THREE.Vector2(0.4, 0.4) });
  };
  facadeMats = {
    list: [make(11, '#d9d6cf', null), make(23, '#e6e2d8', '#8fa6c4'), make(37, '#cfcac0', '#b9897a'), make(41, '#e2e0dc', '#c9b37a'), make(53, '#bdb8ae', null)],
    roof: assets.pbr('rough_concrete', { repeat: 1, color: 0x7a7874 }),
    side: assets.pbr('concrete_panels', { repeat: 1, color: 0xd8d4cc }),
  };
  return facadeMats;
}

function panelHouseGeo(floors, sections) {
  // фасад: модуль 3.0 м × 2.8 м, секция = 6 модулей; глубина 12 м
  const L = sections * 6 * 3.0, H = floors * 2.8 + 0.6, D = 12;
  const box = new THREE.BoxGeometry(L, H, D);
  box.translate(0, H / 2, 0);
  // UV в модулях (текстура — 8×8 модулей)
  const pos = box.attributes.position, nor = box.attributes.normal, uv = box.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const nx = nor.getX(i), ny = nor.getY(i);
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (Math.abs(ny) > 0.5) uv.setXY(i, x / 10, z / 10);
    else if (Math.abs(nx) > 0.5) uv.setXY(i, z / 24, y / 22.4);
    else uv.setXY(i, x / 24, y / 22.4);
  }
  // группы: 0 — фасады ±Z, 1 — торцы ±X, 2 — крыша/низ
  box.clearGroups();
  // порядок граней BoxGeometry: +x, -x, +y, -y, +z, -z (по 6 индексов ×... ) — 6 вершин на грань в индексах
  box.addGroup(0, 12, 1); box.addGroup(12, 12, 2); box.addGroup(24, 12, 0);
  return box;
}

// ── бетонный забор ПО-2 ──
let concreteFence = null;
function fenceMat() {
  if (concreteFence) return concreteFence;
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#a8a59c'; g.fillRect(0, 0, 512, 256);
  for (let y = 0; y < 256; y += 32) for (let x = (y / 32) % 2 ? 16 : 0; x < 512; x += 32) {
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); g.moveTo(x + 16, y); g.lineTo(x + 32, y + 16); g.lineTo(x + 16, y + 32); g.lineTo(x, y + 16); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, 4, 256); g.fillRect(508, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const nor = assets.tex('rough_concrete', 'nor').clone(); nor.needsUpdate = true; nor.repeat.set(2, 1);
  concreteFence = new THREE.MeshStandardMaterial({ map: t, normalMap: nor, roughness: 0.95 });
  return concreteFence;
}

let barrierMats = null;
function barrierMaterials() {
  if (barrierMats) return barrierMats;
  barrierMats = {
    panel: assets.pbr('metal_plate', { repeat: 1, color: 0x6f8f9c, metalness: 1, side: THREE.DoubleSide }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9fc6cf, roughness: 0.1, transparent: true, opacity: 0.3, side: THREE.DoubleSide }),
    post: new THREE.MeshStandardMaterial({ color: 0x4d5258, metalness: 0.8, roughness: 0.5 }),
    asphalt: assets.pbr('asphalt_02', { repeat: 1 }),
    garage: assets.pbr('corrugated_iron_02', { repeat: 1, color: 0x8f8a80 }),
    brick: assets.pbr('red_brick', { repeat: 1 }),
  };
  return barrierMats;
}

function instanced(group, parts, mats, { cast = false, receive = true } = {}) {
  if (!parts || !mats.length) return;
  for (const p of parts) {
    const im = new THREE.InstancedMesh(p.geometry, p.material, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = cast; im.receiveShadow = receive;
    im.computeBoundingSphere();
    group.add(im);
  }
}

export function zoneAt(route, s) {
  const p = route.point(s, 0, 0);
  const dc = Math.hypot(p.x, p.z);
  let dSt = Infinity, hub = false;
  for (const st of route.stations) { const d = Math.abs(st.s - s); if (d < dSt) { dSt = d; hub = st.hub; } }
  if (dc < 14000) return 'city';
  if (dSt < (hub ? 1800 : 1100)) return 'town';
  return 'forest';
}

// Строит окружение для чанка. Возвращает {near, far} — near скрывается для дальних чанков.
export function buildScenery(route, s0, s1, origin, { season = 'summer' } = {}) {
  const near = new THREE.Group(), far = new THREE.Group(), always = new THREE.Group();
  const rnd = mulberry32(hashStr(route.id + ':' + Math.round(s0)));
  const zone = zoneAt(route, (s0 + s1) / 2);
  const treesFull = LIB.trees.map(() => []), treesImp = LIB.trees.map(() => []);
  const shrubs = LIB.shrubs.map(() => []), grass = LIB.grass.map(() => []);
  const fences = [], cars = [], buildingsSk = LIB.buildings.map(() => []);
  const procHouses = [];
  const m = new THREE.Matrix4();
  const occupied = []; // занятые прямоугольники (s, lat) для зданий
  const free = (s, lat, r) => !occupied.some((o) => Math.abs(o.s - s) < o.r + r && Math.abs(o.lat - lat) < o.r + r);
  const stationNear = (s, pad) => route.stations.some((st) => Math.abs(st.s - s) < st.platformLength / 2 + pad);
  const winter = season === 'winter';
  const leafOK = (k) => !(winter && (LIB.trees[k].kind === 'leaf' || LIB.trees[k].kind === 'birch'));

  for (const side of [-1, 1]) {
    const base = (s) => Math.abs(route.trackOffset(s, side)) + 3.4;
    // ограждения
    const fenceType = zone === 'city' ? (rnd() < 0.6 ? 'concrete' : 'barrier') : zone === 'town' ? (rnd() < 0.5 ? 'concrete' : 'none') : 'none';
    const fenceLat = (s) => side * (base(s) + 7 + (stationNear(s, 0) ? 12 : 0));
    if (fenceType === 'concrete' || fenceType === 'barrier') {
      const H = fenceType === 'concrete' ? 2.5 : 4.2;
      const g = sweep(route, s0, s1, 4, (s) => [{ lat: fenceLat(s), h: -1.1 }, { lat: fenceLat(s), h: -1.1 + H }], origin, { uScale: 1 / H, vScale: 1 / 4, flipNormals: side > 0 });
      const g2 = sweep(route, s0, s1, 4, (s) => [{ lat: fenceLat(s) + side * 0.12, h: -1.1 }, { lat: fenceLat(s) + side * 0.12, h: -1.1 + H }], origin, { uScale: 1 / H, vScale: 1 / 4, flipNormals: side < 0 });
      if (fenceType === 'concrete') {
        const mat = fenceMat();
        always.add(new THREE.Mesh(g, mat), new THREE.Mesh(g2, mat));
      } else {
        const bm = barrierMaterials();
        const low = sweep(route, s0, s1, 4, (s) => [{ lat: fenceLat(s), h: -1.1 }, { lat: fenceLat(s), h: 1.6 }], origin, { uScale: 0.5, vScale: 0.5, flipNormals: side > 0 });
        const top = sweep(route, s0, s1, 4, (s) => [{ lat: fenceLat(s), h: 1.6 }, { lat: fenceLat(s), h: 3.1 }], origin, { flipNormals: side > 0 });
        always.add(new THREE.Mesh(low, bm.panel), new THREE.Mesh(top, bm.glass));
        const posts = [];
        for (let s = Math.ceil(s0 / 3) * 3; s < s1; s += 3) posts.push(placeMatrix(route, s, fenceLat(s), -1.1, origin));
        const pg = new THREE.BoxGeometry(0.16, 4.3, 0.16); pg.translate(0, 2.15, 0);
        const pm = new THREE.InstancedMesh(pg, bm.post, posts.length); posts.forEach((mm, i) => pm.setMatrixAt(i, mm)); always.add(pm);
      }
      for (const mm of always.children) { mm.castShadow = true; mm.receiveShadow = true; }
    } else if (fenceType === 'chain' && LIB.fence) {
      const w = LIB.fence.box.max.x - LIB.fence.box.min.x || 2;
      for (let s = Math.ceil(s0 / w) * w; s < s1; s += w) fences.push(placeMatrix(route, s, fenceLat(s), terrainH(route, s, fenceLat(s)) - 0.05, origin, { yaw: Math.PI / 2 }));
    }

    // здания
    if (zone !== 'forest') {
      let s = s0 + rnd() * 30;
      while (s < s1) {
        const lat = side * (base(s) + (zone === 'city' ? 38 : 45) + rnd() * (zone === 'city' ? 70 : 90));
        if (!stationNear(s, 40) || Math.abs(lat) > 60) {
          const r = 22;
          if (free(s, lat, r)) {
            occupied.push({ s, lat, r });
            const yaw = (side > 0 ? -Math.PI / 2 : Math.PI / 2) + (rnd() < 0.3 ? Math.PI / 2 : 0) + (rnd() - 0.5) * 0.1;
            const h = terrainH(route, s, lat);
            const fit = LIB.buildings.map((b, k) => k).filter((k) => LIB.buildings[k].zone.includes(zone) && (!LIB.buildings[k].rare || rnd() < 0.15));
            if (fit.length) {
              const k = fit[Math.floor(rnd() * fit.length)];
              const B = LIB.buildings[k];
              const off = Math.sign(lat) * Math.max(0, B.radius - 22);
              buildingsSk[k].push(placeMatrix(route, s, lat + off, terrainH(route, s, lat + off) - 0.3, origin, { yaw }));
              occupied.push({ s, lat: lat + off, r: B.radius });
            } else {
              const floors = zone === 'city' ? [9, 12, 14, 16, 17, 22][Math.floor(rnd() * 6)] : [5, 5, 9, 9, 12, 14][Math.floor(rnd() * 6)];
              const sections = 1 + Math.floor(rnd() * (floors > 14 ? 2 : 4));
              procHouses.push({ m: placeMatrix(route, s, lat, h - 0.3, origin, { yaw }), floors, sections, mat: Math.floor(rnd() * 5) });
            }
            // машины у дома
            if (LIB.car && rnd() < 0.35) for (let k = 0; k < 1 + rnd() * 2; k++) {
              const cs = s + (rnd() - 0.5) * 30, cl = lat - side * (14 + rnd() * 4);
              cars.push(placeMatrix(route, cs, cl, terrainH(route, cs, cl), origin, { yaw: rnd() < 0.5 ? 0 : Math.PI }));
            }
          }
        }
        s += zone === 'city' ? 45 + rnd() * 35 : 70 + rnd() * 80;
      }
    }

    // деревья
    const density = zone === 'forest' ? 1.0 : zone === 'town' ? 0.35 : 0.18;
    const area = (s1 - s0) * 170;
    const nTrees = Math.round((area / 55) * density);
    for (let i = 0; i < nTrees; i++) {
      const s = s0 + rnd() * (s1 - s0);
      const d = 14 + Math.pow(rnd(), 0.8) * 160;
      const lat = side * (base(s) + d);
      if (stationNear(s, 30) && d < 40) continue;
      if (!free(s, lat, 3)) continue;
      let k = Math.floor(rnd() * LIB.trees.length);
      if (!LIB.trees.length) break;
      if (!leafOK(k)) k = 0;
      const birches = LIB.trees.map((t, i) => (t.kind === 'birch' ? i : -1)).filter((i) => i >= 0);
      if (birches.length && !winter && rnd() < (zone === 'forest' ? 0.4 : 0.6)) k = birches[Math.floor(rnd() * birches.length)];
      const sc = 0.75 + rnd() * 0.55;
      const mm = placeMatrix(route, s, lat, terrainH(route, s, lat) - 0.1, origin, { yaw: rnd() * 6.28, scale: sc });
      if (d < 45) treesFull[k].push(mm); else treesImp[k].push(mm);
    }
    // кустарник и трава у пути
    if (!winter) {
      for (let i = 0; i < (s1 - s0) / 9; i++) {
        const s = s0 + rnd() * (s1 - s0);
        if (stationNear(s, 15)) continue;
        const lat = side * (base(s) + 2 + rnd() * 12);
        if (LIB.shrubs.length && rnd() < 0.35) { const k = Math.floor(rnd() * LIB.shrubs.length); shrubs[k].push(placeMatrix(route, s, lat, -1.05, origin, { yaw: rnd() * 6.28, scale: 0.8 + rnd() * 0.6 })); }
        if (LIB.grass.length) for (let j = 0; j < 3; j++) { const k = Math.floor(rnd() * LIB.grass.length); grass[k].push(placeMatrix(route, s + rnd() * 6, side * (base(s) + 1 + rnd() * 9), -1.02, origin, { yaw: rnd() * 6.28, scale: 0.8 + rnd() * 0.8 })); }
      }
    }
  }

  LIB.trees.forEach((t, k) => {
    instanced(near, t.parts, treesFull[k], { cast: true });
    // в дальнем режиме ближние деревья тоже импостеры
    const impAll = treesImp[k].filter(Boolean);
    const im = new THREE.InstancedMesh(t.imp.geo, t.imp.mat, Math.max(1, impAll.length + treesFull[k].length));
    let i = 0;
    for (const mm of impAll) im.setMatrixAt(i++, mm);
    const farOnlyCount = i;
    for (const mm of treesFull[k]) im.setMatrixAt(i++, mm);
    im.count = i;
    im.userData.nearCount = farOnlyCount; // в ближнем режиме рисуем только дальние
    im.userData.isImpostor = true;
    im.computeBoundingSphere();
    always.add(im);
  });
  LIB.shrubs.forEach((p, k) => instanced(near, p.parts, shrubs[k]));
  LIB.grass.forEach((p, k) => instanced(near, p.parts, grass[k]));
  if (LIB.fence) instanced(always, LIB.fence.parts, fences, { cast: true });
  if (LIB.car) instanced(always, LIB.car.parts, cars, { cast: true });
  LIB.buildings.forEach((b, k) => {
    instanced(near, b.parts, buildingsSk[k], { cast: true });
    if (b.imp) instanced(far, [{ geometry: b.imp.geo, material: b.imp.mat }], buildingsSk[k], { cast: false });
  });
  if (procHouses.length) {
    const fm = facadeMaterials();
    for (const ph of procHouses) {
      const mesh = new THREE.Mesh(panelHouseGeo(ph.floors, ph.sections), [fm.list[ph.mat], fm.side, fm.roof]);
      mesh.applyMatrix4(ph.m);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.house = true;
      always.add(mesh);
    }
  }
  return { near, far, always, zone };
}

export function setNightWindows(night) {
  if (!facadeMats) return;
  for (const m of facadeMats.list) m.emissiveIntensity = night * 1.4;
}
