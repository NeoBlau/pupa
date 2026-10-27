import * as THREE from 'three';
import type { Engine } from '../engine.ts';
import type { DesignId, TattooSave } from './common.ts';

type P2 = { x: number; y: number };

// ---------------------------------------------------------------------------
// Designs in unit space (-1..1), closed outlines.

function unitDesign(id: DesignId): P2[] {
  const pts: P2[] = [];
  if (id === 'heart') {
    for (let i = 0; i <= 120; i++) {
      const t = (i / 120) * Math.PI * 2;
      pts.push({ x: (16 * Math.sin(t) ** 3) / 17, y: (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17 });
    }
  } else if (id === 'star') {
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 0.42 : 1;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
  } else {
    // Crescent: outer circle r=1 minus inner circle r=0.8 at (0.45, 0).
    const a0 = Math.atan2(0.78, 0.625);
    for (let i = 0; i <= 60; i++) {
      const a = a0 + (i / 60) * (Math.PI * 2 - 2 * a0);
      pts.push({ x: Math.cos(a), y: Math.sin(a) });
    }
    const b0 = Math.atan2(0.78, 0.175);
    for (let i = 0; i <= 50; i++) {
      const a = Math.PI * 2 - b0 - (i / 50) * (Math.PI * 2 - 2 * b0);
      pts.push({ x: 0.45 + Math.cos(a) * 0.8, y: Math.sin(a) * 0.8 });
    }
    pts.push(pts[0]);
  }
  return pts;
}

export function pointInPoly(x: number, y: number, poly: P2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Tangent frame on the skin where the design is placed. */
function frame(t: TattooSave) {
  const c = new THREE.Vector3(...t.c);
  const n = new THREE.Vector3(...t.n);
  const t1 = new THREE.Vector3(...t.t1);
  const t2 = n.clone().cross(t1).normalize();
  return { c, n, t1, t2 };
}

/** Outline snapped onto the skin, resampled every `step` metres. */
export function designPath(e: Engine, t: TattooSave, step: number) {
  const f = frame(t);
  const unit = unitDesign(t.design);
  const to3 = (p: P2) => f.c.clone().addScaledVector(f.t1, p.x * t.size).addScaledVector(f.t2, p.y * t.size);
  const out: THREE.Vector3[] = [];
  for (let i = 1; i < unit.length; i++) {
    const a = to3(unit[i - 1]);
    const b = to3(unit[i]);
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const s = e.surfaceAt(a.clone().lerp(b, k / n));
      if (s) out.push(s.p);
    }
  }
  const local = (p: THREE.Vector3): P2 => {
    const d = p.clone().sub(f.c);
    return { x: d.dot(f.t1) / t.size, y: d.dot(f.t2) / t.size };
  };
  return { path: out, unit, local, f };
}

/** Re-draws a finished, healed tattoo (e.g. after reload). */
export function restoreTattoo(e: Engine, t: TattooSave) {
  const { path, unit, f } = designPath(e, t, 0.0006);
  for (const p of path) e.stamp('ink', p, 3.6 * e.u, { alpha: 0.95, tex: 'hard' });
  const step = 0.0015;
  for (let y = -t.size; y <= t.size; y += step)
    for (let x = -t.size; x <= t.size; x += step)
      if (pointInPoly(x / t.size, y / t.size, unit)) e.stamp('shade', f.c.clone().addScaledVector(f.t1, x).addScaledVector(f.t2, y), 9 * e.u, { alpha: 0.35 });
}
