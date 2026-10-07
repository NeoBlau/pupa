// Статическое объединение мешей по материалу — сокращает число вызовов отрисовки в чанках и на станциях.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const inv = new THREE.Matrix4(), rel = new THREE.Matrix4();

export function batchStatic(root) {
  root.updateMatrixWorld(true);
  inv.copy(root.matrixWorld).invert();
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.userData.keep) return;
    let p = o.parent; let skip = false;
    while (p && p !== root) { if (p.userData.keep || p.userData.signal) { skip = true; break; } p = p.parent; }
    if (skip) return;
    const key = o.material.uuid;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  let merged = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = [];
    let cast = false, receive = false;
    const anyNonIndexed = list.some((m) => !m.geometry.index);
    for (const m of list) {
      rel.multiplyMatrices(inv, m.matrixWorld);
      let g = m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (anyNonIndexed && g.index) g = g.toNonIndexed();
      g.applyMatrix4(rel);
      g.morphAttributes = {};
      geos.push(g);
      cast = cast || m.castShadow; receive = receive || m.receiveShadow;
    }
    const mg = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!mg) continue;
    const mesh = new THREE.Mesh(mg, list[0].material);
    mesh.castShadow = cast; mesh.receiveShadow = receive;
    mesh.renderOrder = list[0].renderOrder;
    root.add(mesh);
    for (const m of list) { m.removeFromParent(); if (m.geometry.userData.shared !== true) m.geometry.dispose(); }
    merged += list.length;
  }
  // пустые группы удалить
  const empty = [];
  root.traverse((o) => { if (o !== root && o.type === 'Group' && o.children.length === 0) empty.push(o); });
  empty.forEach((o) => o.removeFromParent());
  return merged;
}
