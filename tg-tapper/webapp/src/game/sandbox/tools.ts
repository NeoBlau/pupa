// Sandbox tools. Every tool works anywhere, any time; `force` (0..1) comes from the gamepad
// trigger, a pressure-sensitive screen, or how long the pointer is held.

import * as THREE from 'three';
import type { Engine, Ptr, SubTool } from '../engine.ts';
import type { ToolName } from '../tools3d.ts';
import { clamp01, clampLen, downhill, rand, spray, type DesignId, type TattooSave } from '../procedures/common.ts';
import { designPath, pointInPoly } from '../procedures/tattoo.ts';
import type { World } from './world.ts';

export interface Ctx {
  w: World;
  e: Engine;
  p: Ptr;
  force: number;
  dt: number;
}

export interface SandboxTool {
  id: string;
  name: string;
  icon: string;
  group: 'spa' | 'clinic' | 'both';
  cursor: ToolName | null;
  hint: string;
  sub?: SubTool[];
  subId?: string;
  /** Raise the 3D tool above the skin (bottles, shower). */
  lift?: number;
  down?(c: Ctx): void;
  move?(c: Ctx): void;
  hold?(c: Ctx): void;
  up?(c: Ctx): void;
  /** Called every frame, pressed or not. */
  idle?(c: Ctx): void;
}

const rumble = (e: Engine, weak: number, strong: number) => e.hooks.rumble?.(weak, strong);

// ---------------------------------------------------------------------------

const hand: SandboxTool = {
  id: 'hand',
  name: 'Hands',
  icon: '🖐️',
  group: 'both',
  cursor: null,
  hint: 'Press, knead, drain around a wound, pull out needles, peel dressings',
  down({ w, p }) {
    st.grab = w.findNeedle(p.p, 120 * w.e.u);
    st.grabFrom.copy(p.p);
    st.peeled = !st.grab && w.removeDressing(p.p);
  },
  hold({ w, e, p, force, dt }) {
    if (st.grab) return;
    // Deep, soft dent under the thumb; harder = deeper.
    e.press(p.p, 110 * e.u, 0.0005 + 0.003 * force);
    w.pressAt(p, force, dt);
    rumble(e, force * 0.25, 0);
    const oiled = e.amountAt('oil', p.uv) > 0.3;
    if (force > 0.9 && !oiled && Math.random() < dt * 0.8) w.pain(p, 0.5);
    if (force > 0.3) e.stamp('redness', p.uv, 70 * e.u, { alpha: 0.006 * force });
  },
  move({ w, e, p, force }) {
    if (st.grab) {
      const n = st.grab;
      const pull = p.p.distanceTo(st.grabFrom);
      e.force(n.s.p, 45 * e.u, n.s.n.clone().multiplyScalar(Math.min(pull, 70 * e.u) * 0.45));
      w.e.moveAttached(n.obj, n.s.p.clone().addScaledVector(n.s.n, Math.min(pull, 60 * e.u) * 0.6 - n.depth));
      if (pull > 110 * e.u) {
        w.pullNeedle(n);
        st.grab = null;
      }
      return;
    }
    e.force(p.p, 120 * e.u, clampLen(p.delta.clone().multiplyScalar(1.1), 0.006));
    const d = p.delta.length();
    if (e.amountAt('oil', p.uv) > 0.3) {
      w.stats.massage += d / 0.05;
      w.flush = clamp01(w.flush + d * 0.6);
      e.work(d / (55 * e.u));
      if (Math.random() < 0.05) e.react('pleasure', 0.6 + force * 0.3);
    } else if (d > 0 && force > 0.5) e.stamp('redness', p.uv, 60 * e.u, { alpha: 0.01 * force }); // friction on dry skin
  },
  up({ w, e, p }) {
    if (st.grab) e.moveAttached(st.grab.obj, st.grab.s.p.clone().addScaledVector(st.grab.s.n, -st.grab.depth));
    st.grab = null;
    if (st.peeled) e.floatText(p.p, 'Peeled off', '#ffd36b');
    void w;
  },
};
const st = { grab: null as import('./world.ts').Needle | null, grabFrom: new THREE.Vector3(), peeled: false, last: new THREE.Vector3(), drip: 0, pulse: 0, design: 'heart' as DesignId, needle: null as import('./world.ts').Needle | null, push: 0, twirl: null as import('./world.ts').Needle | null, tapFrom: new THREE.Vector3(), tapT: 0 };

