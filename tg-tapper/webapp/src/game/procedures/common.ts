import * as THREE from 'three';
import type { ModelDef } from '@shared/game.ts';
import { ease, type Engine } from '../engine.ts';

export type DesignId = 'heart' | 'star' | 'moon';

/** A finished tattoo, stored per model so it survives reloads. */
export interface TattooSave {
  design: DesignId;
  c: [number, number, number];
  n: [number, number, number];
  t1: [number, number, number];
  size: number;
}

export interface ProcCtx {
  model: ModelDef;
  getTattoo(): TattooSave | null;
  saveTattoo(t: TattooSave | null): void;
}

export interface Surf {
  p: THREE.Vector3;
  n: THREE.Vector3;
  uv: THREE.Vector2;
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
const UP = new THREE.Vector3(0, 1, 0);

export function clampLen(v: THREE.Vector3, max: number) {
  const l = v.length();
  return l > max ? v.clone().multiplyScalar(max / l) : v.clone();
}

/** Downhill direction along the skin at a point with normal n. */
export function downhill(n: THREE.Vector3) {
  const g = new THREE.Vector3(0, -1, 0);
  return g.sub(n.clone().multiplyScalar(g.dot(n))).normalize();
}

/** Glowing target ring lying on the skin. */
export function marker(e: Engine, s: Surf, color: number) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), mat);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.25, 24), mat);
  const g = new THREE.Group();
  ring.rotation.x = dot.rotation.x = -Math.PI / 2;
  g.add(ring, dot);
  e.attach(g, s.p.clone().addScaledVector(s.n, 0.0004), s.n);
  const draw = (phase: number, alpha: number) => {
    const r = (12 + (1 - phase) * 60) * e.u;
    ring.scale.setScalar(r);
    dot.scale.setScalar(9 * e.u * 4);
    mat.opacity = alpha * (0.35 + phase * 0.65);
  };
  return { g, draw };
}

/** Bubbles (peroxide / soap) popping around a point. */
export function fizz(e: Engine, s: { p: THREE.Vector3; n: THREE.Vector3 }, spread: number, tint = 0xffffff) {
  for (let i = 0; i < 3; i++) {
    const p = s.p.clone().add(new THREE.Vector3(rand(-spread, spread), rand(-spread, spread), rand(-spread, spread) * 0.3)).addScaledVector(s.n, 0.0015);
    e.particle('bubble', p, rand(1.2, 3.2) * 0.001, { v: s.n.clone().multiplyScalar(rand(0.004, 0.012)), grow: 0.6, max: rand(0.4, 0.9), tint });
  }
}

/** Water droplets falling from a tool onto the skin. */
export function spray(e: Engine, s: { p: THREE.Vector3; n: THREE.Vector3 }, spread = 0.008) {
  for (let i = 0; i < 2; i++) {
    const target = s.p.clone().add(new THREE.Vector3(rand(-spread, spread), rand(-spread, spread), 0));
    const from = target.clone().addScaledVector(s.n, 0.03);
    e.particle('water', from, rand(1.2, 2.4) * 0.001, { v: s.n.clone().multiplyScalar(-0.2), max: 0.15, alpha: 0.85 });
  }
}

/** Small glossy liquid bead (blood, pus, oil, water) sitting on the skin. */
export function bead(e: Engine, s: Surf, mat: THREE.Material, r: number) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
  m.scale.set(r, r * 0.55, r);
  m.castShadow = true;
  e.attach(m, s.p, s.n);
  return m;
}

export function setBeadSize(m: THREE.Object3D, r: number) {
  m.scale.set(r, r * 0.55, r);
}

export function tweenTo(e: Engine, o: THREE.Object3D, to: THREE.Vector3, dur: number, done?: () => void) {
  const from = o.position.clone();
  e.tween(dur, (k) => e.moveAttached(o, from.clone().lerp(to, ease.out(k))), done);
}

export { UP };
