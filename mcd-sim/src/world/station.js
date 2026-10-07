// Остановочный пункт МЦД: высокие платформы, навесы, табло, таблички, переход (мост или тоннель),
// павильон с турникетами, освещение, скамейки. Реквизит — модели Poly Haven / Sketchfab; несущие конструкции —
// собственная геометрия с PBR-текстурами (готовых моделей конкретных станций нет).
import * as THREE from 'three';
import { assets, flattenModel } from '../core/assets.js';
import { sweep, placeMatrix, tf, mergeGeoms } from './geom.js';
import { PLATFORM_EDGE, PLATFORM_HEIGHT } from '../sim/route.js';
import { stationNameTex, stopMarkerTex, DepartureBoard, lineBadge, textBoardTex } from './signs.js';
import { mulberry32 } from '../core/rng.js';

const PH = PLATFORM_HEIGHT;
let M = null;
function mats(season) {
  if (M && M.season === season) return M;
  const winter = season === 'winter';
  const tactile = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#e8b91c'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#f6cc33';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.beginPath(); g.arc(16 + x * 32, 16 + y * 32, 9, 0, Math.PI * 2); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  M = {
    season,
    top: assets.pbr(winter ? 'snow_02' : 'square_concrete_pavers', { repeat: 1, color: winter ? 0xf0f2f5 : 0xd0ccc4 }),
    wall: assets.pbr('precast_concrete_wall', { repeat: 1, color: 0xbdbab3 }),
    coping: new THREE.MeshStandardMaterial({ color: 0xe9e9e6, roughness: 0.7 }),
    tactile: new THREE.MeshStandardMaterial({ map: tactile, roughness: 0.6 }),
    whiteLine: new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.6 }),
    roof: assets.pbr('box_profile_metal_sheet', { repeat: 1, color: 0xb8bcc2, metalness: 1, roughness: 1 }),
    roofTop: assets.pbr('corrugated_iron_02', { repeat: 1, color: winter ? 0xf4f6fa : 0x9aa0a8 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x5d6670, roughness: 0.45, metalness: 0.85 }),
    steelLight: new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.35, metalness: 0.9 }),
    railing: new THREE.MeshStandardMaterial({ color: 0x4f5a52, roughness: 0.5, metalness: 0.7 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xa8c4d4, roughness: 0.05, metalness: 0.0, transmission: 0.0, transparent: true, opacity: 0.35, envMapIntensity: 1.5, side: THREE.DoubleSide }),
    cladding: assets.pbr('metal_plate', { repeat: 1, color: 0xd6d8dc, metalness: 1, side: THREE.DoubleSide }),
    concrete: assets.pbr('brushed_concrete', { repeat: 1, color: 0xc4c1ba }),
    stairs: assets.pbr('anti_slip_concrete', { repeat: 1, color: 0xb9b6b0 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.9 }),
    lightOn: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 0.0, roughness: 0.4 }),
    fascia: new THREE.MeshStandardMaterial({ color: 0x2b3a55, roughness: 0.5, metalness: 0.3 }),
  };
  return M;
}

// Реквизит: модели загружаются один раз, далее — InstancedMesh
const props = {};
export async function loadStationProps() {
  const list = { bench: 'painted_wooden_bench', trash: 'metal_trash_can', lamp: 'street_lamp_02', tube: 'mounted_fluorescent_lights', cam: 'security_camera_01', box: 'utility_box_01' };
  await Promise.all(Object.entries(list).map(async ([k, name]) => {
    const g = await assets.model(name);
    if (!g) return;
    const root = g.scene;
    const box = new THREE.Box3().setFromObject(root);
    props[k] = { parts: flattenModel(root), box };
  }));
  // турникеты из Sketchfab, если скачаны
  const ts = await assets.sketch('turnstile');
  if (ts) { const box = new THREE.Box3().setFromObject(ts.scene); props.turnstile = { parts: flattenModel(ts.scene), box }; }
}

function addInstances(group, prop, matrices, { cast = true, scale = null } = {}) {
  if (!prop || !matrices.length) return;
  for (const p of prop.parts) {
    const im = new THREE.InstancedMesh(p.geometry, p.material, matrices.length);
    matrices.forEach((m, i) => im.setMatrixAt(i, scale ? m.clone().multiply(new THREE.Matrix4().makeScale(scale, scale, scale)) : m));
    im.castShadow = cast; im.receiveShadow = true;
    group.add(im);
  }
}

