// Orders ("patients"): set up a starting condition and a checklist read from the World.
// Nothing is forced — the player uses any tool in any order; the checklist only scores.

import * as THREE from 'three';
import type { ToolId } from '@shared/game.ts';
import type { Engine } from '../engine.ts';
import { marker, type Surf, type TattooSave } from '../procedures/common.ts';
import { restoreTattoo } from '../procedures/tattoo.ts';
import type { World } from './world.ts';

export interface Goal {
  label: string;
  done: boolean;
  /** 0..1 for partial goals */
  value?: number;
}

export interface Order {
  id: ToolId;
  title: string;
  icon: string;
  brief: string;
  kind: 'spa' | 'clinic';
  setup(w: World, ctx: OrderCtx): void;
  goals(w: World): Goal[];
  /** 0..1 quality once all goals are met */
  score(w: World): number;
  dispose?(w: World): void;
}

export interface OrderCtx {
  getTattoo(): TattooSave | null;
  saveTattoo(t: TattooSave | null): void;
}

const pct = (v: number) => `${Math.round(Math.min(1, v) * 100)}%`;

function bloodNear(e: Engine, p: THREE.Vector3, r: number) {
  return e.coverage('blood', e.cellsInSphere(p, r), 0.25);
}

// ---------------------------------------------------------------------------

const oil: Order = {
  id: 'oil',
  title: 'Oil massage',
  icon: '🧴',
  brief: 'Cover the sole in warm oil and massage until she relaxes',
  kind: 'spa',
  setup() {},
  goals(w) {
    const cov = w.e.coverage('oil');
    return [
      { label: `Oil the sole (${pct(cov / 0.7)})`, done: cov >= 0.7, value: cov / 0.7 },
      { label: `Massage (${pct(w.stats.massage / 10)})`, done: w.stats.massage >= 10, value: w.stats.massage / 10 },
      { label: 'She is relaxed (feet flushed pink)', done: w.flush >= 0.45, value: w.flush / 0.45 },
    ];
  },
  score: (w) => Math.min(1, 0.5 + w.flush * 0.5 - w.stats.pain * 0.05),
};

let washPeakFoam = 0;
const wash: Order = {
  id: 'wash',
  title: 'Foot wash',
  icon: '🫧',
  brief: 'Wet, lather with shampoo, rinse every bit of foam, dry with the towel',
  kind: 'spa',
  setup() {
    washPeakFoam = 0;
  },
  goals(w) {
    const e = w.e;
    const foam = e.coverage('foam');
    const wet = e.coverage('wet');
    washPeakFoam = Math.max(washPeakFoam, foam);
    const lathered = washPeakFoam >= 0.6;
    return [
      { label: `Rich lather (${pct(washPeakFoam / 0.6)})`, done: lathered, value: washPeakFoam / 0.6 },
      { label: 'Rinsed — no foam left', done: lathered && foam < 0.05 },
      { label: 'Dried with the towel', done: lathered && foam < 0.05 && wet < 0.1 },
    ];
  },
  score: (w) => Math.min(1, 0.6 + w.flush * 0.4),
};

const tickle: Order = {
  id: 'tickle',
  title: 'Tickle',
  icon: '🪶',
  brief: 'Make her laugh with light, quick feather strokes',
  kind: 'spa',
  setup() {},
  goals: (w) => [{ label: `Laughter (${pct(w.stats.tickle / 100)})`, done: w.stats.tickle >= 100, value: w.stats.tickle / 100 }],
  score: () => 0.8,
};

// Clinic ------------------------------------------------------------------------

