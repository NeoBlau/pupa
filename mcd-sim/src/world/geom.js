// Вспомогательная геометрия: протяжка профиля вдоль оси пути, мелкие детали.
import * as THREE from 'three';

const tmp = { x: 0, y: 0, z: 0 };

// Протягивает поперечный профиль вдоль пути.
// profile(s) → [{lat, h, u?}] — точки сечения слева направо; origin — начало координат чанка.
// uMode: 'lat' — u по поперечной координате, 'len' — по длине контура; vScale — масштаб v по длине.
export function sweep(route, s0, s1, step, profile, origin, { uScale = 1, vScale = 1, closed = false, flipNormals = false, colorFn = null } = {}) {
  const rows = [];
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const pr = profile(s);
    const row = [];
    let acc = 0;
    for (let k = 0; k < pr.length; k++) {
      const p = pr[k];
      route.point(s, p.lat, p.h, tmp);
      if (k > 0) acc += Math.hypot(p.lat - pr[k - 1].lat, p.h - pr[k - 1].h);
      row.push({ x: tmp.x - origin.x, y: tmp.y - origin.y, z: tmp.z - origin.z, u: (p.u ?? acc) * uScale, v: s * vScale, c: colorFn ? colorFn(tmp.x, tmp.z, p) : null });
    }
    rows.push(row);
  }
  const m = rows[0].length;
  const pos = new Float32Array(rows.length * m * 3);
  const uv = new Float32Array(rows.length * m * 2);
  let pi = 0, ui = 0;
  for (const row of rows) for (const p of row) { pos[pi++] = p.x; pos[pi++] = p.y; pos[pi++] = p.z; uv[ui++] = p.u; uv[ui++] = p.v; }
  const idx = [];
  for (let i = 0; i < rows.length - 1; i++) {
    for (let k = 0; k < m - 1 + (closed ? 1 : 0); k++) {
      const k2 = (k + 1) % m;
      const a = i * m + k, b = i * m + k2, c = (i + 1) * m + k, d = (i + 1) * m + k2;
      // по умолчанию: профиль слева направо → нормаль вверх; сверху вниз → нормаль вправо (+lat)
      if (flipNormals) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (colorFn) {
    const col = new Float32Array(rows.length * m * 3); let ci = 0;
    for (const row of rows) for (const p of row) { col[ci++] = p.c[0]; col[ci++] = p.c[1]; col[ci++] = p.c[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Матрица для объекта, стоящего на пути: s, lat, h, rotY (доп. поворот), учитывая курс.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
export function placeMatrix(route, s, lat, h, origin, { yaw = 0, roll = 0, scale = 1, out = new THREE.Matrix4() } = {}) {
  route.point(s, lat, h, tmp);
  const hd = route.heading(s);
  _e.set(0, -hd + yaw, roll, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(tmp.x - origin.x, tmp.y - origin.y, tmp.z - origin.z);
  _s.set(scale, scale, scale);
  return out.compose(_p, _q, _s);
}

// Простейший «ящик» с фасками — для бетонных шпал и мелких деталей
export function bevelBox(w, h, d, bevel = 0.02) {
  const shape = new THREE.Shape();
  const x = w / 2 - bevel, y = h / 2 - bevel;
  shape.moveTo(-x, -h / 2); shape.lineTo(x, -h / 2); shape.lineTo(w / 2, -y); shape.lineTo(w / 2, y); shape.lineTo(x, h / 2);
  shape.lineTo(-x, h / 2); shape.lineTo(-w / 2, y); shape.lineTo(-w / 2, -y); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

export function mergeGeoms(list) {
  // минимальное слияние (позиции, нормали, uv) без зависимостей
  let vc = 0, ic = 0;
  for (const g of list) { const gg = g.index ? g : g; vc += gg.attributes.position.count; ic += gg.index ? gg.index.count : gg.attributes.position.count; }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    pos.set(p.array, vo * 3);
    if (n) nor.set(n.array, vo * 3);
    if (u) uv.set(u.array, vo * 2);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo;
    else for (let i = 0; i < p.count; i++) idx[io++] = i + vo;
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export function tf(g, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  g.applyMatrix4(m);
  return g;
}
