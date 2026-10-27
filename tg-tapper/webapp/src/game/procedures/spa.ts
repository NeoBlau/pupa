import type { Engine, Procedure, Step } from '../engine.ts';
import { clamp01, rand, rubStep, spray } from './common.ts';

export function oilProcedure(e: Engine): Procedure {
  let drops = 0;
  let pourT = 0;

  const pour: Step = {
    title: 'Pour',
    hint: 'Hold to drip warm oil onto her feet',
    cursor: 'bottle',
    enter() {
      drops = 0;
    },
    update(dt) {
      if (!e.ptr.down) return;
      pourT += dt;
      if (pourT < 0.16) return;
      pourT = 0;
      const x = e.ptr.x + rand(-6, 6) * e.u;
      const y = e.ptr.y + rand(-6, 6) * e.u;
      // A drop falls toward the skin (shrinks), then splats into the oil layer.
      e.particle('water', x, y, 34 * e.u, {
        tint: 0xffc24a,
        grow: -1.6,
        max: 0.22,
        fade: false,
        rot: 0,
        onEnd: () => {
          e.stamp('oil', x, y, 46 * e.u, { alpha: 0.8 });
          e.stamp('oil', x + rand(-20, 20) * e.u, y + rand(0, 30) * e.u, 26 * e.u, { alpha: 0.6 });
          e.pinch(x, y, 40 * e.u, 0.08);
          e.ripple(x, y, 0xffe2a0, 30);
          e.hooks.sfx('drop');
          e.hooks.haptic('tick');
          drops++;
          e.work(2);
        },
      });
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
      if (Math.random() < 0.25) e.particle('sparkle', p.x + rand(-60, 60) * e.u, p.y + rand(-60, 60) * e.u, rand(10, 22) * e.u, { blend: 'add', max: 0.5, tint: 0xfff2c0 });
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
      const oiled = e.coverage('oil', e.cellsInCircle(p.x, p.y, 40 * e.u)) > 0.3;
      e.pinch(p.x, p.y, 110 * e.u, 0.14);
      e.force(p.x, p.y, 120 * e.u, p.dx * 1.1, p.dy * 1.1);
      const d = Math.hypot(p.dx, p.dy);
      if (oiled) {
        kneaded += d;
        e.work(d / (55 * e.u));
        if (Math.random() < 0.08) e.particle('heart', p.x, p.y - 40 * e.u, 26 * e.u, { vy: -120 * e.u, max: 0.9, spin: 0.5 });
      }
      if (Math.random() < 0.2) e.hooks.haptic('tick');
    },
    update() {
      if (e.ptr.down) e.pinch(e.ptr.x, e.ptr.y, 90 * e.u, 0.1);
    },
    progress: () => clamp01(kneaded / (2600 * e.u)),
  };

  return { id: 'oil', steps: [pour, spread, massage], accuracy: () => 0.5 };
}

export function washProcedure(e: Engine): Procedure {
  const region = () => e.maskCells;
  const dripT = { t: 0 };

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
    region,
    onUpdate(dt) {
      if (!e.ptr.down) return;
      spray(e, e.ptr.x, e.ptr.y);
      e.stamp('wet', e.ptr.x, e.ptr.y, 80 * e.u, { alpha: 0.15 });
      dripT.t += dt;
      if (dripT.t > 0.25) {
        dripT.t = 0;
        // drops running down wet skin
        e.particle('water', e.ptr.x + rand(-80, 80) * e.u, e.ptr.y + rand(0, 60) * e.u, rand(10, 18) * e.u, { vy: rand(30, 70) * e.u, max: 2.5, alpha: 0.9 });
      }
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
        e.particle('bubble', p.x + rand(-50, 50) * e.u, p.y + rand(-50, 50) * e.u, rand(12, 30) * e.u, { vy: rand(-90, -30) * e.u, vx: rand(-30, 30) * e.u, grow: 0.3, max: rand(0.6, 1.4) });
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
    onUpdate() {
      if (e.ptr.down) spray(e, e.ptr.x, e.ptr.y);
    },
    onMove(p) {
      if (Math.random() < 0.3) e.particle('foam', p.x + rand(-40, 40) * e.u, p.y + rand(20, 60) * e.u, rand(20, 40) * e.u, { vy: rand(80, 160) * e.u, max: 0.9, alpha: 0.9 });
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

      // feather flutter
      e.cursor.rotation = Math.PI * 0.9 + Math.sin(performance.now() / 60) * 0.12 * (0.3 + energy);

      if (energy > 0.15) {
        twitchT += dt;
        if (twitchT > 0.14) {
          twitchT = 0;
          e.kick(e.ptr.x, e.ptr.y, 200 * e.u, 900 * e.u * energy);
          if (energy > 0.6 && Math.random() < 0.3) e.shake(6 * energy);
        }
        // toes curl down toward the sole
        const b = e.maskBox;
        e.force((b.x0 + b.x1) / 2, b.y0 + (b.y1 - b.y0) * 0.1, (b.x1 - b.x0) * 0.4, 0, 28 * e.u * energy);
        giggleT += dt;
        if (giggleT > 0.9 - energy * 0.4) {
          giggleT = 0;
          e.floatText(e.ptr.x + rand(-120, 120) * e.u, e.ptr.y - rand(60, 160) * e.u, GIGGLES[Math.floor(Math.random() * GIGGLES.length)], 0xffd6f0, 44);
          e.hooks.sfx('giggle');
          e.hooks.haptic('light');
        }
      }
    },
    progress: () => clamp01(total / 100),
  };
  return { id: 'tickle', steps: [step], accuracy: () => 0.5 };
}
