// Геометрия линии: ось пути по реальным координатам станций (OSM), продольный профиль,
// ограничения скорости, платформы и сигналы. Всё, что не взято из источников, помечено как приблизительное.
import { mulberry32, hashStr } from '../core/rng.js';

export const STEP = 2; // шаг дискретизации оси, м
export const TRACK_HALF = 2.05; // половина междупутья 4.1 м
export const PLATFORM_EDGE = 1.92; // расстояние от оси пути до края высокой платформы, м
export const PLATFORM_HEIGHT = 1.1; // высота платформы над УГР, м
export const RAIL_TOP = 0.0; // уровень головки рельса относительно профиля

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

export class Route {
  constructor(line) {
    this.line = line;
    this.id = line.id;
    this.color = line.color;
    const rng = mulberry32(hashStr(line.id));

    // ── опорные точки: станции + выход за конечные на 1.2 км (тупики/оборот) ──
    const pts = line.stations.map((s) => ({ x: s.x, z: s.z }));
    const ext = (a, b) => { const dx = a.x - b.x, dz = a.z - b.z, l = Math.hypot(dx, dz) || 1; return { x: a.x + (dx / l) * 1200, z: a.z + (dz / l) * 1200 }; };
    const ctrl = [ext(pts[0], pts[1]), ...pts, ext(pts[pts.length - 1], pts[pts.length - 2])];

    // ── центростремительный Catmull-Rom с мелкой выборкой ──
    const fine = []; // {x,z,cp?}
    const P = (i) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
    const ctrlFine = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = i === 0 ? { x: 2 * ctrl[0].x - ctrl[1].x, z: 2 * ctrl[0].z - ctrl[1].z } : P(i - 1);
      const p1 = P(i), p2 = P(i + 1);
      const p3 = i + 2 >= ctrl.length ? { x: 2 * p2.x - p1.x, z: 2 * p2.z - p1.z } : P(i + 2);
      const d = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      const n = Math.max(8, Math.ceil(d / 4));
      ctrlFine.push(fine.length);
      const t0 = 0;
      const t1 = t0 + Math.pow(Math.hypot(p1.x - p0.x, p1.z - p0.z), 0.5) + 1e-3;
      const t2 = t1 + Math.pow(d, 0.5) + 1e-3;
      const t3 = t2 + Math.pow(Math.hypot(p3.x - p2.x, p3.z - p2.z), 0.5) + 1e-3;
      for (let k = 0; k < n; k++) {
        const t = t1 + ((t2 - t1) * k) / n;
        const lerp = (a, b, ta, tb) => ({ x: ((tb - t) * a.x + (t - ta) * b.x) / (tb - ta), z: ((tb - t) * a.z + (t - ta) * b.z) / (tb - ta) });
        const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
        const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
        fine.push(lerp(B1, B2, t1, t2));
      }
    }
    ctrlFine.push(fine.length);
    fine.push({ ...ctrl[ctrl.length - 1] });

