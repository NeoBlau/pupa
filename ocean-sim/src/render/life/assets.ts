/**
 * Loads the third-party glTF models (see public/models/credits.json) and
 * normalises them: head toward +X, dorsal side +Y, real body length, centred.
 */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { patchObject } from "../water";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<GLTF>>();

export function loadModel(id: string, base = import.meta.env.BASE_URL): Promise<GLTF> {
  const ext = import.meta.env.VITE_MODEL_EXT ?? "glb";
  if (!cache.has(id)) cache.set(id, loader.loadAsync(`${base}models/${id}.${ext}`));
  return cache.get(id)!;
}

/**
 * Visit every rendered vertex of visible meshes in the root's frame. Uses
 * Mesh.getVertexPosition, which applies skinning, so skinned models (whose
 * raw attributes are in bone space) are measured as they are drawn.
 */
function eachVertex(root: THREE.Object3D, stride: number, fn: (v: THREE.Vector3) => void) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) (m as THREE.SkinnedMesh).skeleton.update();
    const mat = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const n = m.geometry.getAttribute("position").count;
    for (let i = 0; i < n; i += stride) {
      m.getVertexPosition(i, v);
      fn(v.applyMatrix4(mat));
    }
  });
}

function localBox(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  eachVertex(root, 3, (v) => box.expandByPoint(v));
  return box;
}

/** Which end along `axis` is thicker (the head, for fish and turtles). */
function thickEnd(root: THREE.Object3D, axis: "x" | "z", box: THREE.Box3): 1 | -1 {
  const c = box.getCenter(new THREE.Vector3());
  const other = axis === "x" ? "z" : "x";
  let pos = 0, neg = 0, np = 0, nn = 0;
  eachVertex(root, 2, (v) => {
    const girth = Math.abs(v.y - c.y) + Math.abs(v[other] - c[other]);
    if (v[axis] > c[axis]) { pos += girth; np++; } else { neg += girth; nn++; }
  });
  return pos / Math.max(np, 1) >= neg / Math.max(nn, 1) ? 1 : -1;
}

export interface Prefab {
  /** Create a normalised instance: head → +X, length = `length` metres. */
  make(): { obj: THREE.Object3D; mixer: THREE.AnimationMixer | null; actions: Record<string, THREE.AnimationAction> };
}

export interface PrefabOptions {
  /** Keep only meshes whose index (in traversal order) is listed. */
  meshIndex?: number;
  length: number;
  /** Force the head direction instead of the girth heuristic. */
  head?: "+x" | "-x" | "+z" | "-z";
  /** Extra rotation after normalisation (radians about X, Y, Z). */
  extra?: [number, number, number];
  tint?: number;
  /** The mesh holds several rigged individuals: keep only the first (by bone-name prefix). */
  single?: boolean;
}

/**
 * Keep only the triangles skinned to the first individual of a multi-fish mesh
 * (bones are named "<Name>1:…", "<Name>2:…"). Returns a new index buffer.
 */
function firstIndividual(mesh: THREE.SkinnedMesh) {
  const g = mesh.geometry;
  const joints = g.getAttribute("skinIndex");
  const weights = g.getAttribute("skinWeight");
  const bones = mesh.skeleton.bones;
  const prefixOf = (i: number) => {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = weights.getComponent(i, k); if (w > bw) { bw = w; best = joints.getComponent(i, k); } }
    const name = bones[best]?.name ?? "";
    return name.includes(":") ? name.split(":")[0] : name;
  };
  const target = prefixOf(0);
  const idx = g.index ? Array.from(g.index.array as ArrayLike<number>) : Array.from({ length: g.getAttribute("position").count }, (_, i) => i);
  const keep: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    if (prefixOf(idx[t]) === target) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  const ng = g.clone();
  ng.setIndex(keep);
  mesh.geometry = ng;
}

export async function prefab(id: string, o: PrefabOptions): Promise<Prefab> {
  const gltf = await loadModel(id);
  const src = gltf.scene;
  // measure one isolated copy
  const probe = cloneSkinned(src);
  let idx = 0;
  const meshes: THREE.Object3D[] = [];
  probe.traverse((x) => { if ((x as THREE.Mesh).isMesh) meshes.push(x); });
  if (o.meshIndex !== undefined) meshes.forEach((m, i) => (m.visible = i === o.meshIndex));
  const singleGeo = new Map<number, THREE.BufferGeometry>();
  if (o.single) meshes.forEach((m, i) => { if (m.visible && (m as THREE.SkinnedMesh).isSkinnedMesh) { firstIndividual(m as THREE.SkinnedMesh); singleGeo.set(i, (m as THREE.Mesh).geometry); } });
  const box = localBox(probe);
  const size = box.getSize(new THREE.Vector3());
  const axis: "x" | "z" = size.x >= size.z ? "x" : "z";
  let dir: 1 | -1 = thickEnd(probe, axis, box);
  let ax = axis;
  if (o.head) { ax = o.head[1] as "x" | "z"; dir = o.head[0] === "+" ? 1 : -1; }
  const yaw = ax === "x" ? (dir > 0 ? 0 : Math.PI) : dir > 0 ? -Math.PI / 2 : Math.PI / 2;
  const len = ax === "x" ? size.x : size.z;
  const scale = o.length / len;
  const center = box.getCenter(new THREE.Vector3());
  void idx;
  return {
    make() {
      const inst = cloneSkinned(src);
      const list: THREE.Object3D[] = [];
      inst.traverse((x) => { if ((x as THREE.Mesh).isMesh) list.push(x); });
      if (o.meshIndex !== undefined) list.forEach((m, i) => (m.visible = i === o.meshIndex));
      singleGeo.forEach((geo, i) => ((list[i] as THREE.Mesh).geometry = geo));
      inst.traverse((x) => {
        const m = x as THREE.Mesh;
        if (!m.isMesh) return;
        m.frustumCulled = false;
        m.castShadow = false;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        m.material = mats.length === 1 ? mats[0].clone() : mats.map((mm) => mm.clone());
        if (o.tint) for (const mm of Array.isArray(m.material) ? m.material : [m.material]) (mm as THREE.MeshStandardMaterial).color?.multiply(new THREE.Color(o.tint));
      });
      inst.position.copy(center).multiplyScalar(-1);
      const pivot = new THREE.Group();
      const orient = new THREE.Group();
      orient.rotation.y = yaw;
      if (o.extra) orient.rotation.set(o.extra[0], yaw + o.extra[1], o.extra[2]);
      orient.scale.setScalar(scale);
      orient.add(inst);
      pivot.add(orient);
      patchObject(pivot);
      let mixer: THREE.AnimationMixer | null = null;
      const actions: Record<string, THREE.AnimationAction> = {};
      if (gltf.animations.length) {
        mixer = new THREE.AnimationMixer(inst);
        for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
      }
      return { obj: pivot, mixer, actions };
    },
  };
}
