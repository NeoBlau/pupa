// Упрощение модели до бюджета треугольников (meshoptimizer), с сохранением материалов и UV.
//   node tools/lod.mjs in.glb out.glb <бюджет треугольников> [погрешность=0.01]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [, , inp, out, budgetArg, errArg] = process.argv;
const budget = Number(budgetArg);
const err = Number(errArg || 0.01);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
await MeshoptSimplifier.ready;
await doc.transform(weld({ tolerance: 0.0001 }));

let total = 0;
const prims = [];
for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
  if (!p.getIndices()) continue;
  const t = p.getIndices().getCount() / 3; total += t; prims.push(p);
}
const ratio = Math.min(1, budget / total);
console.log(inp.split('/').pop(), 'треугольников', total, '→ цель', Math.round(total * ratio));
let after = 0;
if (ratio < 1) {
  for (const p of prims) {
    const idx = p.getIndices();
    const tris = idx.getCount() / 3;
    if (tris < 60) { after += tris; continue; }
    const pos = p.getAttribute('POSITION').getArray();
    const target = Math.max(12, Math.floor(tris * ratio)) * 3;
    const [res] = MeshoptSimplifier.simplify(new Uint32Array(idx.getArray()), pos, 3, target, err, ['LockBorder']);
    const [res2] = res.length / 3 > tris * ratio * 1.6 ? MeshoptSimplifier.simplify(new Uint32Array(idx.getArray()), pos, 3, target, err * 4, []) : [res];
    const fin = res2.length < res.length ? res2 : res;
    idx.setArray(p.getAttribute('POSITION').getCount() > 65535 ? new Uint32Array(fin) : new Uint16Array(fin));
    after += fin.length / 3;
  }
} else after = total;
await doc.transform(prune(), dedup());
await io.write(out, doc);
console.log('  итог', after);