// ---------------------------------------------------------------------------
// Spa

const oil: SandboxTool = {
  id: 'oil',
  name: 'Oil',
  icon: '🧴',
  group: 'spa',
  cursor: 'bottle',
  lift: 0.02,
  hint: 'Squeeze harder for more drops',
  hold({ w, e, p, force, dt }) {
    st.drip += dt;
    if (st.drip < 0.3 - 0.22 * force) return;
    st.drip = 0;
    const land = e.surfaceAt(p.p.clone().add(new THREE.Vector3(rand(-1.5, 1.5) * 0.001, rand(-1.5, 1.5) * 0.001, 0)));
    if (!land) return;
    const drop = new THREE.Mesh(new THREE.SphereGeometry(0.0016, 16, 12), e.M.oil);
    drop.scale.y = 1.4;
    const from = land.p.clone().addScaledVector(land.n, 0.02);
    drop.position.copy(from);
    e.root.add(drop);
    e.tween(
      0.2,
      (k) => drop.position.lerpVectors(from, land.p, k * k),
      () => {
        drop.removeFromParent();
        drop.geometry.dispose();
        e.stamp('oil', land.uv, 46 * e.u, { alpha: 0.8 });
        e.stamp('oil', land.p.clone().addScaledVector(downhill(land.n), rand(0.002, 0.006)), 26 * e.u, { alpha: 0.6 });
        e.impulse(land.p, 40 * e.u, 0.05);
        e.ripple(land.p, 0xffe2a0, 0.006);
        e.hooks.sfx('drop');
        e.hooks.haptic('tick');
        w.flush = clamp01(w.flush + 0.005);
        e.work(2);
      },
    );
  },
};

const shower: SandboxTool = {
  id: 'shower',
  name: 'Shower',
  icon: '🚿',
  group: 'both',
  cursor: 'shower',
  lift: 0.035,
  hint: 'Warm water: wets, rinses foam, oil and fresh blood',
  down({ e }) {
    e.hooks.loop('water', true);
  },
  up({ e }) {
    e.hooks.loop('water', false);
  },
  hold({ w, e, p, force, dt }) {
    spray(e, p, 0.012);
    const r = (70 + 40 * force) * e.u;
    e.stamp('wet', p.uv, r, { alpha: 0.2 + 0.2 * force });
    e.stamp('foam', p.uv, r, { erase: true, alpha: 0.3 + 0.3 * force });
    e.stamp('oil', p.uv, r, { erase: true, alpha: 0.08 });
    e.stamp('blood', p.uv, r * 0.8, { erase: true, alpha: 0.04 * force });
    e.stamp('pus', p.uv, r * 0.8, { erase: true, alpha: 0.05 * force });
    for (const wd of w.wounds)
      for (let i = wd.dirt.length - 1; i >= 0; i--)
        if (wd.dirt[i].position.distanceTo(p.p) < r) {
          e.detach(wd.dirt[i]);
          wd.dirt.splice(i, 1);
        }
    w.flush = clamp01(w.flush + dt * 0.02);
    rumble(e, 0.1 * force, 0);
    if (Math.random() < dt * 4) {
      const s = e.surfaceAt(p.p.clone().add(new THREE.Vector3(rand(-0.015, 0.015), rand(-0.01, 0.01), 0)));
      if (s) e.particle('water', s.p.clone().addScaledVector(s.n, 0.0012), rand(1.4, 2.4) * 0.001, { v: downhill(s.n).multiplyScalar(rand(0.006, 0.014)), max: 2.2, alpha: 0.9 });
    }
    e.work(dt * 4);
  },
};

