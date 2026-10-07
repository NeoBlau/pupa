// Внешняя модель состава. Если скачана модель Sketchfab (см. tools/sketchfab-models.json) — используется она;
// иначе — запасная процедурная модель вагона (кузов по сечению, ливрея, остекление, двери, тележки, токоприёмник).
// Запасная модель — не готовый ассет и так и обозначается в интерфейсе.
import * as THREE from 'three';
import { assets, flattenModel } from '../core/assets.js';
import { hasRealTrain, loadRealTrain, instantiate } from '../core/realModels.js';
import { carLengths, isHeadCar } from '../data/trains.js';
import { mergeGeoms, tf } from '../world/geom.js';

const FLOOR = 1.33;

// полусечение кузова (x, y) от низа к крыше
function halfProfile(w2) {
  return [
    [0, 0.98], [w2 - 0.12, 0.98], [w2 - 0.02, 1.12], [w2, 1.4], [w2, 3.0], [w2 - 0.05, 3.3], [w2 - 0.16, 3.62],
    [w2 - 0.38, 3.9], [w2 - 0.75, 4.07], [w2 - 1.2, 4.15], [0, 4.2],
  ];
}

const livCache = new Map();
function liveryCanvas(spec, side) {
  const ck = spec.id;
  if (livCache.has(ck)) return livCache.get(ck);
  const W = 2048, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const L = spec.livery;
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  // v: 0 — низ кузова (0.98 м), 1 — крыша по центру. Пересчёт высоты в пиксели по стороне 0.98…3.62 → 0…0.7
  const yOf = (h) => H - ((h - 0.98) / (4.2 - 0.98)) * H;
  g.fillStyle = hex(L.body); g.fillRect(0, 0, W, H);
  g.fillStyle = hex(L.roof); g.fillRect(0, 0, W, yOf(3.62));
  g.fillStyle = hex(L.lower); g.fillRect(0, yOf(1.32), W, H - yOf(1.32));
  g.fillStyle = hex(L.stripe); g.fillRect(0, yOf(1.62), W, yOf(1.32) - yOf(1.62));
  g.fillStyle = hex(L.stripe); g.fillRect(0, yOf(3.18), W, 10);
  // логотип МЦД
  g.font = 'bold 54px "Segoe UI", Arial'; g.fillStyle = '#d2232a'; g.textBaseline = 'middle';
  g.fillText('МЦД', W * 0.44, yOf(1.82));
  g.fillStyle = '#333'; g.font = '600 28px "Segoe UI", Arial';
  g.fillText(`${spec.short}`, W * 0.06, yOf(1.82));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const res = { tex, yOf, W, H };
  livCache.set(ck, res);
  return res;
}

// Альфа-маска окон и дверных проёмов (окна вырезаются — за ними салон)
const maskCache = new Map();
function maskCanvas(spec, doors, Lb) {
  const mk = spec.id + ':' + Lb.toFixed(2);
  if (maskCache.has(mk)) return maskCache.get(mk);
  const W = 1024, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const yOf = (h) => H - ((h - 0.98) / (4.2 - 0.98)) * H;
  const xOf = (z) => ((z + Lb / 2) / Lb) * W;
  g.fillStyle = '#000';
  // окна между дверями
  const winTop = 3.05, winBot = 1.98;
  const dw = spec.doorWidth;
  const doorZ = doors;
  let z = -Lb / 2 + 1.1;
  const blocks = [];
  const edges = [-Lb / 2 + 0.9, ...doorZ.flatMap((d) => [d - dw / 2 - 0.3, d + dw / 2 + 0.3]), Lb / 2 - 0.9];
  for (let i = 0; i < edges.length; i += 2) blocks.push([edges[i], edges[i + 1]]);
  for (const [a, b] of blocks) {
    const n = Math.max(1, Math.round((b - a) / 1.9));
    const w = (b - a) / n;
    for (let k = 0; k < n; k++) {
      const x0 = xOf(a + k * w + 0.08), x1 = xOf(a + (k + 1) * w - 0.08);
      g.beginPath(); g.roundRect(x0, yOf(winTop), x1 - x0, yOf(winBot) - yOf(winTop), 6); g.fill();
    }
  }
  // дверные проёмы
  for (const d of doorZ) g.fillRect(xOf(d - dw / 2), yOf(FLOOR + 2.0), xOf(d + dw / 2) - xOf(d - dw / 2), yOf(FLOOR - 0.05) - yOf(FLOOR + 2.0));
  void z;
  const t = new THREE.CanvasTexture(c);
  const res = { tex: t, winTop, winBot };
  maskCache.set(mk, res);
  return res;
}