const wound: Order = {
  id: 'wound',
  title: 'Infected cut',
  icon: '🩹',
  brief: 'A dirty, infected cut with pus. Treat it properly — the way a nurse would',
  kind: 'clinic',
  setup(w) {
    const s = w.e.randomSolePoint([], 0, 0.04, 0.15);
    const wd = w.addWound('abscess', s, { bleed: 0.12 });
    w.addDirt(wd, 9);
    w.e.debug.wound = s;
  },
  goals(w) {
    const wd = w.wounds.find((x) => x.kind === 'abscess');
    if (!wd) return [];
    const blood = bloodNear(w.e, wd.s.p, 0.02);
    const pusLeft = w.e.coverage('pus', w.e.cellsInSphere(wd.s.p, 0.02), 0.25);
    return [
      { label: 'Flush out the dirt', done: wd.dirt.length === 0 },
      { label: `Drain the pus — press around it (${pct(1 - wd.pus)})`, done: wd.pus < 0.03, value: 1 - wd.pus },
      { label: 'Wipe away pus and blood', done: pusLeft < 0.03 && blood < 0.04 && wd.pool < 0.05 },
      { label: 'Disinfect', done: wd.disinfected },
      { label: 'Antibiotic ointment', done: wd.ointment },
      { label: 'Cover with a bandage', done: wd.covered },
    ];
  },
  score: (w) => Math.max(0, 1 - w.stats.pain * 0.06),
};

const needles: Order & { pts?: { s: Surf; m: ReturnType<typeof marker> }[]; since?: number } = {
  id: 'needles',
  title: 'Acupuncture',
  icon: '📍',
  brief: 'Disinfect, place a needle in each glowing point at a proper depth, keep them in, remove and clean up',
  kind: 'clinic',
  setup(w) {
    const e = w.e;
    const pts: Surf[] = [];
    while (pts.length < 6) pts.push(e.randomSolePoint(pts.map((s) => s.p), 120 * e.u, 0.03, 0.2));
    needles.pts = pts.map((s) => ({ s, m: marker(e, s, 0x7cf7ff) }));
    needles.since = undefined;
    e.debug.points = pts.map((s) => ({ p: s.p, inserted: false, removed: false }));
  },
  goals(w) {
    const pts = needles.pts ?? [];
    const placed = pts.filter((pt) => w.needles.some((n) => n.through && n.s.p.distanceTo(pt.s.p) < 0.006 && n.depth > 0.003 && n.depth < 0.0095));
    for (const pt of pts) pt.m.draw(1, placed.some((x) => x === pt) ? 0.25 : 0.9);
    if (placed.length === pts.length && needles.since === undefined) needles.since = w.time;
    const kept = needles.since !== undefined && w.time - needles.since >= 10;
    const disinf = pts.every((pt) => w.e.amountAt('wet', pt.s.uv) > 0.2) || w.stats.alcohol > 3;
    const removed = kept && w.needles.length === 0;
    const blood = pts.reduce((m, pt) => Math.max(m, bloodNear(w.e, pt.s.p, 0.015)), 0);
    return [
      { label: 'Disinfect the points', done: disinf },
      { label: `Needles at the right depth (${placed.length}/${pts.length})`, done: placed.length === pts.length, value: placed.length / pts.length },
      { label: `Keep them in 10 s${needles.since !== undefined && !kept ? ` (${Math.ceil(10 - (w.time - needles.since))})` : ''}`, done: kept },
      { label: 'Remove all needles', done: removed },
      { label: 'No blood left', done: removed && blood < 0.03 && w.wounds.every((x) => x.pool < 0.05) },
    ];
  },
  score: (w) => Math.max(0, 1 - w.stats.pain * 0.08),
  dispose(w) {
    for (const pt of needles.pts ?? []) w.e.detach(pt.m.g);
    needles.pts = [];
  },
};