const shampoo: SandboxTool = {
  id: 'shampoo',
  name: 'Shampoo',
  icon: '🫧',
  group: 'spa',
  cursor: 'shampoo',
  hint: 'Work into a rich foam (works best on wet skin)',
  down({ e }) {
    e.hooks.loop('lather', true);
  },
  up({ e }) {
    e.hooks.loop('lather', false);
  },
  move({ w, e, p, force }) {
    const wet = e.amountAt('wet', p.uv);
    e.paintLine('foam', st.last.distanceTo(p.p) < 0.03 ? st.last : p.p, p.p, 60 * e.u, { tex: 'foam', alpha: 0.35 + 0.55 * wet });
    st.last.copy(p.p);
    e.force(p.p, 90 * e.u, clampLen(p.delta.clone().multiplyScalar(0.6), 0.006));
    if (Math.random() < 0.35)
      e.particle('bubble', p.p.clone().add(new THREE.Vector3(rand(-0.01, 0.01), rand(-0.01, 0.01), 0)).addScaledVector(p.n, 0.003), rand(2, 6) * 0.001, {
        v: p.n.clone().multiplyScalar(rand(0.005, 0.02)).add(new THREE.Vector3(0, 0.01, 0)),
        grow: 0.3,
        max: rand(0.6, 1.4),
      });
    e.work(p.delta.length() / (60 * e.u));
    void w;
    void force;
  },
};

const towel: SandboxTool = {
  id: 'towel',
  name: 'Towel',
  icon: '🧺',
  group: 'both',
  cursor: 'towel',
  hint: 'Dry the skin; soaks up loose blood',
  move({ w, e, p, force }) {
    const r = 110 * e.u;
    e.stamp('wet', p.uv, r, { erase: true, alpha: 0.25 + 0.2 * force });
    e.stamp('foam', p.uv, r, { erase: true, alpha: 0.15 });
    e.press(p.p, r * 0.7, 0.0008 + 0.0015 * force);
    e.force(p.p, 90 * e.u, clampLen(p.delta.clone().multiplyScalar(0.9), 0.006));
    w.wipe(p, p.delta, force * 0.6, 60 * e.u);
    e.work(p.delta.length() / (80 * e.u));
  },
};

const GIGGLES = ['hehe!', 'haha 😆', 'stop it!', 'hihi', '😂', 'no-no-no!', 'ahaha!'];
const feather: SandboxTool = {
  id: 'feather',
  name: 'Feather',
  icon: '🪶',
  group: 'spa',
  cursor: 'feather',
  hint: 'Quick, light strokes tickle — pressing hard does not',
  idle({ w, e, p, force, dt }) {
    const fast = p.down && p.speed > 500 * e.u;
    const light = 1 - force * 0.7;
    const gain = fast ? clamp01(p.speed / (2600 * e.u)) * light : 0;
    st.pulse = clamp01(st.pulse + gain * dt * 2.2 - dt * 0.7);
    w.stats.tickle += gain * dt * 24;
    if (gain) e.work(gain * dt * 14);
    e.toolPose.spin = Math.sin(e.time * 18) * 0.25 * (0.3 + st.pulse);
    e.toolPose.tilt = 0.4;
    if (st.pulse > 0.15 && Math.random() < dt * 7) {
      e.kick(p.p, 200 * e.u, 0.09 * st.pulse);
      e.react('tickle', 0.4 + st.pulse * 0.6);
      w.flush = clamp01(w.flush + 0.01);
      rumble(e, 0.3 * st.pulse, 0);
    }
    if (st.pulse > 0.3 && Math.random() < dt * (1.2 + st.pulse)) {
      e.floatText(p.p.clone().add(new THREE.Vector3(rand(-0.03, 0.03), rand(0.01, 0.03), 0.01)), GIGGLES[Math.floor(Math.random() * GIGGLES.length)], '#ffd6f0', 22);
      e.hooks.sfx('giggle');
    }
  },
};

// ---------------------------------------------------------------------------
// Clinic

const swab: SandboxTool = {
  id: 'swab',
  name: 'Alcohol',
  icon: '🧪',
  group: 'clinic',
  cursor: 'swab',
  hint: 'Disinfect skin and wounds (stings on open wounds)',
  move({ w, e, p, dt }) {
    e.stamp('wet', p.uv, 42 * e.u, { alpha: 0.5 });
    w.disinfect(p.p, Math.max(dt, 0.016));
    e.work(p.delta.length() / (80 * e.u));
  },
};