function bodyGeometry(Lb, w2) {
  const hp = halfProfile(w2);
  // полный контур: правая сторона снизу вверх, затем левая сверху вниз
  const right = hp;
  const left = [...hp].reverse().map(([x, y]) => [-x, y]);
  const prof = [...right, ...left.slice(1)];
  // v-координата: по высоте (для ливреи), сторона определяется знаком x
  const rings = 2;
  const pos = [], uv = [], idx = [];
  for (let r = 0; r < rings; r++) {
    const z = -Lb / 2 + (Lb * r) / (rings - 1);
    for (const [x, y] of prof) {
      pos.push(x, y, z);
      const v = (y - 0.98) / (4.2 - 0.98);
      const u = x >= 0 ? (Lb / 2 - z) / Lb : (z + Lb / 2) / Lb;
      uv.push(u, v);
    }
  }
  const m = prof.length;
  for (let k = 0; k < m - 1; k++) {
    const a = k, b = k + 1, c = m + k, d = m + k + 1;
    idx.push(a, b, c, b, d, c);
  }
  // u на правой стороне идёт в обратную сторону — разрываем швы по оси (вершины на x=0 общие для обеих сторон)
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  // для левой половины перенастраиваем u, т.к. общие вершины на крыше/дне делили значения
  const p = ng.attributes.position, u2 = ng.attributes.uv;
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    for (let k = 0; k < 3; k++) {
      const z = p.getZ(i + k);
      u2.setX(i + k, cx >= 0 ? (Lb / 2 - z) / Lb : (z + Lb / 2) / Lb);
    }
  }
  ng.computeVertexNormals();
  // сглаживание нормалей по профилю: пересчёт с индексами по позициям
  return smoothNormals(ng);
}

function smoothNormals(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  const map = new Map();
  const key = (i) => `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)},${Math.sign(p.getX(i))}`;
  for (let i = 0; i < p.count; i++) {
    const k = key(i);
    const a = map.get(k) || [0, 0, 0];
    a[0] += n.getX(i); a[1] += n.getY(i); a[2] += n.getZ(i);
    map.set(k, a);
  }
  for (let i = 0; i < p.count; i++) {
    const a = map.get(key(i)); const l = Math.hypot(a[0], a[1], a[2]) || 1;
    // не сглаживаем резкий переход низ/борт
    n.setXYZ(i, a[0] / l, a[1] / l, a[2] / l);
  }
  return g;
}

