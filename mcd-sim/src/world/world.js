// Потоковая подгрузка мира вдоль линии: чанки по 100 м (путь, контактная сеть, знаки, окружение),
// станции и светофоры, дальний фон.
import * as THREE from 'three';
import { buildTrack } from './track.js';
import { buildCatenary, buildSignal, buildSigns } from './trackside.js';
import { buildScenery, setNightWindows } from './scenery.js';
import { buildStation, updateStationDynamic } from './station.js';
import { assets } from '../core/assets.js';
import { batchStatic } from './batch.js';
import { settings } from '../core/settings.js';

export const CH = 100;

export class World {
  constructor(scene, route, line, { season, trainLen, cars }) {
    this.scene = scene; this.route = route; this.line = line;
    this.season = season; this.trainLen = trainLen; this.cars = cars;
    this.chunks = new Map();
    this.stations = new Map();
    this.signalObjs = new Map();
    this.root = new THREE.Group();
    scene.add(this.root);
    // дальний фон — большая плоскость под камерой
    const winter = season === 'winter';
    const gm = assets.pbr(winter ? 'snow_02' : season === 'autumn' ? 'forest_ground_04' : 'sparse_grass', { repeat: 1 }).clone();
    for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'metalnessMap']) if (gm[k]) { gm[k] = gm[k].clone(); gm[k].repeat.set(400, 400); gm[k].needsUpdate = true; }
    gm.polygonOffset = true; gm.polygonOffsetFactor = 4; gm.polygonOffsetUnits = 4;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), gm);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    scene.add(this.ground);
  }

  chunkRange(s) {
    const ahead = settings.graphics.viewDistance;
    return [Math.floor((s - ahead) / CH), Math.floor((s + ahead) / CH)];
  }

  buildChunk(i) {
    const r = this.route;
    const s0 = Math.max(-1500, i * CH), s1 = (i + 1) * CH;
    if (s1 < -1500 || s0 > r.length + 1500) return null;
    const origin = r.point((s0 + s1) / 2, 0, 0);
    const g = new THREE.Group();
    g.position.set(origin.x, origin.y, origin.z);
    const track = buildTrack(r, s0, s1, origin, this.season, 0);
    const cat = buildCatenary(r, s0, s1, origin);
    const signs = buildSigns(r, s0, s1, origin);
    const sc = buildScenery(r, s0, s1, origin, { season: this.season });
    g.add(track, cat, signs, sc.near, sc.always);
    const ch = { i, s0, s1, group: g, track, near: sc.near, always: sc.always, signals: [], lod: -1 };
    for (const dir of [1, -1]) for (const sig of r.signals[dir]) {
      if (sig.s >= s0 && sig.s < s1) {
        const o = buildSignal(r, sig, origin);
        g.add(o); ch.signals.push(o);
      }
    }
    batchStatic(g);
    this.root.add(g);
    return ch;
  }

  disposeGroup(g) {
    g.traverse((o) => {
      if (o.isMesh && !o.isInstancedMesh && o.geometry) o.geometry.dispose();
      if (o.isInstancedMesh) o.dispose?.();
    });
    g.removeFromParent();
  }

  // s — пикетаж камеры; immediate — построить всё сразу (загрузка)
  update(s, camPos, { immediate = false, time = 0, night = 0, boardsFor = null } = {}) {
    const [a, b] = this.chunkRange(s);
    let budget = immediate ? 1e9 : 2;
    // сначала ближайшие
    const want = [];
    for (let i = a; i <= b; i++) want.push(i);
    want.sort((x, y) => Math.abs(x * CH - s) - Math.abs(y * CH - s));
    for (const i of want) {
      if (this.chunks.has(i)) continue;
      if (budget-- <= 0) break;
      const ch = this.buildChunk(i);
      this.chunks.set(i, ch);
    }
    for (const [i, ch] of this.chunks) {
      if (i < a - 2 || i > b + 2) { if (ch) this.disposeGroup(ch.group); this.chunks.delete(i); continue; }
      if (!ch) continue;
      const d = Math.abs((ch.s0 + ch.s1) / 2 - s);
      const lod = d < 260 ? 0 : 1;
      if (lod !== ch.lod) {
        ch.lod = lod;
        ch.near.visible = lod === 0;
        ch.always.traverse((o) => {
          if (o.userData.isImpostor) o.count = lod === 0 ? o.userData.nearCount : o.instanceMatrix.count;
        });
      }
    }
    // станции
    for (const st of this.route.stations) {
      const d = Math.abs(st.s - s);
      const have = this.stations.get(st.index);
      if (d < settings.graphics.viewDistance + 300 && !have) {
        if (budget-- <= 0 && !immediate) continue;
        const g = buildStation(this.route, this.line, st, { season: this.season, trainLen: this.trainLen, cars: this.cars });
        batchStatic(g);
        this.root.add(g);
        this.stations.set(st.index, g);
      } else if (have && d > settings.graphics.viewDistance + 900) {
        this.disposeGroup(have); this.stations.delete(st.index);
      }
    }
    for (const [idx, g] of this.stations) {
      const st = this.route.stations[idx];
      if (Math.abs(st.s - s) < 700) updateStationDynamic(g, { time, night, boards: boardsFor ? boardsFor(st) : null });
      else if (g.userData.lampMat) g.userData.lampMat.emissiveIntensity = 0.4 + night * 2.6;
    }
    // светофоры
    for (const ch of this.chunks.values()) if (ch) for (const o of ch.signals) o.userData.update(night);
    setNightWindows(night);
    if (camPos) this.ground.position.set(camPos.x, this.route.elevation(s) - 1.25, camPos.z);
  }

  // Высота проходимой поверхности для режима «пешком»: s, lat в координатах линии
  walkHeight(s, lat, curH) {
    let best = null;
    for (const g of this.stations.values()) {
      for (const w of g.userData.walk) {
        let h = null;
        if (w.stair) {
          const lo = Math.min(w.sA, w.sB), hi = Math.max(w.sA, w.sB);
          if (s >= lo && s <= hi && lat >= w.lat0 && lat <= w.lat1) h = w.hA + ((s - w.sA) / (w.sB - w.sA)) * (w.hB - w.hA);
        } else if (s >= w.s0 && s <= w.s1 && lat >= w.lat0 && lat <= w.lat1) {
          h = w.h;
          if (w.ramp) { const d = Math.min(s - w.s0, w.s1 - s); if (d < w.ramp) h = -0.9 + (w.h + 0.9) * (d / w.ramp); }
        }
        if (h != null && h <= curH + 0.6 && (best == null || h > best)) best = h;
      }
    }
    // земля / балласт
    const oL = Math.abs(this.route.trackOffset(s, -1)), oR = Math.abs(this.route.trackOffset(s, 1));
    let g = -1.0;
    if (lat > -(oL + 1.75) && lat < oR + 1.75) g = -0.33;
    if (best == null || g > best) best = g;
    return best;
  }
}
