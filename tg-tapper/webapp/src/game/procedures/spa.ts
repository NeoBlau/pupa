import * as THREE from 'three';
import type { Engine, Procedure, Step } from '../engine.ts';
import { clamp01, clampLen, downhill, rand, rubStep, spray } from './common.ts';

export function oilProcedure(e: Engine): Procedure {
  let drops = 0;
  let pourT = 0;

  const pour: Step = {
    title: 'Pour',
    hint: 'Hold to drip warm oil onto her sole',
    cursor: 'bottle',
    enter() {
      drops = 0;
    },
    update(dt) {
      e.toolPose.lift = 0.02;
      if (!e.ptr.down || !e.ptr.hit) return;
      pourT += dt;
      if (pourT < 0.16) return;
      pourT = 0;
      const land = e.surfaceAt(e.ptr.p.clone().add(new THREE.Vector3(rand(-1.5, 1.5) * 0.001, rand(-1.5, 1.5) * 0.001, 0)));
      if (!land) return;
      // A glossy drop falls from the nozzle and splats into the oil layer.
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
          const run = land.p.clone().addScaledVector(downhill(land.n), rand(0.002, 0.006));
          e.stamp('oil', run, 26 * e.u, { alpha: 0.6 });
          e.impulse(land.p, 40 * e.u, 0.05);
          e.ripple(land.p, 0xffe2a0, 0.006);
          e.hooks.sfx('drop');
          e.hooks.haptic('tick');
          drops++;
          e.work(2);
        },
      );
    },
    progress: () => clamp01(drops / 10),
  };

  const spread = rubStep(e, {
    title: 'Spread',
    hint: 'Rub the oil over the whole sole',
    cursor: null,
    layer: 'oil',
    mode: 'paint',
    radius: 75,
    alpha: 0.3,
    target: 0.75,
    drag: 0.5,
    loop: 'rub',
    onMove(p) {
      e.press(p.p, 80 * e.u, 0.0012);
      if (Math.random() < 0.25) e.particle('sparkle', p.p.clone().add(new THREE.Vector3(rand(-0.01, 0.01), rand(-0.01, 0.01), 0.002)), rand(2, 4) * 0.001, { add: true, max: 0.5, tint: 0xfff2c0 });
    },
  });

  let kneaded = 0;
  const massage: Step = {
    title: 'Massage',
    hint: 'Press and knead in slow circles',
    cursor: null,
    enter() {
      kneaded = 0;
    },
    down() {
      e.hooks.loop('rub', true);
    },
    up() {
      e.hooks.loop('rub', false);
    },
    move(p) {
      const oiled = e.amountAt('oil', p.uv) > 0.3;
      e.force(p.p, 120 * e.u, clampLen(p.delta.clone().multiplyScalar(1.1), 0.006));
      const d = p.delta.length();
      if (oiled) {
        kneaded += d;
        e.work(d / (55 * e.u));
        if (Math.random() < 0.06) e.particle('heart', p.p.clone().addScaledVector(p.n, 0.01), 0.005, { v: p.n.clone().multiplyScalar(0.03).add(new THREE.Vector3(0, 0.02, 0)), max: 0.9, spin: 0.5 });
      }
      if (Math.random() < 0.2) e.hooks.haptic('tick');
    },
    update() {
      // Thumb pressure: a deep, soft dent under the finger.
      if (e.ptr.down && e.ptr.hit) e.press(e.ptr.p, 110 * e.u, 0.0028);
    },
    progress: () => clamp01(kneaded / (2600 * e.u)),
  };

  return { id: 'oil', steps: [pour, spread, massage], accuracy: () => 0.5 };
}