// Кабина: лофт сечения кузова в обтекаемую «морду»
function noseGeometry(w2, len) {
  const hp = halfProfile(w2);
  const prof = [...hp, ...[...hp].reverse().slice(1).map(([x, y]) => [-x, y])];
  const R = 10;
  const pos = [], uv = [], idx = [];
  for (let r = 0; r <= R; r++) {
    const t = r / R;
    const z = -t * len;
    const sx = 1 - 0.22 * Math.pow(t, 2.2);
    const top = 4.2 - 1.15 * Math.pow(t, 1.6);
    const bot = 0.98 + 0.1 * t;
    for (const [x, y] of prof) {
      const yy = bot + ((y - 0.98) / (4.2 - 0.98)) * (top - bot);
      // скругление углов по мере сужения
      const xx = x * sx * (1 - 0.15 * t * Math.pow(Math.abs(y - 2.4) / 1.8, 2));
      pos.push(xx, yy, z);
      uv.push((x / w2) * 0.5 + 0.5, (yy - 0.98) / 3.3);
    }
  }
  const m = prof.length;
  for (let r = 0; r < R; r++) for (let k = 0; k < m - 1; k++) {
    const a = r * m + k, b = r * m + k + 1, c = (r + 1) * m + k, d = (r + 1) * m + k + 1;
    idx.push(a, c, b, b, c, d);
  }
  // торцевая крышка
  const base = pos.length / 3;
  const last = R * m;
  let cx = 0, cy = 0;
  for (let k = 0; k < m; k++) { cx += pos[(last + k) * 3]; cy += pos[(last + k) * 3 + 1]; }
  pos.push(cx / m, cy / m, -len - 0.08); uv.push(0.5, 0.45);
  for (let k = 0; k < m - 1; k++) idx.push(last + k, base, last + k + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function noseTexture(spec) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  g.fillStyle = hex(spec.livery.front); g.fillRect(0, 0, 512, 512);
  // лобовое стекло (v ≈ 0.42..0.85)
  g.fillStyle = '#0d1418';
  g.beginPath(); g.roundRect(70, 512 * (1 - 0.86), 372, 512 * 0.38, 30); g.fill();
  g.fillStyle = hex(spec.livery.lower); g.fillRect(0, 512 * (1 - 0.12), 512, 512 * 0.12);
  g.fillStyle = hex(spec.livery.body); g.fillRect(0, 512 * (1 - 0.3), 512, 14);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  // карта шероховатости: стекло гладкое
  const r = document.createElement('canvas'); r.width = r.height = 256;
  const rg = r.getContext('2d'); rg.fillStyle = 'rgb(0,110,0)'; rg.fillRect(0, 0, 256, 256);
  rg.fillStyle = 'rgb(0,8,0)'; rg.beginPath(); rg.roundRect(35, 256 * (1 - 0.86), 186, 256 * 0.38, 15); rg.fill();
  const rt = new THREE.CanvasTexture(r);
  return { map: t, rough: rt };
}

const matCache = new Map();
const geoCache = new Map();
let shared = null;
function sharedParts() {
  if (shared) return shared;
  const steel = new THREE.MeshStandardMaterial({ color: 0x2c2e31, roughness: 0.55, metalness: 0.7 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x6d6e70, roughness: 0.35, metalness: 1 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x3a4a52, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.38, envMapIntensity: 1.6, side: THREE.DoubleSide });
  const interiorWall = new THREE.MeshStandardMaterial({ color: 0xe9e8e4, roughness: 0.6 });
  const floor = assets.pbr('rough_concrete', { repeat: 1, color: 0x5d636b, roughness: 0.8 });
  const seatFabric = new THREE.MeshStandardMaterial({ color: 0x2b4a8a, roughness: 0.95 });
  const seatShell = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.5, metalness: 0.2 });
  const pole = new THREE.MeshStandardMaterial({ color: 0xd8b818, roughness: 0.35, metalness: 0.4 });
  const lightStrip = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f8ff, emissiveIntensity: 1.6 });
  const headlight = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 0 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a10, emissiveIntensity: 0 });
  // колёсная пара и тележка
  const wheel = new THREE.CylinderGeometry(0.425, 0.425, 0.13, 24); wheel.rotateZ(Math.PI / 2);
  const axle = new THREE.CylinderGeometry(0.08, 0.08, 1.6, 10); axle.rotateZ(Math.PI / 2);
  const wheelset = mergeGeoms([tf(wheel.clone(), { x: -0.76 }), tf(wheel.clone(), { x: 0.76 }), axle]);
  const frame = mergeGeoms([
    tf(new THREE.BoxGeometry(0.22, 0.35, 2.9), { x: -1.0, y: 0.62 }), tf(new THREE.BoxGeometry(0.22, 0.35, 2.9), { x: 1.0, y: 0.62 }),
    tf(new THREE.BoxGeometry(2.2, 0.3, 0.5), { y: 0.66 }),
    tf(new THREE.CylinderGeometry(0.11, 0.11, 0.32, 10), { x: -1.0, y: 0.92, z: 0.6 }), tf(new THREE.CylinderGeometry(0.11, 0.11, 0.32, 10), { x: 1.0, y: 0.92, z: 0.6 }),
    tf(new THREE.CylinderGeometry(0.11, 0.11, 0.32, 10), { x: -1.0, y: 0.92, z: -0.6 }), tf(new THREE.CylinderGeometry(0.11, 0.11, 0.32, 10), { x: 1.0, y: 0.92, z: -0.6 }),
    tf(new THREE.BoxGeometry(0.3, 0.25, 0.3), { x: -1.05, y: 0.42, z: 1.25 }), tf(new THREE.BoxGeometry(0.3, 0.25, 0.3), { x: 1.05, y: 0.42, z: 1.25 }),
    tf(new THREE.BoxGeometry(0.3, 0.25, 0.3), { x: -1.05, y: 0.42, z: -1.25 }), tf(new THREE.BoxGeometry(0.3, 0.25, 0.3), { x: 1.05, y: 0.42, z: -1.25 }),
  ]);
  // сиденье 2+3 (Desiro RUS) — сварной блок
  const seat = (n) => mergeGeoms(Array.from({ length: n }, (_, i) => [
    tf(new THREE.BoxGeometry(0.46, 0.1, 0.46), { x: i * 0.5, y: 0.46 }),
    tf(new THREE.BoxGeometry(0.46, 0.62, 0.08), { x: i * 0.5, y: 0.82, z: 0.21, rx: -0.12 }),
  ]).flat());
  const seatLeg = mergeGeoms([tf(new THREE.BoxGeometry(0.05, 0.42, 0.3), { y: 0.21 })]);
  shared = { steel, wheelMat, rubber, glass, interiorWall, floor, seatFabric, seatShell, pole, lightStrip, headlight, tail, wheelset, frame, seat2: seat(2), seat3: seat(3), seatLeg };
  return shared;
}

