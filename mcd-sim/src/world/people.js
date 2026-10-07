// Пассажиры на платформах: анимированные модели (three.js examples: Michelle, Ready Player Me; анимации Mixamo).
// Ожидают поезд, при открытии дверей идут к ближайшей двери и «входят», выходящие идут к выходу.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { assets } from '../core/assets.js';
import { mulberry32, hashStr } from '../core/rng.js';

const T = { models: [], clips: {} };

function retarget(clip, mapName) {
  const tracks = [];
  for (const tr of clip.tracks) {
    const [node, prop] = tr.name.split('.');
    if (prop !== 'quaternion' && !(prop === 'position' && node.endsWith('Hips'))) continue;
    const t = tr.clone();
    t.name = mapName(node) + '.' + prop;
    if (prop === 'position') {
      // убираем горизонтальный дрейф бёдер, оставляем вертикальные колебания
      const v = t.values; for (let i = 0; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
    }
    tracks.push(t);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

export async function loadPeople() {
  const [soldier, michelle, rpm] = await Promise.all([assets.person('Soldier.glb'), assets.person('Michelle.glb'), assets.person('readyplayer.me.glb')]);
  if (!soldier) return;
  const idle = soldier.animations.find((a) => a.name === 'Idle');
  const walk = soldier.animations.find((a) => a.name === 'Walk');
  if (michelle) {
    T.models.push({ scene: michelle.scene, clips: { idle: retarget(idle, (n) => n), walk: retarget(walk, (n) => n) }, height: 1.66 });
  }
  if (rpm) {
    T.models.push({ scene: rpm.scene, clips: { idle: retarget(idle, (n) => n.replace(/^mixamorig:?/, '')), walk: retarget(walk, (n) => n.replace(/^mixamorig:?/, '')) }, height: 1.78 });
  }
  // нормализуем рост
  for (const m of T.models) {
    const box = new THREE.Box3().setFromObject(m.scene);
    const h = box.max.y - box.min.y;
    m.scale = m.height / h;
    m.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  }
}

export class Crowd {
  constructor(scene, route) {
    this.scene = scene; this.route = route;
    this.people = [];
    this.stationIdx = -1;
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  clear() {
    for (const p of this.people) { p.mixer.stopAllAction(); p.obj.removeFromParent(); }
    this.people = [];
  }

  // Заполняет платформы станции (вызывается при приближении к станции)
  populate(st, platforms, timeOfDay) {
    this.clear();
    this.stationIdx = st.index;
    if (!T.models.length) return;
    const rnd = mulberry32(hashStr(st.id) ^ Math.floor(timeOfDay / 600));
    const h = timeOfDay / 3600;
    const peak = (h > 7 && h < 10) || (h > 17 && h < 20);
    const night = h < 6 || h > 23;
    for (const P of platforms) {
      const n = Math.round((night ? 3 : peak ? 22 : 11) * (st.hub ? 1.6 : 1) * (0.7 + rnd() * 0.6));
      for (let i = 0; i < n; i++) {
        const m = T.models[Math.floor(rnd() * T.models.length)];
        const obj = SkeletonUtils.clone(m.scene);
        obj.scale.setScalar(m.scale * (0.92 + rnd() * 0.14));
        const mixer = new THREE.AnimationMixer(obj);
        const idle = mixer.clipAction(m.clips.idle); const walk = mixer.clipAction(m.clips.walk);
        idle.play(); idle.time = rnd() * idle.getClip().duration;
        walk.play(); walk.setEffectiveWeight(0);
        const s = st.s + (rnd() - 0.5) * Math.min(st.platformLength - 30, 200);
        const lat = P.lat0 + 1.0 + rnd() * (P.lat1 - P.lat0 - 2.0);
        const p = { obj, mixer, idle, walk, s, lat, h: 1.1, yaw: rnd() * 6.28, state: 'wait', target: null, speed: 1.2 + rnd() * 0.3, platform: P, timer: rnd() * 5 };
        // смотрят в сторону пути
        const trackSide = P.island ? (lat > (P.lat0 + P.lat1) / 2 ? 1 : -1) : -P.side;
        p.yaw = trackSide > 0 ? Math.PI / 2 : -Math.PI / 2;
        p.yaw += (rnd() - 0.5) * 1.2;
        this.group.add(obj);
        this.people.push(p);
      }
    }
  }

  // Посадка: при открытых дверях часть людей идёт к дверям поезда
  board(doorPoints) {
    for (const p of this.people) {
      if (p.state !== 'wait') continue;
      let best = null, bd = 1e9;
      for (const d of doorPoints) {
        const dist = Math.abs(d.s - p.s) + Math.abs(d.lat - p.lat) * 0.5;
        if (dist < bd && Math.sign(d.lat - (p.platform.lat0 + p.platform.lat1) / 2) === Math.sign(p.lat - (p.platform.lat0 + p.platform.lat1) / 2 || 1)) { bd = dist; best = d; }
      }
      if (!best || bd > 60) continue;
      if (Math.random() < 0.85) { p.state = 'board'; p.target = best; }
    }
  }

  update(dt, camPos) {
    const tmp = { x: 0, y: 0, z: 0 };
    for (let i = this.people.length - 1; i >= 0; i--) {
      const p = this.people[i];
      if (p.state === 'board' && p.target) {
        const ds = p.target.s - p.s, dl = p.target.lat - p.lat;
        const d = Math.hypot(ds, dl);
        if (d < 0.4) { p.obj.removeFromParent(); this.people.splice(i, 1); continue; }
        const v = p.speed * dt;
        p.s += (ds / d) * v; p.lat += (dl / d) * v;
        p.yaw = Math.atan2(dl, ds); // относительно оси линии
        p.walk.setEffectiveWeight(1); p.idle.setEffectiveWeight(0);
      }
      this.route.point(p.s, p.lat, p.h, tmp);
      p.obj.position.set(tmp.x, tmp.y, tmp.z);
      const hd = this.route.heading(p.s);
      // yaw: 0 — вдоль +s; локальная ось +Z модели → вперёд
      p.obj.rotation.y = -hd + Math.PI - p.yaw + (p.state === 'board' ? 0 : 0);
      const near = Math.abs(p.obj.position.x - camPos.x) + Math.abs(p.obj.position.z - camPos.z) < 90;
      p.obj.visible = Math.abs(p.obj.position.x - camPos.x) + Math.abs(p.obj.position.z - camPos.z) < 600;
      if (near) p.mixer.update(dt);
    }
  }
}