const saline: SandboxTool = {
  id: 'saline',
  name: 'Saline',
  icon: '💧',
  group: 'clinic',
  cursor: 'saline',
  lift: 0.02,
  hint: 'Flush dirt out of a wound; squeeze harder for a stronger jet',
  down({ e }) {
    e.hooks.loop('water', true);
  },
  up({ e }) {
    e.hooks.loop('water', false);
  },
  hold({ w, e, p, force, dt }) {
    spray(e, p, 0.003);
    const r = (30 + 30 * force) * e.u;
    e.stamp('wet', p.uv, 50 * e.u, { alpha: 0.2 });
    e.stamp('blood', p.uv, r, { erase: true, alpha: 0.06 * force });
    e.stamp('pus', p.uv, r, { erase: true, alpha: 0.08 * force });
    for (const wd of w.wounds)
      for (let i = wd.dirt.length - 1; i >= 0; i--) {
        const s = wd.dirt[i];
        if (s.position.distanceTo(p.p) > r + 0.004) continue;
        wd.dirt.splice(i, 1);
        const from = s.position.clone();
        e.tween(0.6, (k) => { e.moveAttached(s, from.clone().addScaledVector(downhill(wd.s.n), k * 0.02)); s.scale.setScalar(1 - k); }, () => e.detach(s));
        e.work(2);
      }
    void dt;
  },
};

const padTool = (id: 'cotton' | 'gauze', name: string, icon: string, radius: number): SandboxTool => ({
  id,
  name,
  icon,
  group: 'clinic',
  cursor: id,
  hint: id === 'cotton' ? 'Blot blood; HOLD it on a wound to stop the bleeding' : 'Wipe; press around an abscess to drain it',
  hold({ w, e, p, force, dt }) {
    e.press(p.p, radius * 0.7 * e.u, 0.0006 + 0.0016 * force);
    w.padPress(p.p, force, dt);
    if (id === 'gauze') w.pressAt(p, force, dt);
    rumble(e, 0.1 * force, 0);
  },
  move({ w, e, p, force }) {
    w.wipe(p, p.delta, force, radius * e.u);
    e.force(p.p, 60 * e.u, p.delta.clone().multiplyScalar(0.4));
    e.work(p.delta.length() / (90 * e.u));
  },
  up({ w }) {
    w.padLift();
  },
});

const peroxide: SandboxTool = {
  id: 'peroxide',
  name: 'Peroxide',
  icon: '🫙',
  group: 'clinic',
  cursor: 'peroxide',
  lift: 0.015,
  hint: 'Fizzes on blood: cleans, disinfects, helps it stop',
  down({ e }) {
    e.hooks.loop('fizz', true);
  },
  up({ e }) {
    e.hooks.loop('fizz', false);
  },
  hold({ w, e, p, force, dt }) {
    w.peroxide(p, dt * (0.4 + force));
    e.stamp('wet', p.uv, 30 * e.u, { alpha: 0.1 });
    rumble(e, 0.08, 0);
    e.work(dt * 4);
  },
};