// Пантограф (полупантограф), складывается по value 0…1
function pantograph() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x9da2a8, metalness: 0.9, roughness: 0.35 });
  const ins = new THREE.MeshStandardMaterial({ color: 0x6a3b28, roughness: 0.4 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 1.6), m); g.add(base);
  for (const x of [-0.6, 0.6]) for (const z of [-0.7, 0.7]) { const i = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 10), ins); i.position.set(x, -0.15, z); g.add(i); }
  const lower = new THREE.Group(); lower.position.set(0, 0.1, 0.6); g.add(lower);
  const la = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.7, 8), m); la.position.y = 0.85; lower.add(la);
  const upper = new THREE.Group(); upper.position.y = 1.7; lower.add(upper);
  const ua = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.7, 8), m); ua.position.y = 0.85; upper.add(ua);
  const head = new THREE.Group(); head.position.y = 1.7; upper.add(head);
  const bow = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.08), m); head.add(bow);
  const horn = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 6, 12, Math.PI), m); horn.position.set(-1.0, -0.12, 0); horn.rotation.z = Math.PI / 2; head.add(horn);
  const horn2 = horn.clone(); horn2.position.x = 1.0; horn2.rotation.z = -Math.PI / 2; head.add(horn2);
  g.userData.set = (v) => {
    // v=1 — поднят: высота токосъёма ≈ 6.1 − 4.25 = 1.85 м над основанием
    const a1 = THREE.MathUtils.lerp(-1.48, -0.62, v);
    lower.rotation.x = a1;
    upper.rotation.x = THREE.MathUtils.lerp(2.9, 1.45, v) - 0.0;
    head.rotation.x = -(a1 + upper.rotation.x);
  };
  g.userData.set(1);
  return g;
}

