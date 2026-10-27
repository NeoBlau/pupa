import * as THREE from 'three';
import type { ModelDef } from '@shared/game.ts';
import { ease, type Engine, type LayerId, type Ptr, type Step } from '../engine.ts';
import type { ToolName } from '../tools3d.ts';
import type { TexName } from '../textures.ts';
import { roundedSlab } from '../geom.ts';

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

/** Generic "rub over an area" step: paints or erases a layer until coverage hits the target. */
export function rubStep(
  e: Engine,
  o: {
    title: string;
    hint: string;
    cursor: ToolName | null;
    layer: LayerId;
    mode: 'paint' | 'erase';
    region?: () => number[];
    radius: number;
    alpha: number;
    tex?: TexName;
    target: number;
    alsoErase?: [LayerId, number][];
    alsoPaint?: [LayerId, number, number][];
    units?: number;
    drag?: number;
    loop?: string;
    onMove?(p: Ptr): void;
    onUpdate?(dt: number): void;
    onEnter?(): void;
  },
): Step {
  let start = 0;
  let last = 0;
  const prev = new THREE.Vector3();
  const cells = () => (o.region ? o.region() : undefined);
  const progress = () => {
    const cov = e.coverage(o.layer, cells());
    if (o.mode === 'paint') return clamp01(cov / o.target);
    if (start <= o.target) return 1;
    return clamp01((start - cov) / (start - o.target));
  };
  return {
    title: o.title,
    hint: o.hint,
    cursor: o.cursor,
    enter() {
      start = e.coverage(o.layer, cells());
      last = progress();
      o.onEnter?.();
    },
    down(p) {
      prev.copy(p.p);
      if (o.loop) e.hooks.loop(o.loop, true);
      this.move!(p);
    },
    move(p) {
      const r = o.radius * e.u;
      e.paintLine(o.layer, prev, p.p, r, { alpha: o.alpha, tex: o.tex, erase: o.mode === 'erase' });
      for (const [id, a] of o.alsoErase ?? []) e.paintLine(id, prev, p.p, r, { alpha: a, erase: true });
      for (const [id, a, rr] of o.alsoPaint ?? []) e.paintLine(id, prev, p.p, rr * e.u, { alpha: a });
      if (o.drag) e.force(p.p, 90 * e.u, clampLen(p.delta.clone().multiplyScalar(o.drag), 6 * e.u * 5));
      prev.copy(p.p);
      o.onMove?.(p);
      const now = progress();
      if (now > last) e.work((now - last) * (o.units ?? 30));
      last = Math.max(last, now);
    },
    up() {
      if (o.loop) e.hooks.loop(o.loop, false);
    },
    update(dt) {
      o.onUpdate?.(dt);
    },
    progress,
  };
}

/** Drag a dressing onto the spot; it then wraps over the skin as a decal. */
export function bandageStep(e: Engine, target: () => Surf, size: () => number, store: { o: THREE.Object3D | null }): Step {
  let placed = false;
  let preview: THREE.Mesh | null = null;
  const rot = rand(-0.5, 0.5);
  return {
    title: 'Dress',
    hint: 'Drag the bandage onto the spot',
    cursor: null,
    enter() {
      placed = false;
    },
    down(p) {
      if (placed) return;
      if (!preview) {
        const w = size() * 2.4;
        preview = new THREE.Mesh(roundedSlab(w, w * 0.45, 0.0008, w * 0.2), e.M.bandageDecal);
        e.root.add(preview);
      }
      this.move!(p);
    },
    move(p) {
      if (placed || !preview) return;
      preview.position.copy(p.p).addScaledVector(p.n, 0.004);
      preview.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.n);
      preview.rotateZ(rot);
    },
    up(p) {
      if (placed || !preview) return;
      const t = target();
      if (p.p.distanceTo(t.p) < size() * 0.9) {
        placed = true;
        preview.removeFromParent();
        preview = null;
        const w = size() * 2.4;
        store.o = e.decal(e.M.bandageDecal.clone(), t.p, t.n, new THREE.Vector3(w, w * 0.45, w), rot);
        e.press(t.p, size(), 0.001);
        e.impulse(t.p, size(), 0.04);
        e.hooks.sfx('squish');
        e.hooks.haptic('medium');
        e.work(10);
      } else {
        e.floatText(p.p, 'Closer!', '#ffd36b');
      }
    },
    exit() {
      preview?.removeFromParent();
      preview = null;
    },
    progress: () => (placed ? 1 : 0),
  };
}

/** Time-lapse healing: runs on its own. */
export function healStep(e: Engine, dur: number, fn: (k: number, dt: number) => void, onDone?: () => void): Step {
  let t = 0;
  let done = false;
  return {
    title: 'Heal',
    hint: 'Days pass… the skin heals',
    cursor: null,
    enter() {
      t = 0;
      done = false;
      e.hooks.sfx('heal');
    },
    update(dt) {
      if (done) return;
      t += dt;
      const k = clamp01(t / dur);
      fn(k, dt);
      if (k >= 1) {
        done = true;
        e.floatText(e.L.center.clone().add(new THREE.Vector3(0, 0, 0.03)), 'Healed ✨', '#9dffc4', 30);
        onDone?.();
      }
    },
    progress: () => clamp01(t / dur),
  };
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