    // ── равномерная по длине дуги передискретизация ──
    const cum = new Float64Array(fine.length);
    for (let i = 1; i < fine.length; i++) cum[i] = cum[i - 1] + Math.hypot(fine[i].x - fine[i - 1].x, fine[i].z - fine[i - 1].z);
    this.length = cum[cum.length - 1];
    const N = Math.floor(this.length / STEP) + 1;
    this.N = N;
    this.X = new Float64Array(N); this.Z = new Float64Array(N); this.Y = new Float64Array(N);
    this.H = new Float64Array(N); // курс (рад), 0 = на север (−Z)
    this.K = new Float32Array(N); // кривизна 1/м со знаком (+ влево)
    let j = 0;
    for (let i = 0; i < N; i++) {
      const s = i * STEP;
      while (j < cum.length - 2 && cum[j + 1] < s) j++;
      const t = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
      this.X[i] = fine[j].x + (fine[j + 1].x - fine[j].x) * t;
      this.Z[i] = fine[j].z + (fine[j + 1].z - fine[j].z) * t;
    }
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
      this.H[i] = Math.atan2(this.X[b] - this.X[a], -(this.Z[b] - this.Z[a]));
    }
    // сглаженная кривизна по окну ±20 м
    const W = 10;
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - W), b = Math.min(N - 1, i + W);
      let dh = this.H[b] - this.H[a];
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      this.K[i] = -dh / Math.max(STEP, (b - a) * STEP);
    }

    // ── станции ──
    this.stations = line.stations.map((st, i) => {
      const s = cum[ctrlFine[i + 1]];
      const r = mulberry32(hashStr(line.id + st.id));
      const hub = !!st.hub;
      // Тип платформ не подтверждён источниками — выбирается детерминированно (approx)
      const island = hub ? r() < 0.5 : r() < 0.42;
      return {
        ...st, index: i, s,
        island,
        platformLength: hub ? 300 : 272,
        platformWidth: island ? (hub ? 10 : 8) : 5.2,
        canopyLength: hub ? 180 : Math.round(60 + r() * 70),
        crossing: r() < 0.55 ? 'bridge' : 'underpass', // надземный/подземный переход (approx)
        pavilionSide: r() < 0.5 ? -1 : 1,
        extraTracks: hub ? 2 : (r() < 0.25 ? 1 : 0),
        seed: hashStr(st.id),
      };
    });
    this.startS = this.stations[0].s;
    this.endS = this.stations[this.stations.length - 1].s;

    // ── продольный профиль (приблизительный, реальные уклоны не подтверждены) ──
    const ph = [rng() * 10, rng() * 10, rng() * 10];
    const G = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const s = i * STEP;
      let dmin = Infinity;
      for (const st of this.stations) dmin = Math.min(dmin, Math.abs(s - st.s));
      const flat = smoothstep(220, 700, dmin);
      const g = 4.5 * Math.sin(s / 1900 + ph[0]) + 2.5 * Math.sin(s / 830 + ph[1]) + 1.2 * Math.sin(s / 390 + ph[2]);
      G[i] = g * flat; // ‰
    }
    this.G = G;
    let y = 150; // условная отметка
    for (let i = 0; i < N; i++) { this.Y[i] = y; y += (G[i] / 1000) * STEP; }

    this.buildSpeedLimits();
    this.buildSignals();
  }

  idx(s) { return Math.max(0, Math.min(this.N - 1, s / STEP)); }

  sample(arr, s) {
    const f = this.idx(s);
    const i = Math.floor(f), t = f - i;
    const j = Math.min(this.N - 1, i + 1);
    return arr[i] + (arr[j] - arr[i]) * t;
  }

  heading(s) {
    const f = this.idx(s);
    const i = Math.floor(f), t = f - i;
    const j = Math.min(this.N - 1, i + 1);
    let d = this.H[j] - this.H[i];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return this.H[i] + d * t;
  }

  grade(s) { return this.sample(this.G, s); }
  curvature(s) { return this.sample(this.K, s); }
  curveRadius(s) { const k = Math.abs(this.curvature(s)); return k < 1e-5 ? Infinity : 1 / k; }
  elevation(s) { return this.sample(this.Y, s); }

  // Возвышение наружного рельса (рад), визуальное
  cant(s) {
    const k = this.curvature(s);
    const R = Math.abs(k) < 1e-5 ? Infinity : 1 / Math.abs(k);
    const h = isFinite(R) ? Math.min(0.12, (11.8 * 90 * 90) / R / 1000 * 0.6) : 0; // м
    return Math.sign(k) * Math.asin(h / 1.6);
  }

  // Поперечное смещение пути от оси линии. track: +1 — путь направления +1 (правый), −1 — встречный
  trackOffset(s, track) {
    let off = TRACK_HALF;
    for (const st of this.stations) {
      const d = Math.abs(s - st.s);
      if (d > st.platformLength / 2 + 420) continue;
      if (st.island) {
        const want = st.platformWidth / 2 + PLATFORM_EDGE;
        const t = 1 - smoothstep(st.platformLength / 2 + 20, st.platformLength / 2 + 400, d);
        off = Math.max(off, TRACK_HALF + (want - TRACK_HALF) * t);
      }
    }
    return off * track;
  }

  // Точка в мире: s — пикетаж, lat — смещение вправо от оси (в направлении +s), h — высота над УГР
  point(s, lat = 0, h = 0, out = { x: 0, y: 0, z: 0 }) {
    const f = this.idx(s);
    const i = Math.floor(f), t = f - i;
    const j = Math.min(this.N - 1, i + 1);
    const x = this.X[i] + (this.X[j] - this.X[i]) * t;
    const z = this.Z[i] + (this.Z[j] - this.Z[i]) * t;
    const hd = this.heading(s);
    // вправо от направления (sin h, −cos h) → (cos h, sin h)
    out.x = x + Math.cos(hd) * lat;
    out.z = z + Math.sin(hd) * lat;
    out.y = this.Y[i] + (this.Y[j] - this.Y[i]) * t + h;
    // экстраполяция за концами
    if (s < 0) { out.x += Math.sin(hd) * s; out.z -= Math.cos(hd) * s; }
    else if (s > this.length) { const e = s - this.length; out.x += Math.sin(hd) * e; out.z -= Math.cos(hd) * e; }
    return out;
  }

  // Обратная проекция: мировые (x, z) → пикетаж s и смещение lat. sHint — приблизительное s.
  project(x, z, sHint, range = 300) {
    let best = sHint, bd = Infinity;
    const a = Math.max(0, sHint - range), b = Math.min(this.length, sHint + range);
    for (let s = a; s <= b; s += 4) {
      const i = Math.round(s / STEP);
      const d = (this.X[i] - x) ** 2 + (this.Z[i] - z) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    // уточнение
    for (let k = 0; k < 3; k++) {
      const hd = this.heading(best);
      const p = this.point(best, 0, 0);
      const along = (x - p.x) * Math.sin(hd) - (z - p.z) * Math.cos(hd);
      best = Math.max(0, Math.min(this.length, best + along));
    }
    const hd = this.heading(best);
    const p = this.point(best, 0, 0);
    const lat = (x - p.x) * Math.cos(hd) + (z - p.z) * Math.sin(hd);
    return { s: best, lat };
  }

  stationAt(s, margin = 0) {
    for (const st of this.stations) if (Math.abs(s - st.s) <= st.platformLength / 2 + margin) return st;
    return null;
  }

  nextStation(s, dir, includeCurrent = false) {
    const list = dir > 0 ? this.stations : [...this.stations].reverse();
    for (const st of list) {
      const d = (st.s - s) * dir;
      if (d > (includeCurrent ? -st.platformLength / 2 : 5)) return st;
    }
    return null;
  }

  // ── ограничения скорости (approx: по радиусу кривых и зонам город/область) ──
  buildSpeedLimits() {
    const N = this.N;
    const lim = new Float32Array(N);
    const cityR = 14000;
    for (let i = 0; i < N; i++) {
      const s = i * STEP;
      const dc = Math.hypot(this.X[i], this.Z[i]);
      let v = dc < cityR * 0.55 ? 60 : dc < cityR ? 80 : 120;
      const R = Math.abs(this.K[i]) < 1e-5 ? Infinity : 1 / Math.abs(this.K[i]);
      if (isFinite(R)) v = Math.min(v, Math.max(25, Math.floor((3.6 * Math.sqrt(0.75 * R)) / 5) * 5));
      // тупики за конечными
      if (s < this.startS - 150 || s > this.endS + 150) v = Math.min(v, 25);
      else if (s < this.startS + 400 || s > this.endS - 400) v = Math.min(v, 60);
      lim[i] = v;
    }
    // минимум по окну 150 м — ограничение действует на всём участке кривой
    const W = Math.round(75 / STEP);
    const lim2 = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let m = 999;
      for (let k = Math.max(0, i - W); k <= Math.min(N - 1, i + W); k++) m = Math.min(m, lim[k]);
      lim2[i] = m;
    }
    // сегменты, короткие (<250 м) поднятия сливаем с соседями
    let segs = [];
    let s0 = 0, cur = lim2[0];
    for (let i = 1; i < N; i++) {
      if (lim2[i] !== cur) { segs.push({ s0, s1: i * STEP, v: cur }); s0 = i * STEP; cur = lim2[i]; }
    }
    segs.push({ s0, s1: this.length, v: cur });
    for (let pass = 0; pass < 3; pass++) {
      const out = [];
      for (let k = 0; k < segs.length; k++) {
        const sg = segs[k];
        const prev = out[out.length - 1], next = segs[k + 1];
        if (sg.s1 - sg.s0 < 250 && prev && next && sg.v > Math.min(prev.v, next.v)) {
          sg.v = Math.min(prev.v, next.v);
        }
        if (prev && prev.v === sg.v) prev.s1 = sg.s1; else out.push({ ...sg });
      }
      segs = out;
    }
    this.limits = segs;
  }

  limitAt(s) {
    const L = this.limits;
    let lo = 0, hi = L.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (L[m].s0 <= s) lo = m; else hi = m - 1; }
    return L[lo].v;
  }

  // минимальное ограничение на участке [a, b]
  limitRange(a, b) {
    if (a > b) [a, b] = [b, a];
    let v = 999;
    for (const sg of this.limits) if (sg.s1 >= a && sg.s0 <= b) v = Math.min(v, sg.v);
    return v;
  }

  // ближайшее снижение ограничения впереди (для КЛУБ)
  nextLimitDrop(s, dir, current, range = 3000) {
    let best = null;
    for (const sg of this.limits) {
      const start = dir > 0 ? sg.s0 : sg.s1;
      const d = (start - s) * dir;
      if (d > 0 && d < range && sg.v < current) {
        if (!best || d < best.dist) best = { dist: d, v: sg.v, s: start };
      }
    }
    return best;
  }

  // ── сигналы автоблокировки ──
  buildSignals() {
    this.signals = { 1: [], [-1]: [] };
    const st = this.stations;
    let odd = 1, even = 2;
    for (const dir of [1, -1]) {
      const list = this.signals[dir];
      const ord = dir > 0 ? st : [...st].reverse();
      for (let k = 0; k < ord.length; k++) {
        const a = ord[k];
        const half = a.platformLength / 2;
        const exitS = a.s + dir * (half + 25);
        const isLast = k === ord.length - 1;
        list.push({ s: exitS, dir, kind: isLast ? 'end' : 'exit', station: a.index, name: (dir > 0 ? 'Н' : 'Ч') + (dir > 0 ? 1 : 2), aspect: 'red' });
        if (isLast) break;
        const b = ord[k + 1];
        const entryS = b.s - dir * (b.platformLength / 2 + 350);
        const span = (entryS - exitS) * dir;
        const n = Math.max(0, Math.round(span / 1700));
        for (let m = 1; m <= n; m++) {
          const s = exitS + dir * (span * m) / (n + 1);
          const num = dir > 0 ? (odd += 2) : (even += 2);
          list.push({ s, dir, kind: 'block', name: String(num), aspect: 'green' });
        }
        if (span > 500) list.push({ s: entryS, dir, kind: 'entry', station: b.index, name: dir > 0 ? 'Н' : 'Ч', aspect: 'green' });
      }
      list.sort((p, q) => (p.s - q.s) * dir);
      list.forEach((sg, i) => { sg.i = i; });
    }
  }
}