const needle: SandboxTool = {
  id: 'needle',
  name: 'Needle',
  icon: '📍',
  group: 'clinic',
  cursor: 'needle',
  hint: 'Push gently to go in · too soft won’t pierce · too hard hurts and bleeds · circle a needle to twirl it',
  down({ w, p }) {
    st.twirl = w.findNeedle(p.p, 40 * w.e.u);
    st.needle = st.twirl ? null : w.addNeedle({ p: p.p.clone(), n: p.n.clone(), uv: p.uv.clone() });
    st.push = 0;
  },
  hold({ w, e, force, dt }) {
    const n = st.needle;
    if (!n) return;
    // Skin resists first (dimple), then gives way.
    if (!n.through) {
      e.press(n.s.p, 20 * e.u, 0.0004 + 0.0026 * force);
      st.push = force > 0.35 ? st.push + dt : Math.max(0, st.push - dt);
      rumble(e, 0.15 + 0.4 * force, 0.1 * force);
      w.placeNeedle({ ...n, depth: -0.0005 + force * 0.002 });
      if (st.push > 0.2) {
        n.through = true;
        e.impulse(n.s.p, 35 * e.u, 0.06);
        e.ripple(n.s.p, 0x7cf7ff, 0.008);
        e.hooks.sfx('needle');
        e.hooks.haptic('medium');
        rumble(e, 0.2, 0.7);
        e.react('sting', 0.3);
      }
      return;
    }
    const target = 0.002 + 0.008 * force;
    if (target > n.depth) n.depth = Math.min(target, n.depth + dt * 0.02);
    w.placeNeedle(n);
    rumble(e, 0.1 + 0.3 * force, 0);
    if (force > 0.85) {
      n.bleedRisk = clamp01(n.bleedRisk + dt);
      if (Math.random() < dt * 2) w.pain(n.s, 0.7);
    }
    e.work(dt * 3);
  },
  move({ w, e, p }) {
    const n = st.twirl;
    if (!n) return;
    if (p.p.distanceTo(n.s.p) < 110 * e.u && p.speed > 150 * e.u) {
      n.qi = Math.min(1, n.qi + p.delta.length() * 20);
      n.obj.rotateY(p.delta.length() * 400);
      if (Math.random() < 0.3) e.particle('sparkle', n.s.p.clone().addScaledVector(n.s.n, rand(0.005, 0.05)), rand(2, 4) * 0.001, { add: true, v: n.s.n.clone().multiplyScalar(0.02), max: 0.6, tint: 0x9ffcff });
      e.work(0.2);
    }
    void w;
  },
  up({ w }) {
    const n = st.needle;
    // Not pushed through: the needle just comes off the skin.
    if (n && !n.through) {
      w.needles = w.needles.filter((x) => x !== n);
      w.e.detach(n.obj);
    }
    st.needle = null;
    st.twirl = null;
  },
};

const tube: SandboxTool = {
  id: 'tube',
  name: 'Ointment',
  icon: '🧴',
  group: 'clinic',
  cursor: 'tube',
  hint: 'Healing ointment: wounds heal faster',
  move({ w, e, p }) {
    e.paintLine('gloss', st.last.distanceTo(p.p) < 0.03 ? st.last : p.p, p.p, 45 * e.u, { alpha: 0.45 });
    st.last.copy(p.p);
    for (const wd of w.wounds) if (wd.s.p.distanceTo(p.p) < wd.size + 0.008) wd.ointment = true;
    e.work(p.delta.length() / (90 * e.u));
  },
};

const bandage: SandboxTool = {
  id: 'bandage',
  name: 'Dressing',
  icon: '🩹',
  group: 'clinic',
  cursor: null,
  hint: 'Tap to place. Tap with Hands to peel it off',
  sub: [
    { id: 'bandage', label: 'Bandage', icon: '🩹' },
    { id: 'film', label: 'Film', icon: '🎞️' },
  ],
  subId: 'bandage',
  down({ p }) {
    st.tapFrom.copy(p.p);
    st.tapT = 0;
  },
  hold({ dt }) {
    st.tapT += dt;
  },
  up({ w, p }) {
    if (p.p.distanceTo(st.tapFrom) > 0.01) return;
    const kind = (bandage.subId as 'bandage' | 'film') ?? 'bandage';
    w.dress(kind, { p: p.p.clone(), n: p.n.clone(), uv: p.uv.clone() }, kind === 'film' ? 0.018 : 0.011);
    w.e.work(8);
  },
};

const ice: SandboxTool = {
  id: 'ice',
  name: 'Ice',
  icon: '🧊',
  group: 'both',
  cursor: 'ice',
  hint: 'Calms redness and swelling. Cold!',
  move({ w, e, p }) {
    e.stamp('redness', p.uv, 80 * e.u, { erase: true, alpha: 0.12 });
    e.stamp('wet', p.uv, 70 * e.u, { alpha: 0.05 });
    w.flush = Math.max(0, w.flush - 0.004);
  },
  hold({ e, p, dt }) {
    e.press(p.p, 60 * e.u, 0.0012);
    e.fadeLayer('frost', dt * 0.2);
    if (Math.random() < dt * 0.8) e.react('cold', 0.5);
  },
};

// Tattoo -------------------------------------------------------------------------