const tattoo: Order & { ctx?: OrderCtx } = {
  id: 'tattoo',
  title: 'Tattoo',
  icon: '🖋️',
  brief: 'Clean, transfer a stencil, line it, shade it, wipe it clean, ointment and film',
  kind: 'clinic',
  setup(_w, ctx) {
    tattoo.ctx = ctx;
  },
  goals(w) {
    const e = w.e;
    const T = w.tattoo;
    const area = T ? e.cellsInSphere(T.c.p, T.size * 1.4) : [];
    const traced = T ? T.traced.filter(Boolean).length / T.traced.length : 0;
    const shaded = T ? e.coverage('shade', area.filter((c) => T.inside(e.paint.cellWorld(c))), 0.5) : 0;
    const smudge = T ? e.coverage('smudge', area, 0.15) : 1;
    const pin = T ? w.wounds.filter((x) => x.kind === 'pinpoint' && x.heal < 1 && x.s.p.distanceTo(T.c.p) < T.size * 1.6 && x.pool > 0.05).length : 0;
    const filmed = !!T && w.dressings.some((d) => d.kind === 'film' && d.s.p.distanceTo(T.c.p) < T.size);
    const goals = [
      { label: 'Clean the skin (alcohol)', done: w.stats.alcohol > 1.5 },
      { label: 'Transfer a stencil', done: !!T && T.revealed.filter(Boolean).length / T.revealed.length > 0.9 },
      { label: `Line the stencil (${pct(traced / 0.92)})`, done: traced >= 0.92, value: traced / 0.92 },
      { label: `Shade the inside (${pct(shaded / 0.8)})`, done: shaded >= 0.8, value: shaded / 0.8 },
      { label: 'Wipe off excess ink and blood', done: !!T && smudge < 0.04 && pin === 0 },
      { label: 'Ointment', done: !!T && e.coverage('gloss', area, 0.4) > 0.6 },
      { label: 'Wrap in film', done: filmed },
    ];
    if (goals.every((g) => g.done)) tattoo.ctx?.saveTattoo((w as World & { tattooSave?: TattooSave }).tattooSave ?? null);
    return goals;
  },
  score(w) {
    const line = w.stats.inkLen ? 1 - w.stats.inkOff / w.stats.inkLen : 0;
    const sh = w.stats.shadeIn + w.stats.shadeOut ? w.stats.shadeIn / (w.stats.shadeIn + w.stats.shadeOut) : 0;
    return Math.max(0, line * 0.6 + sh * 0.4 - w.stats.pain * 0.04);
  },
};

const removal: Order & { inkStart?: number; cells?: number[]; ctx?: OrderCtx; c?: Surf } = {
  id: 'removal',
  title: 'Laser removal',
  icon: '🔦',
  brief: 'Remove her tattoo with the laser, calm the skin, dress it',
  kind: 'clinic',
  setup(w, ctx) {
    const e = w.e;
    removal.ctx = ctx;
    const t = ctx.getTattoo();
    if (t) restoreTattoo(e, t);
    const c = t ? e.surfaceAt(new THREE.Vector3(...t.c)) : null;
    removal.c = c ?? e.randomSolePoint();
    removal.cells = e.cellsInSphere(removal.c.p, 0.025).filter((i) => e.paint.grids.ink[i] + e.paint.grids.shade[i] > 0.15);
    removal.inkStart = Math.max(1, removal.cells.length);
  },
  goals(w) {
    const e = w.e;
    const g = e.paint.grids;
    const left = (removal.cells ?? []).filter((i) => g.ink[i] + g.shade[i] > 0.15).length;
    const gone = 1 - left / (removal.inkStart ?? 1);
    const area = e.cellsInSphere(removal.c!.p, 0.025);
    const covered = w.dressings.some((d) => d.s.p.distanceTo(removal.c!.p) < 0.025);
    const goals = [
      { label: `Laser the ink (${pct(gone / 0.9)})`, done: gone >= 0.9, value: gone / 0.9 },
      { label: 'Calm the redness with ice', done: gone >= 0.9 && e.coverage('redness', area, 0.3) < 0.15 },
      { label: 'Blot pinpoint bleeding', done: w.wounds.filter((x) => x.kind === 'pinpoint' && x.pool > 0.05 && x.heal < 1).length === 0 },
      { label: 'Ointment', done: e.coverage('gloss', area, 0.4) > 0.5 },
      { label: 'Dress it', done: covered },
    ];
    if (goals.every((x) => x.done)) removal.ctx?.saveTattoo(null);
    return goals;
  },
  score: (w) => Math.max(0, 1 - w.stats.pain * 0.05),
};

export const ORDERS: Order[] = [oil, wash, tickle, wound, needles, tattoo, removal];
export const orderOf = (id: ToolId) => ORDERS.find((o) => o.id === id)!;