function buildProceduralCar(spec, idx, cars, { cab = false } = {}) {
  const P = sharedParts();
  const L = spec.carLength, Lb = L - (cab ? 2.6 : 0.7), w2 = spec.carWidth / 2;
  const car = new THREE.Group();
  const body = new THREE.Group();
  car.add(body);
  const bodyZ = cab ? 0.95 : 0; // кузов головного смещён назад, перед — кабина
  body.position.z = bodyZ;
  const n = spec.doorsPerSide;
  const doorZ = n === 2 ? [-Lb / 4 - 0.4, Lb / 4 + 0.4] : [-Lb / 3, 0, Lb / 3];
  const liv = liveryCanvas(spec, idx);
  const mask = maskCanvas(spec, doorZ.map((z) => -z), Lb); // u растёт к −z на правом борту
  const maskL = maskCanvas(spec, doorZ, Lb);
  void maskL;
  const bodyMat = matCache.get(spec.id + ':body:' + Lb.toFixed(2)) || new THREE.MeshPhysicalMaterial({ map: liv.tex, alphaMap: mask.tex, alphaTest: 0.5, roughness: 0.32, metalness: 0.15, clearcoat: 0.6, clearcoatRoughness: 0.25, side: THREE.DoubleSide });
  matCache.set(spec.id + ':body:' + Lb.toFixed(2), bodyMat);
  const bg = geoCache.get('body:' + Lb.toFixed(2)) || bodyGeometry(Lb, w2);
  geoCache.set('body:' + Lb.toFixed(2), bg);
  const bm = new THREE.Mesh(bg, bodyMat); bm.castShadow = true; bm.receiveShadow = true; body.add(bm);
  // торцевые стенки (межвагонные переходы)
  for (const e of [-1, 1]) {
    if (cab && e < 0) continue;
    const endG = new THREE.ShapeGeometry(new THREE.Shape(halfProfile(w2).concat([...halfProfile(w2)].reverse().map(([x, y]) => [-x, y])).map(([x, y]) => new THREE.Vector2(x, y))));
    const em = new THREE.Mesh(endG, new THREE.MeshStandardMaterial({ color: spec.livery.body, roughness: 0.5, side: THREE.DoubleSide }));
    em.position.z = e * Lb / 2; body.add(em);
    const bellow = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.4, 0.4), P.rubber); bellow.position.set(0, FLOOR + 1.15, e * (Lb / 2 + 0.18)); body.add(bellow);
  }
  // остекление
  for (const sx of [-1, 1]) {
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(Lb - 1.6, mask.winTop - mask.winBot + 0.1), P.glass);
    gl.position.set(sx * (w2 - 0.03), (mask.winTop + mask.winBot) / 2, 0); gl.rotation.y = sx * Math.PI / 2;
    body.add(gl);
  }
  // двери: по две створки, прислонно-сдвижные
  const doorTex = matCache.get(spec.id + ':doorTex') || (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 512; const g = c.getContext('2d');
    const hex = (k) => '#' + k.toString(16).padStart(6, '0');
    g.fillStyle = hex(spec.livery.stripe); g.fillRect(0, 0, 128, 512);
    g.fillStyle = '#10161b'; g.beginPath(); g.roundRect(18, 40, 92, 230, 10); g.fill();
    g.fillStyle = '#222'; g.fillRect(0, 0, 4, 512);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  matCache.set(spec.id + ':doorTex', doorTex);
  const doorMat = matCache.get(spec.id + ':door') || new THREE.MeshPhysicalMaterial({ map: doorTex, roughness: 0.3, metalness: 0.2, clearcoat: 0.5 });
  matCache.set(spec.id + ':door', doorMat);
  const leafW = spec.doorWidth / 2, leafH = 2.0;
  const leafG = new THREE.BoxGeometry(0.05, leafH, leafW);
  const doors = { left: [], right: [] };
  for (const z of doorZ) for (const sx of [-1, 1]) for (const lr of [-1, 1]) {
    const leaf = new THREE.Mesh(leafG, doorMat);
    const base = new THREE.Vector3(sx * (w2 + 0.01), FLOOR + leafH / 2 + 0.02, z + lr * leafW / 2);
    leaf.position.copy(base);
    leaf.userData = { base, lr, sx };
    leaf.castShadow = true;
    body.add(leaf);
    (sx < 0 ? doors.left : doors.right).push(leaf);
  }
  // салон: пол, потолок со светильниками, сиденья, поручни
  const interior = new THREE.Group();
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(2 * w2 - 0.2, Lb - 0.2), P.floor); fl.rotation.x = -Math.PI / 2; fl.position.y = FLOOR; fl.receiveShadow = true; interior.add(fl);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(2 * w2 - 0.6, Lb - 0.2), P.interiorWall); ceil.rotation.x = Math.PI / 2; ceil.position.y = 3.55; interior.add(ceil);
  for (const x of [-0.75, 0.75]) { const ls = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, Lb - 1.0), P.lightStrip); ls.position.set(x, 3.53, 0); interior.add(ls); }
  const lowWall = new THREE.Mesh(new THREE.PlaneGeometry(Lb - 0.2, mask.winBot - FLOOR), P.interiorWall);
  for (const sx of [-1, 1]) { const w = lowWall.clone(); w.position.set(sx * (w2 - 0.08), (mask.winBot + FLOOR) / 2, 0); w.rotation.y = -sx * Math.PI / 2; interior.add(w); }
  const seatPos2 = [], seatPos3 = [];
  for (let z = -Lb / 2 + 1.2; z < Lb / 2 - 1.0; z += 0.95) {
    if (doorZ.some((d) => Math.abs(z - d) < spec.doorWidth / 2 + 0.7)) continue;
    const flip = Math.floor((z + 100) / 0.95) % 2 ? 0 : Math.PI;
    seatPos3.push(new THREE.Matrix4().compose(new THREE.Vector3(flip ? -0.42 : -1.42, FLOOR, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, flip, 0)), new THREE.Vector3(1, 1, 1)));
    seatPos2.push(new THREE.Matrix4().compose(new THREE.Vector3(flip ? 1.45 : 0.95, FLOOR, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, flip, 0)), new THREE.Vector3(1, 1, 1)));
  }
  const s3 = new THREE.InstancedMesh(P.seat3, P.seatFabric, seatPos3.length); seatPos3.forEach((m, i) => s3.setMatrixAt(i, m)); interior.add(s3);
  const s2 = new THREE.InstancedMesh(P.seat2, P.seatFabric, seatPos2.length); seatPos2.forEach((m, i) => s2.setMatrixAt(i, m)); interior.add(s2);
  for (const z of doorZ) for (const sx of [-1, 1]) {
    const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.2, 8), P.pole); pl.position.set(sx * 0.4, FLOOR + 1.1, z + 0.9); interior.add(pl);
    const pl2 = pl.clone(); pl2.position.z = z - 0.9; interior.add(pl2);
  }
  body.add(interior);
  // подвагонное оборудование
  const under = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.55, Lb * 0.42), P.steel); under.position.set(0, 0.75, 0); body.add(under);
  // крышевое оборудование
  const ac = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 3.2), new THREE.MeshStandardMaterial({ color: 0xa6abb1, roughness: 0.5, metalness: 0.6 }));
  ac.position.set(0, 4.3, Lb / 4); ac.castShadow = true; body.add(ac);
  let panto = null;
  if (idx % 5 === 1 || idx % 5 === 3 || (spec.id === 'ed4m' && idx % 2 === 1)) {
    panto = pantograph(); panto.position.set(0, 4.32, -Lb / 4); body.add(panto);
  }
  // тележки
  const bogies = [];
  for (const bz of [-(L / 2 - 3.2), L / 2 - 3.2]) {
    const bog = new THREE.Group(); bog.position.set(0, 0, bz);
    const fr = new THREE.Mesh(P.frame, P.steel); fr.castShadow = true; bog.add(fr);
    for (const az of [-1.25, 1.25]) { const ws = new THREE.Mesh(P.wheelset, P.wheelMat); ws.position.set(0, 0.425, az); ws.userData.wheel = true; bog.add(ws); }
    car.add(bog); bogies.push(bog);
  }
  // кабина
  let headlights = null, taillights = null, cabNose = null;
  if (cab) {
    const noseMat = matCache.get(spec.id + ':nose') || (() => { const nt = noseTexture(spec); return new THREE.MeshPhysicalMaterial({ map: nt.map, roughnessMap: nt.rough, roughness: 1, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.15 }); })();
    matCache.set(spec.id + ':nose', noseMat);
    const nose = new THREE.Mesh(noseGeometry(w2, 2.4), noseMat);
    nose.position.z = bodyZ - Lb / 2; nose.castShadow = true; car.add(nose);
    cabNose = nose;
    headlights = []; taillights = [];
    for (const x of [-1.05, 1.05]) {
      const hl = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), P.headlight); hl.position.set(x, 1.55, bodyZ - Lb / 2 - 2.33); hl.rotation.y = Math.PI; car.add(hl); headlights.push(hl);
      const tl = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), P.tail); tl.position.set(x * 1.12, 1.3, bodyZ - Lb / 2 - 2.3); tl.rotation.y = Math.PI; car.add(tl); taillights.push(tl);
    }
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), P.headlight); top.position.set(0, 3.25, bodyZ - Lb / 2 - 1.95); top.rotation.y = Math.PI; top.rotation.x = 0.4; car.add(top); headlights.push(top);
    // перегородка кабины
    const part = new THREE.Mesh(new THREE.PlaneGeometry(2 * w2 - 0.1, 2.3), P.interiorWall); part.position.set(0, FLOOR + 1.15, bodyZ - Lb / 2 + 0.05); part.rotation.y = Math.PI; body.add(part);
  }
  car.userData = { doors, panto, bogies, headlights, taillights, length: L, body, interior, nose: cabNose, procedural: true, bodyMat, cabOffset: bodyZ - Lb / 2 };
  return car;
}

