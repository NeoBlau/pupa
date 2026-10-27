import { Container, Graphics, type Sprite } from 'pixi.js';
import type { ModelDef } from '@shared/game.ts';
import { ease, type Engine, type LayerId, type Ptr, type Step } from '../engine.ts';
import type { TexName } from '../textures.ts';

export interface TattooSave {
  design: DesignId;
  x: number;
  y: number;
  size: number;
}

export interface ProcCtx {
  model: ModelDef;
  getTattoo(): TattooSave | null;
  saveTattoo(t: TattooSave | null): void;
}

export type DesignId = 'heart' | 'star' | 'moon';

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
export const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Generic "rub over an area" step: paints or erases a layer until coverage hits the target. */
export function rubStep(
  e: Engine,
  o: {
    title: string;
    hint: string;
    cursor: TexName | null;
    layer: LayerId;
    mode: 'paint' | 'erase';
    /** Cells that count; defaults to the whole mask. */
    region?: () => number[];
    radius: number;
    alpha: number;
    tex?: TexName;
    tint?: number;
    /** paint: coverage needed; erase: coverage left that counts as clean. */
    target: number;
    /** Extra layers erased alongside (e.g. water also rinses oil). */
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
  let px = 0;
  let py = 0;
  const cells = () => (o.region ? o.region() : e.maskCells);
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
      px = p.x;
      py = p.y;
      if (o.loop) e.hooks.loop(o.loop, true);
      this.move!(p);
    },
    move(p) {
      const r = o.radius * e.u;
      const st = { alpha: o.alpha, tex: o.tex, tint: o.tint, erase: o.mode === 'erase' };
      e.paintLine(o.layer, px, py, p.x, p.y, r, st);
      for (const [id, a] of o.alsoErase ?? []) e.paintLine(id, px, py, p.x, p.y, r, { alpha: a, erase: true });
      for (const [id, a, rr] of o.alsoPaint ?? []) e.paintLine(id, px, py, p.x, p.y, rr * e.u, { alpha: a });
      if (o.drag) e.force(p.x, p.y, 90 * e.u, clampMag(p.dx * o.drag, 30 * e.u), clampMag(p.dy * o.drag, 30 * e.u));
      px = p.x;
      py = p.y;
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

export const clampMag = (v: number, m: number) => Math.max(-m, Math.min(m, v));

/** Drag a dressing onto the spot. */
export function bandageStep(e: Engine, center: () => { x: number; y: number }, size: () => number, store: { s: Sprite | null }): Step {
  let placed = false;
  let rot = rand(-0.4, 0.4);
  return {
    title: 'Dress',
    hint: 'Drag the bandage onto the spot',
    cursor: null,
    enter() {
      placed = false;
      rot = rand(-0.4, 0.4);
    },
    down(p) {
      if (placed) return;
      if (!store.s) {
        store.s = e.attach(e.sprite('bandage', p.x, p.y, size() * 2.2, { rot }), p.x, p.y);
        store.s.alpha = 0.9;
      }
      e.moveAttached(store.s, p.x, p.y);
    },
    move(p) {
      if (placed || !store.s) return;
      e.moveAttached(store.s, p.x, p.y);
    },
    up(p) {
      if (placed || !store.s) return;
      const c = center();
      if (dist(p, c) < size() * 0.7) {
        placed = true;
        const s = store.s;
        const from = { x: p.x, y: p.y };
        e.tween(0.25, (k) => {
          const t = ease.out(k);
          e.moveAttached(s, from.x + (c.x - from.x) * t, from.y + (c.y - from.y) * t);
          s.alpha = 0.9 + 0.1 * t;
        });
        e.pinch(c.x, c.y, size(), 0.15);
        e.hooks.sfx('squish');
        e.hooks.haptic('medium');
        e.work(10);
      } else {
        e.floatText(p.x, p.y - 40 * e.u, 'Closer!', 0xffd36b, 40);
      }
    },
    progress: () => (placed ? 1 : 0),
  };
}

/** Time-lapse healing: runs on its own, calls fn(k) with k 0..1. */
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
        e.floatText(e.maskCenter.x, e.maskCenter.y, 'Healed ✨', 0x9dffc4, 64);
        onDone?.();
      }
    },
    progress: () => clamp01(t / dur),
  };
}

/** Pulsing ring marker, glued to the skin. */
export function marker(e: Engine, x: number, y: number, color: number) {
  const c = new Container();
  const g = new Graphics();
  c.addChild(g);
  e.attach(c, x, y);
  const draw = (phase: number, alpha: number) => {
    g.clear();
    const r = (12 + (1 - phase) * 60) * e.u;
    g.circle(0, 0, r).stroke({ width: 4 * e.u, color, alpha: alpha * (0.4 + phase * 0.6) });
    g.circle(0, 0, 9 * e.u).fill({ color, alpha: alpha * 0.9 });
  };
  return { c, draw };
}

/** Bursting peroxide / soap bubbles around a point. */
export function fizz(e: Engine, x: number, y: number, spread: number, tint = 0xffffff) {
  for (let i = 0; i < 3; i++) {
    e.particle('bubble', x + rand(-spread, spread), y + rand(-spread, spread), rand(8, 22) * e.u, {
      vx: rand(-20, 20) * e.u,
      vy: rand(-50, -10) * e.u,
      grow: 0.6,
      max: rand(0.4, 0.9),
      tint,
    });
  }
}

/** Water drops falling from a tool tip. */
export function spray(e: Engine, x: number, y: number, spread = 40) {
  for (let i = 0; i < 2; i++) {
    e.particle('water', x + rand(-spread, spread) * e.u, y + rand(-10, 10) * e.u, rand(8, 16) * e.u, {
      vy: rand(200, 420) * e.u,
      vx: rand(-40, 40) * e.u,
      max: 0.35,
      alpha: 0.8,
    });
  }
}