const stencil: SandboxTool = {
  id: 'stencil',
  name: 'Stencil',
  icon: '📄',
  group: 'clinic',
  cursor: 'paper',
  hint: 'Pick a design, press the paper on the skin and rub to transfer',
  sub: [
    { id: 'heart', label: 'Heart', icon: '❤️' },
    { id: 'star', label: 'Star', icon: '⭐' },
    { id: 'moon', label: 'Moon', icon: '🌙' },
  ],
  subId: 'heart',
  down({ w, e, p }) {
    if (w.tattoo && w.tattoo.c.p.distanceTo(p.p) < w.tattoo.size * 1.5) return;
    const t1 = new THREE.Vector3(1, 0, 0).sub(p.n.clone().multiplyScalar(p.n.x)).normalize();
    const save: TattooSave = { design: (stencil.subId ?? 'heart') as DesignId, c: p.p.toArray() as TattooSave['c'], n: p.n.toArray() as TattooSave['n'], t1: t1.toArray() as TattooSave['t1'], size: 0.017 };
    const D = designPath(e, save, 0.0008);
    w.tattoo = {
      path: D.path,
      traced: D.path.map(() => false),
      revealed: D.path.map(() => false),
      inside: (q) => { const l = D.local(q); return pointInPoly(l.x, l.y, D.unit); },
      c: { p: p.p.clone(), n: p.n.clone(), uv: p.uv.clone() },
      size: 0.017,
      design: save.design,
    };
    w.e.debug.tattoo = save;
    (w as World & { tattooSave?: TattooSave }).tattooSave = save;
  },
  move({ w, e, p }) {
    const T = w.tattoo;
    if (!T) return;
    T.path.forEach((q, i) => {
      if (T.revealed[i] || q.distanceTo(p.p) > 70 * e.u) return;
      T.revealed[i] = true;
      if (i % 2 === 0) e.stamp('stencil', q, 2.6 * e.u, { alpha: 0.85, tex: 'hard' });
    });
    e.press(p.p, 80 * e.u, 0.001);
  },
};

const machine: SandboxTool = {
  id: 'machine',
  name: 'Tattoo',
  icon: '🖋️',
  group: 'clinic',
  cursor: 'machine',
  hint: 'Light = faint line · firm = clean line · too hard = blowout, blood and pain',
  down({ e, p }) {
    st.last.copy(p.p);
    e.hooks.loop('buzz', true);
  },
  up({ e }) {
    e.hooks.loop('buzz', false);
  },
  idle({ e, p }) {
    e.toolPose.jitter = p.down ? 0.0003 : 0.00008;
  },
  hold({ w, e, p, force, dt }) {
    rumble(e, 0.35 + 0.35 * force, 0.15 * force);
    e.press(p.p, 40 * e.u, 0.0004 + 0.0016 * force);
    e.stamp('redness', p.uv, 34 * e.u, { alpha: 0.03 * dt * 60 * (0.3 + force) });
    if (force > 0.88 && Math.random() < dt * 1.5) w.pain(p, 0.5);
  },
  move({ w, e, p, force }) {
    const d = p.p.distanceTo(st.last);
    if (d === 0 || d > 0.03) {
      st.last.copy(p.p);
      return;
    }
    const r = (2.4 + 2.6 * force) * e.u;
    e.paintLine('ink', st.last, p.p, r, { alpha: 0.35 + 0.65 * force, tex: 'hard' }, 0.5);
    e.force(p.p, 80 * e.u, p.delta.clone().multiplyScalar(0.3));
    w.stats.inkLen += d;
    const T = w.tattoo;
    if (T) {
      if (Math.min(...T.path.map((q) => q.distanceTo(p.p))) > 14 * e.u) w.stats.inkOff += d;
      T.path.forEach((q, i) => {
        if (!T.traced[i] && q.distanceTo(p.p) < 11 * e.u && force > 0.3) T.traced[i] = true;
      });
      if (T.inside(p.p)) w.stats.shadeIn += d;
      else w.stats.shadeOut += d;
    }
    // Excess ink, and pinpoint bleeding that gets worse with force.
    if (Math.random() < 0.15 + 0.3 * force) e.stamp('smudge', p.p.clone().add(new THREE.Vector3(rand(-1, 1) * 0.0025, rand(-1, 1) * 0.0025, 0)), rand(12, 22) * e.u * (force > 0.85 ? 2 : 1), { alpha: 0.12 + 0.25 * force });
    if (Math.random() < 0.05 + 0.25 * force * force) {
      const s = e.surfaceAt(p.p.clone().add(new THREE.Vector3(rand(-1, 1) * 0.0012, rand(-1, 1) * 0.0012, 0)));
      if (s) w.addWound('pinpoint', s, { bleed: 0.04 + 0.1 * force, disinfected: false });
    }
    if (Math.random() < 0.04) e.react('sting', 0.2 + force * 0.2);
    e.work(d / (40 * e.u));
    st.last.copy(p.p);
  },
};

