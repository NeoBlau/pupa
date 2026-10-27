import type { Sprite } from 'pixi.js';
import { ease, type Engine, type Procedure, type Step } from '../engine.ts';
import { bandageStep, clamp01, dist, fizz, healStep, rand, rubStep, spray } from './common.ts';

/**
 * Infected cut: rinse dirt, drain pus by pressing AROUND the wound, blot,
 * peroxide, ointment, dressing, then a healing time-lapse.
 * (In-game disclaimer: real abscesses must be drained by a doctor.)
 */
export function woundProcedure(e: Engine): Procedure {
  const w = e.randomMaskPoint([], 0, { y0: e.maskBox.y0 + (e.maskBox.y1 - e.maskBox.y0) * 0.35, y1: e.maskBox.y1 - 80 * e.u });
  const R = 70 * e.u;
  const region = () => e.cellsInCircle(w.x, w.y, R * 2.2);
  const angle = rand(-0.5, 0.5);
  let penalty = 0;
  e.debug.wound = w;

  // Setup: inflamed halo, the cut, a pus pocket and dirt specks.
  for (let i = 0; i < 6; i++) e.stamp('redness', w.x + rand(-30, 30) * e.u, w.y + rand(-30, 30) * e.u, rand(90, 140) * e.u, { alpha: 0.5 });
  e.stamp('redness', w.x, w.y, 70 * e.u, { alpha: 0.9 });
  const cut = e.attach(e.sprite('cut', w.x, w.y, 150 * e.u, { rot: angle }), w.x, w.y);
  const pocket = e.attach(e.sprite('pus', w.x, w.y, 52 * e.u, { alpha: 0.95 }), w.x, w.y);
  pocket.scale.y *= 0.8;
  const specks: Sprite[] = [];
  for (let i = 0; i < 9; i++) {
    const x = w.x + rand(-80, 80) * e.u;
    const y = w.y + rand(-60, 60) * e.u;
    specks.push(e.attach(e.sprite('speck', x, y, rand(6, 13) * e.u, { rot: rand(0, 6) }), x, y));
  }
  const specksTotal = specks.length;

  // 1. Rinse -------------------------------------------------------------------
  const rinse: Step = {
    title: 'Rinse',
    hint: 'Flush dirt out with saline',
    cursor: 'saline',
    down() {
      e.hooks.loop('water', true);
    },
    up() {
      e.hooks.loop('water', false);
    },
    update() {
      if (!e.ptr.down) return;
      spray(e, e.ptr.x, e.ptr.y, 14);
      e.stamp('wet', e.ptr.x, e.ptr.y, 50 * e.u, { alpha: 0.2 });
      for (let i = specks.length - 1; i >= 0; i--) {
        const s = specks[i];
        if (dist(s, e.ptr) > 45 * e.u) continue;
        specks.splice(i, 1);
        const from = { x: s.x, y: s.y };
        e.tween(
          0.6,
          (k) => {
            e.moveAttached(s, from.x, from.y + ease.out(k) * 90 * e.u);
            s.alpha = 1 - k;
          },
          () => e.detach(s),
        );
        e.work(2);
      }
    },
    progress: () => 1 - specks.length / specksTotal,
  };

  // 2. Drain -------------------------------------------------------------------
  let pus = 1;
  let ouchCd = 0;
  let bead: Sprite | null = null;
  let oozeT = 0;
  const drain: Step = {
    title: 'Drain',
    hint: 'Press gently AROUND the wound, not on it',
    cursor: 'gauze',
    update(dt) {
      ouchCd -= dt;
      pocket.scale.set(((52 * e.u) / pocket.texture.width) * (0.35 + 0.65 * pus));
      pocket.scale.y *= 0.8;
      if (!e.ptr.down || pus <= 0) return;
      const d = dist(e.ptr, w);
      if (d < R * 0.45) {
        if (ouchCd <= 0) {
          ouchCd = 0.9;
          penalty++;
          e.kick(w.x, w.y, 200 * e.u, 1500 * e.u);
          e.shake(10);
          e.floatText(w.x, w.y - 90 * e.u, 'Ouch! Not on it', 0xff7b7b, 40);
          e.hooks.sfx('ouch');
          e.hooks.haptic('error');
        }
        return;
      }
      if (d > R * 2.4) return;
      // Pressing: dent under the finger, tissue pushed toward the wound.
      e.pinch(e.ptr.x, e.ptr.y, 70 * e.u, 0.12);
      e.force(e.ptr.x, e.ptr.y, 80 * e.u, ((w.x - e.ptr.x) / d) * 14 * e.u, ((w.y - e.ptr.y) / d) * 14 * e.u);
      pus = Math.max(0, pus - dt * 0.22);
      e.work(dt * 10);
      oozeT += dt;
      if (oozeT > 0.12) {
        oozeT = 0;
        // Late in drainage it turns blood-tinged — that's when to stop.
        const tint = pus < 0.25 ? 0xd98a74 : 0xe8cf6a;
        const a = angle + Math.PI / 2 + rand(-0.6, 0.6);
        const r = rand(0, 1) * (1 - pus) * 40 * e.u;
        e.stamp('fluid', w.x + Math.cos(a) * r, w.y + Math.sin(a) * r, rand(10, 18) * e.u, { alpha: 0.55, tint });
        if (!bead) bead = e.attach(e.sprite('pus', w.x, w.y, 10 * e.u), w.x, w.y);
        bead.tint = pus < 0.25 ? 0xf0b0a0 : 0xffffff;
        bead.scale.set(((10 + (1 - pus) * 26) * e.u) / bead.texture.width);
        if (Math.random() < 0.25) {
          e.hooks.sfx('squish');
          e.hooks.haptic('tick');
        }
      }
    },
    progress: () => 1 - pus,
  };

  // 3. Blot ---------------------------------------------------------------------
  const blot = rubStep(e, {
    title: 'Blot',
    hint: 'Blot away all the discharge',
    cursor: 'gauze',
    layer: 'fluid',
    mode: 'erase',
    radius: 45,
    alpha: 0.3,
    target: 0.03,
    region,
    onMove(p) {
      if (bead && dist(p, w) < 50 * e.u) {
        e.detach(bead);
        bead = null;
      }
    },
  });

  // 4. Peroxide ----------------------------------------------------------------
  let fizzT = 0;
  const peroxide: Step = {
    title: 'Peroxide',
    hint: 'Hold peroxide over the wound until it stops fizzing',
    cursor: 'peroxide',
    down() {
      e.hooks.loop('fizz', true);
    },
    up() {
      e.hooks.loop('fizz', false);
    },
    update(dt) {
      if (!e.ptr.down || dist(e.ptr, w) > R * 1.3) return;
      fizzT += dt;
      e.work(dt * 6);
      fizz(e, w.x, w.y, 40 * e.u, Math.random() < 0.4 ? 0xffd9e0 : 0xffffff);
      if (Math.random() < 0.5) e.stamp('foam', w.x + rand(-30, 30) * e.u, w.y + rand(-25, 25) * e.u, rand(14, 26) * e.u, { tex: 'foam', alpha: 0.7 });
      e.hooks.haptic('tick');
    },
    progress: () => clamp01(fizzT / 3),
  };

  // 5. Blot foam ---------------------------------------------------------------
  const blotFoam = rubStep(e, {
    title: 'Dab',
    hint: 'Dab the foam dry',
    cursor: 'gauze',
    layer: 'foam',
    mode: 'erase',
    radius: 45,
    alpha: 0.4,
    target: 0.03,
    region,
  });

  // 6. Ointment ----------------------------------------------------------------
  const ointment = rubStep(e, {
    title: 'Ointment',
    hint: 'Antibiotic ointment over the wound',
    cursor: 'tube',
    layer: 'gloss',
    mode: 'paint',
    radius: 40,
    alpha: 0.5,
    target: 0.8,
    region: () => e.cellsInCircle(w.x, w.y, R * 1.2),
  });

  // 7. Dress + 8. Heal ----------------------------------------------------------
  const bandage = { s: null as Sprite | null };
  const dress = bandageStep(e, () => w, () => R * 0.9, bandage);
  const cutScale = cut.scale.x;
  const heal = healStep(e, 4, (k, dt) => {
    e.fadeLayer('redness', dt * 0.9);
    e.fadeLayer('gloss', dt * 0.5);
    cut.scale.set(cutScale * (1 - 0.7 * k), cutScale * (1 - 0.85 * k));
    cut.alpha = 1 - k;
    pocket.alpha = Math.max(0, 0.95 - k * 3);
    if (bandage.s && k > 0.55) bandage.s.alpha = clamp01((1 - k) / 0.45);
  });

  return {
    id: 'wound',
    steps: [rinse, drain, blot, peroxide, blotFoam, ointment, dress, heal],
    accuracy: () => clamp01(1 - penalty * 0.15),
    dispose() {
      for (const s of specks) e.detach(s);
      if (bead) e.detach(bead);
      if (bandage.s) e.detach(bandage.s);
      e.detach(cut);
      e.detach(pocket);
      for (const id of ['fluid', 'foam', 'gloss', 'wet'] as const) e.clearLayer(id);
      e.fadeLayer('redness', 1);
    },
  };
}
