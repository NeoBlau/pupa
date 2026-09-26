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
  if (!cache.has(id)) cache.set(id, loader.loadAsync(`${base}models/${id}.glb`));
  return cache.get(id)!;
}

/** Bounding box of an object in its own frame, skinned meshes in bind pose. */
function localBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const pos = m.geometry.getAttribute("position");
    const mat = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    for (let i = 0; i < pos.count; i += 3) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(mat));
  });
  return box;
}

/** Which end along `axis` is thicker (the head, for fish and turtles). */
function thickEnd(root: THREE.Object3D, axis: "x" | "z", box: THREE.Box3): 1 | -1 {
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const c = box.getCenter(new THREE.Vector3());
  const other = axis === "x" ? "z" : "x";
  let pos = 0, neg = 0, np = 0, nn = 0;
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const a = m.geometry.getAttribute("position");
    const mat = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    for (let i = 0; i < a.count; i += 2) {
      v.fromBufferAttribute(a, i).applyMatrix4(mat);
      const girth = Math.abs(v.y - c.y) + Math.abs(v[other] - c[other]);
      if (v[axis] > c[axis]) { pos += girth; np++; } else { neg += girth; nn++; }
    }
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