// Огни: светящиеся спрайты (фары/хвостовые) — у реальных моделей стёкла фар не светятся сами
let glowTex = null;
function glow(color, size) {
  if (!glowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); glowTex = new THREE.CanvasTexture(c);
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  sp.scale.setScalar(size);
  return sp;
}

export class TrainModel {
  constructor(spec, cars) {
    this.spec = spec;
    this.nCars = cars;
    this.group = new THREE.Group();
    this.cars = [];
    this.flipped = [];
    this.lens = carLengths(spec, cars);
    this.real = null;
  }

  async build() {
    const spec = this.spec;
    this.real = hasRealTrain(spec.id) ? await loadRealTrain(spec.id) : null;
    for (let i = 0; i < this.nCars; i++) {
      let car;
      if (this.real) {
        const role = this.real.cfg.roles(i, this.nCars);
        const piece = this.real.pieces[role.piece];
        car = new THREE.Group();
        const inner = instantiate(piece.parts);
        inner.rotation.y = role.flip ? Math.PI : 0;
        car.add(inner);
        const L = this.lens[i];
        const isHead = role.piece === 'head';
        // фары и хвостовые огни на носу головного
        let headlights = null, taillights = null;
        if (isHead) {
          const nz = piece.box.min.z + 0.15, w = (piece.box.max.x - piece.box.min.x) / 2;
          headlights = [glow(0xfff4d8, 1.6), glow(0xfff4d8, 1.6), glow(0xfff4d8, 1.3)];
          headlights[0].position.set(-w * 0.62, 1.25, nz); headlights[1].position.set(w * 0.62, 1.25, nz); headlights[2].position.set(0, 3.45, nz + 0.9);
          taillights = [glow(0xff2a10, 0.9), glow(0xff2a10, 0.9)];
          taillights[0].position.set(-w * 0.72, 1.05, nz); taillights[1].position.set(w * 0.72, 1.05, nz);
          for (const l of [...headlights, ...taillights]) inner.add(l);
        }
        // двери (условные проёмы на четвертях длины — для посадки и ходьбы)
        const doorZ = [-L / 4, L / 4];
        car.userData = { length: L, inner, real: true, isHead, flip: role.flip, piece, headlights, taillights, doorZ, doors: { left: [], right: [] }, bogies: [] };
        this.flipped.push(false);
      } else {
        car = buildProceduralCar(spec, i, this.nCars, { cab: isHeadCar(spec, i, this.nCars) });
        car.userData.doorZ = null;
        this.flipped.push(i === this.nCars - 1 || (spec.unit && i % spec.unit === spec.unit - 1));
      }
      this.cars.push(car);
      this.group.add(car);
    }
  }