export function washProcedure(e: Engine): Procedure {
  let dripT = 0;
  const runDrops = (dt: number) => {
    dripT += dt;
    if (dripT < 0.22) return;
    dripT = 0;
    const s = e.surfaceAt(e.ptr.p.clone().add(new THREE.Vector3(rand(-0.015, 0.015), rand(-0.01, 0.01), 0)));
    if (!s) return;
    // drops running down wet skin
    e.particle('water', s.p.clone().addScaledVector(s.n, 0.0012), rand(1.4, 2.4) * 0.001, { v: downhill(s.n).multiplyScalar(rand(0.006, 0.014)), max: 2.2, alpha: 0.9 });
  };

  const wet = rubStep(e, {
    title: 'Wet',
    hint: 'Warm water over her feet',
    cursor: 'shower',
    layer: 'wet',
    mode: 'paint',
    radius: 95,
    alpha: 0.35,
    target: 0.7,
    loop: 'water',
    onUpdate(dt) {
      e.toolPose.lift = 0.035;
      if (!e.ptr.down || !e.ptr.hit) return;
      spray(e, e.ptr, 0.012);
      e.stamp('wet', e.ptr.uv, 80 * e.u, { alpha: 0.15 });
      runDrops(dt);
    },
  });

  const lather = rubStep(e, {
    title: 'Lather',
    hint: 'Work the shampoo into a rich foam',
    cursor: 'shampoo',
    layer: 'foam',
    mode: 'paint',
    radius: 60,
    alpha: 0.9,
    tex: 'foam',
    target: 0.7,
    drag: 0.6,
    loop: 'lather',
    onMove(p) {
      if (Math.random() < 0.35)
        e.particle('bubble', p.p.clone().add(new THREE.Vector3(rand(-0.01, 0.01), rand(-0.01, 0.01), 0)).addScaledVector(p.n, 0.003), rand(2, 6) * 0.001, {
          v: p.n.clone().multiplyScalar(rand(0.005, 0.02)).add(new THREE.Vector3(0, 0.01, 0)),
          grow: 0.3,
          max: rand(0.6, 1.4),
        });
    },
  });

  const rinse = rubStep(e, {
    title: 'Rinse',
    hint: 'Rinse every bit of foam away',
    cursor: 'shower',
    layer: 'foam',
    mode: 'erase',
    radius: 95,
    alpha: 0.45,
    target: 0.05,
    alsoErase: [['oil', 0.12]],
    alsoPaint: [['wet', 0.2, 90]],
    loop: 'water',
    onUpdate(dt) {
      e.toolPose.lift = 0.035;
      if (e.ptr.down && e.ptr.hit) {
        spray(e, e.ptr, 0.012);
        runDrops(dt);
      }
    },
    onMove(p) {
      if (Math.random() < 0.3) e.particle('foam', p.p.clone().addScaledVector(downhill(p.n), 0.01).addScaledVector(p.n, 0.002), rand(4, 8) * 0.001, { v: downhill(p.n).multiplyScalar(0.03), max: 0.9, alpha: 0.9 });
    },
  });

  const dry = rubStep(e, {
    title: 'Dry',
    hint: 'Pat her feet dry with the towel',
    cursor: 'towel',
    layer: 'wet',
    mode: 'erase',
    radius: 110,
    alpha: 0.35,
    target: 0.05,
    drag: 0.9,
    loop: 'rub',
    onMove(p) {
      e.press(p.p, 120 * e.u, 0.0015);
    },
  });

  return { id: 'wash', steps: [wet, lather, rinse, dry], accuracy: () => 0.5 };
}

const GIGGLES = ['hehe!', 'haha 😆', 'stop it!', 'hihi', '😂', 'no-no-no!', 'ahaha!'];

export function tickleProcedure(e: Engine): Procedure {
  let total = 0;
  let energy = 0;
  let twitchT = 0;
  let giggleT = 0;
  const step: Step = {
    title: 'Tickle',
    hint: 'Quick light strokes with the feather',
    cursor: 'feather',
    enter() {
      total = 0;
      energy = 0;
    },
    update(dt) {
      const fast = e.ptr.down && e.ptr.speed > 500 * e.u;
      const gain = fast ? clamp01(e.ptr.speed / (2600 * e.u)) : 0;
      energy = clamp01(energy + gain * dt * 2.2 - dt * 0.7);
      total += gain * dt * 24;
      if (gain) e.work(gain * dt * 14);
      // feather flutters and barely touches the skin
      e.toolPose.spin = Math.sin(e.time * 18) * 0.25 * (0.3 + energy);
      e.toolPose.tilt = 0.4;

      if (energy > 0.15) {
        twitchT += dt;
        if (twitchT > 0.14) {
          twitchT = 0;
          e.kick(e.ptr.p, 200 * e.u, 0.09 * energy);
          if (energy > 0.6 && Math.random() < 0.3) e.shake(6 * energy);
        }
        // toes curl toward the sole
        e.force(e.L.toes, 0.035, new THREE.Vector3(0, -0.004 * energy, 0.009 * energy));
        giggleT += dt;
        if (giggleT > 0.9 - energy * 0.4) {
          giggleT = 0;
          e.floatText(e.ptr.p.clone().add(new THREE.Vector3(rand(-0.03, 0.03), rand(0.01, 0.03), 0.01)), GIGGLES[Math.floor(Math.random() * GIGGLES.length)], '#ffd6f0', 22);
          e.hooks.sfx('giggle');
          e.hooks.haptic('light');
        }
      }
    },
    progress: () => clamp01(total / 100),
  };
  return { id: 'tickle', steps: [step], accuracy: () => 0.5 };
}
