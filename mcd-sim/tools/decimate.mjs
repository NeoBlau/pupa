// Облегчение фотограмметрических деревьев Poly Haven (миллионы треугольников) до игрового бюджета.
// Листва (материалы *twig*, *leaves*, *needle*): оставляем случайную долю «островков» (отдельных веточек/листьев)
// и увеличиваем их, чтобы сохранить силуэт кроны. Остальное — упрощение meshoptimizer.
//   node tools/decimate.mjs in.glb out.glb [бюджет_листвы_на_меш=24000] [бюджет_ствола=2500]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [, , inp, out, folBudgetArg, solidBudgetArg] = process.argv;
const FOL_BUDGET = Number(folBudgetArg || 24000);
const SOLID_BUDGET = Number(solidBudgetArg || 2500);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
await MeshoptSimplifier.ready;

let seed = 1234567;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function islands(idx, n) {
  const par = new Int32Array(n);
  for (let i = 0; i < n; i++) par[i] = i;
  const f = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let i = 0; i < idx.length; i += 3) { const a = f(idx[i]); par[f(idx[i + 1])] = a; par[f(idx[i + 2])] = a; }
  const groups = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const r = f(idx[t]);
    let g = groups.get(r); if (!g) groups.set(r, (g = []));
    g.push(t);
  }
  return [...groups.values()];
}

for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const mat = (prim.getMaterial()?.getName() || '').toLowerCase();
    const isFoliage = /twig|leaves|leaf|needle|foliage/.test(mat);
    const idxAcc = prim.getIndices();
    const idx = idxAcc.getArray();
    const tris = idx.length / 3;
    if (!isFoliage) continue;
    if (tris <= FOL_BUDGET) continue;
    const pos = prim.getAttribute('POSITION');
    const P = pos.getArray();
    const groups = islands(idx, pos.getCount());
    const avg = tris / groups.length;
    const keepN = Math.max(1, Math.round(FOL_BUDGET / avg));
    const p = Math.min(1, keepN / groups.length);
    const scale = Math.min(3.2, 1 / Math.sqrt(p));
    // Предпочитаем внешние островки (дальше от оси) — они формируют силуэт.
    const newIdx = [];
    const touched = new Uint8Array(pos.getCount());
    for (const g of groups) {
      if (rnd() > p) continue;
      let cx = 0, cy = 0, cz = 0, c = 0;
      for (const t of g) for (let k = 0; k < 3; k++) { const v = idx[t + k]; cx += P[v * 3]; cy += P[v * 3 + 1]; cz += P[v * 3 + 2]; c++; }
      cx /= c; cy /= c; cz /= c;
      for (const t of g) for (let k = 0; k < 3; k++) {
        const v = idx[t + k];
        newIdx.push(v);
        if (!touched[v]) {
          touched[v] = 1;
          P[v * 3] = cx + (P[v * 3] - cx) * scale;
          P[v * 3 + 1] = cy + (P[v * 3 + 1] - cy) * scale;
          P[v * 3 + 2] = cz + (P[v * 3 + 2] - cz) * scale;
        }
      }
    }
    pos.setArray(P);
    const arr = new Uint32Array(newIdx);
    idxAcc.setArray(arr);
    console.log(mesh.getName(), mat, tris, '->', arr.length / 3, `(доля ${p.toFixed(3)}, масштаб ${scale.toFixed(2)})`);
  }
}
// Стволы/ветви: упрощение meshoptimizer до бюджета, затем удаление неиспользуемых вершин.
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const mat = (prim.getMaterial()?.getName() || '').toLowerCase();
    let idx = prim.getIndices().getArray();
    if (!/twig|leaves|leaf|needle|foliage/.test(mat) && idx.length / 3 > SOLID_BUDGET) {
      const pos = prim.getAttribute('POSITION').getArray();
      const [res] = MeshoptSimplifier.simplify(new Uint32Array(idx), pos, 3, SOLID_BUDGET * 3, 0.05, []);
      console.log(mesh.getName(), mat, idx.length / 3, '->', res.length / 3);
      idx = res;
    }
    compact(prim, idx);
  }
}
function compact(prim, idx) {
  const n = prim.getAttribute('POSITION').getCount();
  const remap = new Int32Array(n).fill(-1);
  let m = 0;
  const out = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) { const v = idx[i]; if (remap[v] < 0) remap[v] = m++; out[i] = remap[v]; }
  for (const sem of prim.listSemantics()) {
    const acc = prim.getAttribute(sem);
    const src = acc.getArray(); const k = acc.getElementSize();
    const dst = new src.constructor(m * k);
    for (let v = 0; v < n; v++) if (remap[v] >= 0) for (let j = 0; j < k; j++) dst[remap[v] * k + j] = src[v * k + j];
    const copy = doc.createAccessor().setType(acc.getType()).setArray(dst).setNormalized(acc.getNormalized()).setBuffer(acc.getBuffer());
    prim.setAttribute(sem, copy);
  }
  const ia = doc.createAccessor().setType('SCALAR').setArray(m > 65535 ? out : new Uint16Array(out)).setBuffer(prim.getIndices().getBuffer());
  prim.setIndices(ia);
}
await doc.transform(prune(), dedup());
await io.write(out, doc);
let total = 0;
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) total += prim.getIndices().getCount() / 3;
console.log('итого треугольников:', total);