const shade: SandboxTool = {
  ...machine,
  id: 'shade',
  name: 'Shading',
  icon: '🖌️',
  hint: 'Soft shading needle: fill the inside of the design',
  move({ w, e, p, force }) {
    const d = p.p.distanceTo(st.last);
    if (d === 0 || d > 0.03) {
      st.last.copy(p.p);
      return;
    }
    e.paintLine('shade', st.last, p.p, 9 * e.u, { alpha: 0.06 + 0.14 * force }, 0.6);
    const T = w.tattoo;
    if (T) {
      if (T.inside(p.p)) w.stats.shadeIn += d;
      else w.stats.shadeOut += d;
    }
    if (Math.random() < 0.08) e.stamp('smudge', p.p, rand(10, 18) * e.u, { alpha: 0.1 + 0.15 * force });
    if (Math.random() < 0.03 + 0.1 * force * force) {
      const s = e.surfaceAt(p.p);
      if (s) w.addWound('pinpoint', s, { bleed: 0.04 + 0.06 * force });
    }
    e.work(d / (60 * e.u));
    st.last.copy(p.p);
  },
};

const laser: SandboxTool = {
  id: 'laser',
  name: 'Laser',
  icon: '🔦',
  group: 'clinic',
  cursor: 'laser',
  lift: 0.012,
  hint: 'Hold over ink to shatter it. Real removal takes 6–10 sessions',
  hold({ w, e, p, force, dt }) {
    st.pulse += dt;
    e.fadeLayer('frost', dt * 0.12);
    if (st.pulse < 0.12 - 0.05 * force) return;
    st.pulse = 0;
    e.particle('sparkle', p.p.clone().addScaledVector(p.n, 0.001), 0.012, { add: true, max: 0.12, tint: 0xdff8ff });
    e.hooks.sfx('zap');
    rumble(e, 0.2, 0.5);
    const c = e.paint.cellOf(p.uv.x, p.uv.y);
    if (c < 0) return;
    const ink = e.paint.grids.ink[c] + e.paint.grids.shade[c];
    e.stamp('redness', p.uv, 30 * e.u, { alpha: 0.06 });
    if (ink < 0.12) return;
    e.stamp('ink', p.uv, 20 * e.u, { erase: true, alpha: 0.4 });
    e.stamp('shade', p.uv, 20 * e.u, { erase: true, alpha: 0.4 });
    e.stamp('frost', p.uv, 14 * e.u, { alpha: 0.5, tex: 'hard' });
    e.impulse(p.p, 30 * e.u, 0.03);
    w.stats.laserPulses++;
    if (Math.random() < 0.3) e.react('sting', 0.35);
    if (Math.random() < 0.07) {
      const s = e.surfaceAt(p.p.clone().add(new THREE.Vector3(rand(-1, 1) * 0.0015, rand(-1, 1) * 0.0015, 0)));
      if (s) w.addWound('pinpoint', s, { bleed: 0.05 });
    }
    e.work(1.2);
  },
  up() {
    st.pulse = 0;
  },
};

export const SANDBOX_TOOLS: SandboxTool[] = [
  hand,
  oil,
  shower,
  shampoo,
  towel,
  feather,
  ice,
  swab,
  saline,
  padTool('cotton', 'Cotton', '☁️', 34),
  padTool('gauze', 'Gauze', '🩹', 48),
  peroxide,
  needle,
  tube,
  bandage,
  stencil,
  machine,
  shade,
  laser,
];

export const toolOf = (id: string) => SANDBOX_TOOLS.find((t) => t.id === id) ?? hand;