// Описание платформ станции в координатах (s, lat)
export function platformsOf(route, st) {
  const s = st.s;
  const oL = Math.abs(route.trackOffset(s, -1)), oR = Math.abs(route.trackOffset(s, 1));
  const half = st.platformLength / 2;
  if (st.island) return [{ s0: s - half, s1: s + half, lat0: -oL + PLATFORM_EDGE, lat1: oR - PLATFORM_EDGE, edges: [-1, 1], island: true }];
  return [
    { s0: s - half, s1: s + half, lat0: -oL - PLATFORM_EDGE - st.platformWidth, lat1: -oL - PLATFORM_EDGE, edges: [1], side: -1 },
    { s0: s - half, s1: s + half, lat0: oR + PLATFORM_EDGE, lat1: oR + PLATFORM_EDGE + st.platformWidth, edges: [-1], side: 1 },
  ];
}

export function buildStation(route, line, st, { season = 'summer', trainLen = 260, cars = 10 } = {}) {
  const mt = mats(season);
  const rnd = mulberry32(st.seed);
  const origin = route.point(st.s, 0, 0);
  const group = new THREE.Group();
  group.position.set(origin.x, origin.y, origin.z);
  group.userData.dynamic = [];
  const walk = []; // проходимые области для режима пешком
  const spawn = []; // места для пассажиров
  const lights = [];
  const plats = platformsOf(route, st);
  const half = st.platformLength / 2;
  const ramp = 12;
  const crossingEnd = rnd() < 0.5 ? -1 : 1; // у какого конца платформы переход
  const crossS = st.s + crossingEnd * (half - 34);
  const tunnel = st.crossing === 'underpass';
  const openA = crossS - 7, openB = crossS + 7; // проём лестницы в тоннель

  for (const P of plats) {
    const w = P.lat1 - P.lat0;
    const hAt = (s) => {
      if (P.island) return PH;
      const d = Math.min(s - P.s0, P.s1 - s);
      return d >= ramp ? PH : -0.9 + (PH + 0.9) * (d / ramp);
    };
    const stairLat0 = P.island ? (P.lat0 + P.lat1) / 2 - 1.6 : P.side < 0 ? P.lat0 + 0.6 : P.lat1 - 3.8;
    const stairLat1 = stairLat0 + 3.2;
    // покрытие платформы (с проёмом лестницы при подземном переходе)
    const topStrip = (a, b, l0, l1) => {
      const g = sweep(route, a, b, 2, (s) => [{ lat: l0, h: hAt(s) }, { lat: l1, h: hAt(s) }], origin, { uScale: 0.5, vScale: 0.5 });
      const m = new THREE.Mesh(g, mt.top); m.receiveShadow = true; group.add(m);
    };
    const inner0 = P.lat0 + (P.edges.includes(-1) ? 0.65 : 0), inner1 = P.lat1 - (P.edges.includes(1) ? 0.65 : 0);
    if (tunnel) {
      topStrip(P.s0, openA, inner0, inner1); topStrip(openB, P.s1, inner0, inner1);
      topStrip(openA, openB, inner0, stairLat0); topStrip(openA, openB, stairLat1, inner1);
    } else topStrip(P.s0, P.s1, inner0, inner1);
    // край платформы: тактильная полоса, белая линия, бортовой камень, стенка
    for (const e of P.edges) {
      const edgeLat = e < 0 ? P.lat0 : P.lat1;
      const inward = -e;
      const strip = (l0, l1, mat, dh = 0.004) => {
        const a = Math.min(l0, l1), b = Math.max(l0, l1);
        const g = sweep(route, P.s0, P.s1, 2, (s) => [{ lat: a, h: hAt(s) + dh }, { lat: b, h: hAt(s) + dh }], origin, { uScale: 1.6, vScale: 1.6 });
        const m = new THREE.Mesh(g, mat); m.receiveShadow = true; group.add(m);
      };
      strip(edgeLat, edgeLat + inward * 0.12, mt.coping, 0.02);
      strip(edgeLat + inward * 0.12, edgeLat + inward * 0.2, mt.whiteLine);
      strip(edgeLat + inward * 0.2, edgeLat + inward * 0.65, mt.tactile);
      // вертикальная стенка к пути
      const wallG = sweep(route, P.s0, P.s1, 2, (s) => {
        const top = hAt(s) + 0.02;
        const pts = [{ lat: edgeLat + e * 0.04, h: top }, { lat: edgeLat + e * 0.04, h: top - 0.12 }, { lat: edgeLat - e * 0.12, h: top - 0.18 }, { lat: edgeLat - e * 0.12, h: -0.95 }];
        return e > 0 ? pts : pts;
      }, origin, { uScale: 0.5, vScale: 0.5, flipNormals: e < 0 });
      const wm = new THREE.Mesh(wallG, mt.wall); wm.receiveShadow = true; wm.castShadow = true; group.add(wm);
    }
    // задняя стенка боковой платформы + ограждение
    if (!P.island) {
      const back = P.side < 0 ? P.lat0 : P.lat1;
      const bg = sweep(route, P.s0, P.s1, 2, (s) => [{ lat: back, h: hAt(s) }, { lat: back, h: -1.0 }], origin, { uScale: 0.5, vScale: 0.5, flipNormals: P.side < 0 });
      group.add(new THREE.Mesh(bg, mt.wall));
      const rail = sweep(route, P.s0 + ramp, P.s1 - ramp, 2, (s) => [0, 1, 2, 3].map((k) => ({ lat: back - P.side * 0.1 + Math.cos(k * Math.PI / 2) * 0.025, h: hAt(s) + 1.1 + Math.sin(k * Math.PI / 2) * 0.025 })), origin, { closed: true });
      group.add(new THREE.Mesh(rail, mt.railing));
      const posts = [];
      for (let s = P.s0 + ramp; s <= P.s1 - ramp; s += 2.5) posts.push(placeMatrix(route, s, back - P.side * 0.1, PH, origin));
      const pg = new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6); pg.translate(0, 0.55, 0);
      const pim = new THREE.InstancedMesh(pg, mt.railing, posts.length); posts.forEach((m, i) => pim.setMatrixAt(i, m)); group.add(pim);
      const mid = sweep(route, P.s0 + ramp, P.s1 - ramp, 2, (s) => [0, 1, 2, 3].map((k) => ({ lat: back - P.side * 0.1 + Math.cos(k * Math.PI / 2) * 0.012, h: hAt(s) + 0.55 + Math.sin(k * Math.PI / 2) * 0.012 })), origin, { closed: true });
      group.add(new THREE.Mesh(mid, mt.railing));
    } else {
      // торцы островной платформы
      for (const end of [P.s0, P.s1]) {
        const g = new THREE.PlaneGeometry(w, PH + 0.95);
        const m = new THREE.Mesh(g, mt.wall);
        m.applyMatrix4(placeMatrix(route, end, (P.lat0 + P.lat1) / 2, (PH - 0.95) / 2, origin, { yaw: end < st.s ? 0 : Math.PI }));
        group.add(m);
      }
    }
    walk.push({ s0: P.s0, s1: P.s1, lat0: P.lat0, lat1: P.lat1, h: PH, ramp: P.island ? 0 : ramp, island: !!P.island });
    spawn.push({ s0: st.s - st.canopyLength / 2 - 30, s1: st.s + st.canopyLength / 2 + 30, lat0: P.lat0 + 1.2, lat1: P.lat1 - 1.2 });

    // ── навес ──
    const c0 = st.s - st.canopyLength / 2, c1 = st.s + st.canopyLength / 2;
    const roofH = PH + 3.7;
    const rl0 = P.island ? P.lat0 - 0.4 : P.side < 0 ? P.lat0 + 0.2 : P.lat0 - 0.5;
    const rl1 = P.island ? P.lat1 + 0.4 : P.side < 0 ? P.lat1 + 0.5 : P.lat1 - 0.2;
    const mid = (rl0 + rl1) / 2;
    const roofProf = (dh) => P.island
      ? [{ lat: rl0, h: roofH + 0.35 + dh }, { lat: mid, h: roofH + dh }, { lat: rl1, h: roofH + 0.35 + dh }]
      : P.side < 0 ? [{ lat: rl0, h: roofH + 0.4 + dh }, { lat: rl1, h: roofH + dh }] : [{ lat: rl0, h: roofH + dh }, { lat: rl1, h: roofH + 0.4 + dh }];
    const under = sweep(route, c0, c1, 3, () => roofProf(0), origin, { uScale: 0.5, vScale: 0.5, flipNormals: true });
    const over = sweep(route, c0, c1, 3, () => roofProf(0.18), origin, { uScale: 0.25, vScale: 0.25 });
    const um = new THREE.Mesh(under, mt.roof); um.receiveShadow = true; group.add(um);
    const om = new THREE.Mesh(over, mt.roofTop); om.castShadow = true; om.receiveShadow = true; group.add(om);
    for (const L of [rl0, rl1]) {
      const fh = roofProf(0).find((p) => p.lat === L).h;
      const fas = sweep(route, c0, c1, 3, () => [{ lat: L, h: fh + 0.3 }, { lat: L, h: fh - 0.15 }], origin, { flipNormals: L === rl1 });
      const fm = new THREE.Mesh(fas, mt.fascia); group.add(fm);
      const fas2 = sweep(route, c0, c1, 3, () => [{ lat: L, h: fh + 0.3 }, { lat: L, h: fh - 0.15 }], origin, { flipNormals: L !== rl1 });
      group.add(new THREE.Mesh(fas2, mt.fascia));
    }
    // колонны и светильники
    const colLat = P.island ? mid : P.side < 0 ? P.lat0 + 0.6 : P.lat1 - 0.6;
    const cols = [], lamps = [], cams = [];
    for (let s = c0 + 4; s <= c1 - 4; s += 9) {
      cols.push(placeMatrix(route, s, colLat, PH, origin));
      for (const ll of P.island ? [mid - 2, mid + 2] : [colLat + (P.side < 0 ? 2 : -2)]) lamps.push(placeMatrix(route, s + 4.5, ll, roofH - 0.05, origin));
      if (rnd() < 0.25) cams.push(placeMatrix(route, s, colLat + 0.2, roofH - 0.6, origin, { yaw: rnd() < 0.5 ? 0 : Math.PI }));
    }
    const colG = new THREE.CylinderGeometry(0.14, 0.14, roofH - PH, 12); colG.translate(0, (roofH - PH) / 2, 0);
    const colM = new THREE.InstancedMesh(colG, mt.steel, cols.length); cols.forEach((m, i) => colM.setMatrixAt(i, m)); colM.castShadow = true; group.add(colM);
    const lampG = new THREE.BoxGeometry(0.22, 0.08, 1.6);
    const lampM = new THREE.InstancedMesh(lampG, mt.lightOn, lamps.length); lamps.forEach((m, i) => lampM.setMatrixAt(i, m)); group.add(lampM);
    lamps.forEach((m) => lights.push(new THREE.Vector3().setFromMatrixPosition(m)));
    addInstances(group, props.cam, cams, { cast: false });

    // таблички с названием станции (подвесные под навесом и на стойках)
    const nameTex = stationNameTex(st, line);
    const nameMat = new THREE.MeshStandardMaterial({ map: nameTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: nameTex, emissiveIntensity: 0 });
    const boardG = new THREE.PlaneGeometry(2.6, 0.65);
    const boardBack = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6 });
    const nameSpots = [];
    for (let s = P.s0 + 25; s <= P.s1 - 25; s += 38) nameSpots.push(s);
    for (const s of nameSpots) {
      const covered = s > c0 && s < c1;
      for (const e of P.edges) {
        const lat = P.island ? mid + e * 0.05 : colLat + (P.side < 0 ? 0.3 : -0.3);
        const h = covered ? roofH - 0.85 : PH + 2.3;
        // табличка обращена к пути e
        const grp = new THREE.Group();
        grp.applyMatrix4(placeMatrix(route, s, lat, h, origin, { yaw: e > 0 ? -Math.PI / 2 : Math.PI / 2 }));
        const b = new THREE.Mesh(boardG, nameMat); grp.add(b);
        const bb = new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.71, 0.05), boardBack); bb.position.z = -0.03; grp.add(bb);
        if (covered) { const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5), mt.steel); rod.position.set(0, 0.6, -0.03); grp.add(rod); }
        else for (const x of [-1.1, 1.1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3), mt.steel); p.position.set(x, -1.15, -0.04); grp.add(p); }
        group.add(grp);
      }
    }
    // табло отправления
    const board = new DepartureBoard(line, st);
    group.userData.dynamic.push({ type: 'board', board, platform: P });
    for (const yaw of [0, Math.PI]) {
      const grp = new THREE.Group();
      grp.applyMatrix4(placeMatrix(route, st.s + (yaw ? -6 : 6), colLat + (P.island ? 0 : P.side < 0 ? 1.2 : -1.2), roofH - 1.0, origin, { yaw }));
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: board.tex, toneMapped: false }));
      scr.position.z = 0.051; grp.add(scr);
      grp.add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.48, 0.1), mt.dark));
      group.add(grp);
    }
    // часы
    {
      const clock = document.createElement('canvas'); clock.width = clock.height = 128;
      const tex = new THREE.CanvasTexture(clock); tex.colorSpace = THREE.SRGBColorSpace;
      const grp = new THREE.Group();
      grp.applyMatrix4(placeMatrix(route, st.s + 15, colLat, roofH - 0.7, origin, { yaw: Math.PI / 2 }));
      for (const z of [0.06, -0.06]) { const f = new THREE.Mesh(new THREE.CircleGeometry(0.32, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3 })); f.position.z = z; if (z < 0) f.rotation.y = Math.PI; grp.add(f); }
      grp.add(tf(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.1, 32), mt.steel), { rx: Math.PI / 2 }));
      group.add(grp);
      group.userData.dynamic.push({ type: 'clock', canvas: clock, tex });
    }
    // скамейки и урны
    const benches = [], trash = [];
    for (let s = c0 + 8; s <= c1 - 8; s += 18) {
      const lat = P.island ? mid + (benches.length % 2 ? 1.0 : -1.0) : colLat + (P.side < 0 ? 0.9 : -0.9);
      benches.push(placeMatrix(route, s, lat, PH, origin, { yaw: Math.PI / 2 * (P.island ? (benches.length % 2 ? -1 : 1) : P.side < 0 ? 1 : -1) }));
      trash.push(placeMatrix(route, s + 2.2, lat, PH, origin));
    }
    addInstances(group, props.bench, benches);
    addInstances(group, props.trash, trash, { scale: 0.85 });
    // фонари на открытых частях
    const posts = [];
    const postLat = P.island ? mid : P.side < 0 ? P.lat0 + 0.5 : P.lat1 - 0.5;
    for (let s = P.s0 + 10; s <= P.s1 - 10; s += 24) {
      if (s > c0 - 4 && s < c1 + 4) continue;
      posts.push(placeMatrix(route, s, postLat, hAt(s), origin, { yaw: P.island ? 0 : P.side < 0 ? -Math.PI / 2 : Math.PI / 2 }));
    }
    if (props.lamp) {
      addInstances(group, props.lamp, posts);
      const top = props.lamp.box.max.y;
      posts.forEach((m) => lights.push(new THREE.Vector3(0, top - 0.3, 0).applyMatrix4(m)));
    }
    // знак остановки первого вагона
    for (const e of P.edges) {
      const dir = P.island ? e : P.side; // правый путь (lat>0) — направление +1
      const sStop = st.s + dir * (trainLen / 2);
      const grp = new THREE.Group();
      const lat = (e < 0 ? P.lat0 : P.lat1) - e * 0.9;
      grp.applyMatrix4(placeMatrix(route, sStop, lat, PH, origin, { yaw: dir > 0 ? 0 : Math.PI }));
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.9), mt.steel); p.position.y = 0.95; grp.add(p);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.5), new THREE.MeshStandardMaterial({ map: stopMarkerTex(cars), roughness: 0.6 })); b.position.set(0, 1.9, 0.04); grp.add(b);
      group.add(grp);
    }

    // ── вход в подземный переход ──
    if (tunnel) {
      const depth = -3.2;
      const stepN = 16;
      const stairG = [];
      for (let k = 0; k < stepN; k++) {
        const a = openA + 1 + (k * 12) / stepN, h = PH - ((k + 1) * (PH - depth)) / stepN;
        stairG.push(sweep(route, a, a + 12 / stepN, 12 / stepN, () => [{ lat: stairLat0, h }, { lat: stairLat1, h }], origin, { uScale: 0.5, vScale: 0.5 }));
      }
      for (const g of stairG) { const m = new THREE.Mesh(g, mt.stairs); m.receiveShadow = true; group.add(m); }
      for (const L of [stairLat0, stairLat1]) {
        const wg = sweep(route, openA, openB, 2, () => [{ lat: L, h: PH }, { lat: L, h: depth - 0.2 }], origin, { uScale: 0.5, vScale: 0.5, flipNormals: L === stairLat1 });
        group.add(new THREE.Mesh(wg, mt.wall));
        const rl = sweep(route, openA, openB, 2, () => [0, 1, 2, 3].map((k) => ({ lat: L + Math.cos(k * Math.PI / 2) * 0.03, h: PH + 1.0 + Math.sin(k * Math.PI / 2) * 0.03 })), origin, { closed: true });
        group.add(new THREE.Mesh(rl, mt.steelLight));
        const glassG = sweep(route, openA, openB, 2, () => [{ lat: L, h: PH + 0.05 }, { lat: L, h: PH + 0.95 }], origin, {});
        group.add(new THREE.Mesh(glassG, mt.glass));
      }
      // торцевая стенка и тёмный проём
      const endW = new THREE.Mesh(new THREE.PlaneGeometry(stairLat1 - stairLat0, PH - depth), mt.dark);
      endW.applyMatrix4(placeMatrix(route, openB - 0.05, (stairLat0 + stairLat1) / 2, (PH + depth) / 2, origin, { yaw: 0 }));
      group.add(endW);
      const startW = new THREE.Mesh(new THREE.PlaneGeometry(stairLat1 - stairLat0, PH - depth + 0.1), mt.wall);
      startW.applyMatrix4(placeMatrix(route, openA + 0.02, (stairLat0 + stairLat1) / 2, (PH + depth) / 2, origin, { yaw: Math.PI }));
      group.add(startW);
      // стеклянный павильон над спуском
      const pav = sweep(route, openA - 0.5, openB + 0.5, 1, () => [{ lat: stairLat0 - 0.3, h: PH + 2.6 }, { lat: stairLat1 + 0.3, h: PH + 2.6 }], origin, {});
      group.add(new THREE.Mesh(pav, mt.glass));
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshStandardMaterial({ map: textBoardTex('exit', ['Выход в город'], { bg: '#1c2a4a', size: 50 }), roughness: 0.5 }));
      sign.applyMatrix4(placeMatrix(route, openA - 0.4, (stairLat0 + stairLat1) / 2, PH + 2.25, origin, { yaw: Math.PI }));
      group.add(sign);
    }
  }

  // ── надземный переход ──
  if (!tunnel) {
    const deckH = 9.2;
    const oL = Math.abs(route.trackOffset(crossS, -1)), oR = Math.abs(route.trackOffset(crossS, 1));
    const ext = Math.max(...plats.map((p) => Math.max(Math.abs(p.lat0), Math.abs(p.lat1)))) + 6;
    const l0 = -ext, l1 = ext;
    const bw = 3.6;
    const deck = sweep(route, crossS - bw / 2, crossS + bw / 2, bw, () => [{ lat: l0, h: deckH }, { lat: l1, h: deckH }], origin, { uScale: 0.5, vScale: 0.5 });
    const deckB = sweep(route, crossS - bw / 2, crossS + bw / 2, bw, () => [{ lat: l0, h: deckH - 0.45 }, { lat: l1, h: deckH - 0.45 }], origin, { flipNormals: true });
    group.add(new THREE.Mesh(deck, mt.stairs), new THREE.Mesh(deckB, mt.concrete));
    const roofB = sweep(route, crossS - bw / 2 - 0.3, crossS + bw / 2 + 0.3, bw + 0.6, () => [{ lat: l0, h: deckH + 3.0 }, { lat: l1, h: deckH + 3.0 }], origin, {});
    const rbm = new THREE.Mesh(roofB, mt.roofTop); rbm.castShadow = true; group.add(rbm);
    group.add(new THREE.Mesh(sweep(route, crossS - bw / 2 - 0.3, crossS + bw / 2 + 0.3, bw + 0.6, () => [{ lat: l0, h: deckH + 2.95 }, { lat: l1, h: deckH + 2.95 }], origin, { flipNormals: true }), mt.roof));
    for (const side of [-1, 1]) {
      const sAt = crossS + side * bw / 2;
      const wallG = new THREE.PlaneGeometry(l1 - l0, 3.0);
      const wm = new THREE.Mesh(wallG, mt.glass);
      wm.applyMatrix4(placeMatrix(route, sAt, 0, deckH + 1.5, origin, { yaw: side > 0 ? 0 : Math.PI }));
      group.add(wm);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(l1 - l0, 0.9, 0.12), mt.cladding);
      sill.applyMatrix4(placeMatrix(route, sAt, 0, deckH - 0.0, origin));
      sill.castShadow = true; group.add(sill);
    }
    // опоры моста
    const piers = [];
    for (const L of [l0 + 1, l1 - 1, ...plats.map((p) => (p.lat0 + p.lat1) / 2)]) piers.push(placeMatrix(route, crossS, L, 0, origin));
    const pg = new THREE.BoxGeometry(0.6, deckH - 0.45 + 1, 0.6); pg.translate(0, (deckH - 0.45 + 1) / 2 - 1, 0);
    const pim = new THREE.InstancedMesh(pg, mt.concrete, piers.length); piers.forEach((m, i) => pim.setMatrixAt(i, m)); pim.castShadow = true; group.add(pim);
    // лестницы на платформы и с моста на землю
    const stairRun = (sA, sB, latA, latB, hA, hB, width) => {
      const n = Math.max(6, Math.round(Math.abs(hB - hA) / 0.16));
      for (let k = 0; k < n; k++) {
        const a = sA + ((sB - sA) * k) / n, b = sA + ((sB - sA) * (k + 1)) / n;
        const h = hA + ((hB - hA) * (k + 1)) / n;
        const g = sweep(route, Math.min(a, b), Math.max(a, b), Math.abs(b - a), () => [{ lat: latA - width / 2, h }, { lat: latA + width / 2, h }], origin, { uScale: 0.5, vScale: 0.5 });
        group.add(new THREE.Mesh(g, mt.stairs));
      }
      const sideG = sweep(route, Math.min(sA, sB), Math.max(sA, sB), 1, (s) => {
        const t = (s - sA) / (sB - sA); const h = hA + (hB - hA) * t;
        return [{ lat: latA - width / 2 - 0.1, h: h + 1.0 }, { lat: latA - width / 2 - 0.1, h: h - 0.4 }];
      }, origin, {});
      group.add(new THREE.Mesh(sideG, mt.cladding));
      const sideG2 = sweep(route, Math.min(sA, sB), Math.max(sA, sB), 1, (s) => {
        const t = (s - sA) / (sB - sA); const h = hA + (hB - hA) * t;
        return [{ lat: latA + width / 2 + 0.1, h: h + 1.0 }, { lat: latA + width / 2 + 0.1, h: h - 0.4 }];
      }, origin, { flipNormals: true });
      group.add(new THREE.Mesh(sideG2, mt.cladding));
      walk.push({ stair: true, sA, sB, lat0: latA - width / 2, lat1: latA + width / 2, hA, hB });
    };
    const inward = -crossingEnd;
    for (const P of plats) {
      const lat = P.island ? (P.lat0 + P.lat1) / 2 : P.side < 0 ? P.lat0 + 1.6 : P.lat1 - 1.6;
      const run = (deckH - PH) * 1.75;
      stairRun(crossS + inward * (bw / 2 + run), crossS + inward * bw / 2, lat, lat, PH, deckH, 2.4);
    }
    for (const L of [l0 + 2, l1 - 2]) {
      const run = (deckH + 1.0) * 1.75;
      stairRun(crossS + crossingEnd * (bw / 2 + run), crossS + crossingEnd * bw / 2, L, L, -1.0, deckH, 2.4);
    }
    walk.push({ s0: crossS - bw / 2, s1: crossS + bw / 2, lat0: l0, lat1: l1, h: deckH });
  }

  // ── павильон с турникетами ──
  {
    const side = st.pavilionSide;
    const P = plats.length === 1 ? plats[0] : plats[side < 0 ? 0 : 1];
    const baseLat = side < 0 ? Math.min(...plats.map((p) => p.lat0)) - 14 : Math.max(...plats.map((p) => p.lat1)) + 14;
    const sC = crossS;
    const W = 9, L = 18, H = 4.8;
    const grp = new THREE.Group();
    grp.applyMatrix4(placeMatrix(route, sC, baseLat, -1.0, origin, { yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2 }));
    // −Z павильона смотрит от путей
    const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; grp.add(m); return m; };
    box(L, 0.3, W, mt.concrete, 0, 0.15, 0); // пол
    box(L + 0.8, 0.45, W + 0.8, mt.cladding, 0, H + 0.2, 0); // кровля
    for (const x of [-L / 2, L / 2]) box(0.25, H, W, mt.cladding, x, H / 2, 0); // торцы
    const glassF = new THREE.Mesh(new THREE.PlaneGeometry(L, H - 0.3), mt.glass); glassF.position.set(0, H / 2 + 0.15, -W / 2); grp.add(glassF);
    const glassB = new THREE.Mesh(new THREE.PlaneGeometry(L, H - 0.3), mt.glass); glassB.position.set(0, H / 2 + 0.15, W / 2); grp.add(glassB);
    for (let x = -L / 2; x <= L / 2; x += 2.25) { box(0.08, H, 0.12, mt.steel, x, H / 2, -W / 2); box(0.08, H, 0.12, mt.steel, x, H / 2, W / 2); }
    // вывеска МЦД
    const signC = document.createElement('canvas'); signC.width = 1024; signC.height = 160;
    const sg = signC.getContext('2d'); sg.fillStyle = '#1c2a4a'; sg.fillRect(0, 0, 1024, 160);
    lineBadge(sg, 20, 20, 120, line);
    sg.fillStyle = '#fff'; sg.font = '600 70px "Segoe UI", Arial'; sg.textBaseline = 'middle'; sg.fillText(st.name, 170, 84);
    const sTex = new THREE.CanvasTexture(signC); sTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.8, L * 0.8 * 160 / 1024), new THREE.MeshStandardMaterial({ map: sTex, emissive: 0xffffff, emissiveMap: sTex, emissiveIntensity: 0.3 }));
    sign.position.set(0, H + 0.95, -W / 2 - 0.42); sign.rotation.y = Math.PI; grp.add(sign);
    const sign2 = sign.clone(); sign2.position.z = W / 2 + 0.42; sign2.rotation.y = 0; grp.add(sign2);
    // турникеты
    const tm = [];
    for (let i = 0; i < 6; i++) tm.push(new THREE.Matrix4().makeTranslation(-3.75 + i * 1.5, 0.3, 0));
    if (props.turnstile) {
      const b = props.turnstile.box; const sc = 1.0 / Math.max(0.01, b.max.y - b.min.y);
      addInstances(grp, props.turnstile, tm, { scale: sc });
    } else {
      const tg = mergeGeoms([tf(new THREE.BoxGeometry(0.25, 1.0, 1.4), { y: 0.5 }), tf(new THREE.BoxGeometry(0.27, 0.06, 1.42), { y: 1.02 })]);
      const ti = new THREE.InstancedMesh(tg, mt.steelLight, tm.length); tm.forEach((m, i) => ti.setMatrixAt(i, m)); grp.add(ti);
      const vg = new THREE.BoxGeometry(0.2, 0.2, 0.05); const vi = new THREE.InstancedMesh(vg, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: 0x2244ff, emissiveIntensity: 0.6 }), tm.length);
      tm.forEach((m, i) => vi.setMatrixAt(i, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 1.15, -0.4)))); grp.add(vi);
    }
    // билетные автоматы
    for (const x of [-7, -6]) {
      box(0.9, 1.8, 0.6, mt.fascia, x, 1.2, 2.8);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.4), new THREE.MeshStandardMaterial({ color: 0x223355, emissive: 0x3366aa, emissiveIntensity: 0.8 }));
      scr.position.set(x, 1.6, 2.49); scr.rotation.y = Math.PI; grp.add(scr);
    }
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(L - 1, W - 1), mt.lightOn); pl.position.set(0, H - 0.05, 0); pl.rotation.x = Math.PI / 2; grp.add(pl);
    group.add(grp);
    lights.push(new THREE.Vector3(0, H, 0).applyMatrix4(grp.matrix));
    // площадка перед павильоном
    walk.push({ s0: sC - 20, s1: sC + 20, lat0: Math.min(baseLat, baseLat - side * 20), lat1: Math.max(baseLat, baseLat - side * 20), h: -1.0, ground: true });
  }

  group.userData.walk = walk;
  group.userData.spawn = spawn;
  group.userData.lights = lights;
  group.userData.lampMat = mt.lightOn;
  group.userData.nameMat = null;
  group.traverse((o) => { if (o.isMesh && o.castShadow === false && !o.isInstancedMesh) o.receiveShadow = true; });
  return group;
}

export function updateStationDynamic(group, { time, boards, night }) {
  for (const d of group.userData.dynamic) {
    if (d.type === 'clock') {
      const key = Math.floor(time / 30);
      if (d.key === key) continue; d.key = key;
      const g = d.canvas.getContext('2d');
      g.fillStyle = '#fafafa'; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#111'; g.lineWidth = 3;
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.beginPath(); g.moveTo(64 + Math.sin(a) * 50, 64 - Math.cos(a) * 50); g.lineTo(64 + Math.sin(a) * 58, 64 - Math.cos(a) * 58); g.stroke(); }
      const h = (time / 3600) % 12, m = (time / 60) % 60;
      const hand = (a, len, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.sin(a) * len, 64 - Math.cos(a) * len); g.stroke(); };
      hand((h / 12) * Math.PI * 2, 30, 6); hand((m / 60) * Math.PI * 2, 46, 4);
      d.tex.needsUpdate = true;
    } else if (d.type === 'board' && boards) {
      d.board.update(boards);
    }
  }
  if (group.userData.lampMat) group.userData.lampMat.emissiveIntensity = 0.4 + night * 2.6;
}