  // Смена кабины: головной становится хвостовым
  reverse() {
    this.cars.reverse();
    this.lens.reverse();
    if (this.real) for (const car of this.cars) { car.userData.inner.rotation.y += Math.PI; car.userData.flip = !car.userData.flip; }
    else this.flipped = this.flipped.reverse().map((f) => !f);
  }

  // Центр вагона i: расстояние от головы состава
  carCenter(i) { let d = 0; for (let k = 0; k < i; k++) d += this.lens[k]; return d + this.lens[i] / 2; }

  // Расстановка по пути: latFn(s) — поперечное положение оси пути
  place(route, sFront, dir, latFn, dt = 0, speed = 0) {
    const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const L = this.lens[i];
      const sc = sFront - dir * this.carCenter(i);
      const sf = sc + dir * (L / 2 - 3.0), sr = sc - dir * (L / 2 - 3.0);
      route.point(sf, latFn(sf), 0, a); route.point(sr, latFn(sr), 0, b);
      car.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      const dx = a.x - b.x, dz = a.z - b.z, dy = a.y - b.y;
      const flip = this.flipped[i];
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      car.rotation.order = 'YXZ';
      car.rotation.set(flip ? -pitch : pitch, Math.atan2(-dx, -dz) + (flip ? Math.PI : 0), 0);
      for (const bg of car.userData.bogies || []) for (const ws of bg.children) if (ws.userData.wheel) ws.rotation.x -= (speed * dt) / 0.425;
    }
  }

  updatePose(route, sFront, dir, track, dt, speed) {
    this.place(route, sFront, dir, (s) => route.trackOffset(s, dir), dt, speed);
  }

  setDoors(left, right) {
    if (this.real) return; // у готовых моделей двери не отделены от кузова
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const flip = this.flipped[i];
      const d = car.userData.doors;
      const L = flip ? right : left, R = flip ? left : right;
      for (const [arr, v] of [[d.left, L], [d.right, R]]) {
        for (const leaf of arr) {
          const u = leaf.userData;
          const out = Math.min(1, v * 4) * 0.07;
          const slide = Math.max(0, (v - 0.2) / 0.8) * (this.spec.doorWidth / 2 - 0.02);
          leaf.position.set(u.base.x + u.sx * out, u.base.y, u.base.z + u.lr * slide);
        }
      }
    }
  }

  setLights({ head = true, night = 0 }) {
    const P = sharedParts();
    P.headlight.emissiveIntensity = head ? 3 + night * 6 : 0;
    P.tail.emissiveIntensity = 2 + night * 3;
    P.lightStrip.emissiveIntensity = 0.6 + night * 1.6;
    const n = this.cars.length;
    this.cars.forEach((car, i) => {
      const u = car.userData;
      const isFront = i === 0, isTail = i === n - 1;
      if (u.real) {
        // нос «смотрит» вперёд у головного (flip=false) и назад у хвостового (flip=true)
        if (u.headlights) u.headlights.forEach((h, k) => { h.visible = isFront && !u.flip && head; h.material.opacity = 0.35 + night * 0.65; h.scale.setScalar((k === 2 ? 1.1 : 1.4) * (1 + night * 1.5)); });
        if (u.taillights) u.taillights.forEach((h) => { h.visible = isTail && u.flip; h.material.opacity = 0.5 + night * 0.5; });
      } else {
        if (u.headlights) u.headlights.forEach((h) => { h.visible = isFront; });
        if (u.taillights) u.taillights.forEach((h) => { h.visible = isTail; });
      }
    });
  }

  setPantograph(v) {
    for (const car of this.cars) if (car.userData.panto) car.userData.panto.userData.set(v);
  }
}
