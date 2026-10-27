import { Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { distToPath, pointInPoly, type Engine, type Procedure, type Step } from '../engine.ts';
import { bandageStep, clamp01, dist, healStep, rand, rubStep, type DesignId, type ProcCtx, type TattooSave } from './common.ts';

type Pt = { x: number; y: number };

// ---------------------------------------------------------------------------
// Designs in unit space (-1..1), closed outlines.

function unitDesign(id: DesignId): Pt[] {
  const pts: Pt[] = [];
  if (id === 'heart') {
    for (let i = 0; i <= 120; i++) {
      const t = (i / 120) * Math.PI * 2;
      pts.push({ x: (16 * Math.sin(t) ** 3) / 17, y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17 });
    }
  } else if (id === 'star') {
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
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

/** Outline in texture space, resampled every `step` px. */
export function designPath(t: TattooSave, step: number) {
  const raw = unitDesign(t.design).map((p) => ({ x: t.x + p.x * t.size, y: t.y + p.y * t.size }));
  const out: Pt[] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1];
    const b = raw[i];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return { path: out, poly: raw };
}

const INK = 0x15121e;
const SHADE = 0x2a2530;

/** Re-draws a finished tattoo (e.g. after reload). */
export function restoreTattoo(e: Engine, t: TattooSave) {
  const { path, poly } = designPath(t, 3 * e.u);
  for (const p of path) e.stamp('ink', p.x, p.y, 3.6 * e.u, { alpha: 0.95, tint: INK, tex: 'hard' });
  for (let y = t.y - t.size; y <= t.y + t.size; y += 7 * e.u)
    for (let x = t.x - t.size; x <= t.x + t.size; x += 7 * e.u) if (pointInPoly(x, y, poly)) e.stamp('shade', x, y, 9 * e.u, { alpha: 0.35, tint: SHADE });
}

// ---------------------------------------------------------------------------

export function tattooProcedure(e: Engine, ctx: ProcCtx): Procedure {
  let design: TattooSave | null = null;
  let path: Pt[] = [];
  let poly: Pt[] = [];
  let revealed: boolean[] = [];
  let traced: boolean[] = [];
  let inkLen = 0;
  let offLen = 0;
  let shadeIn = 0;
  let shadeOut = 0;
  const plasma: Sprite[] = [];
  let ghost: Graphics | null = null;

  const size = () => design?.size ?? 150 * e.u;
  const center = () => (design ? { x: design.x, y: design.y } : e.maskCenter);
  const area = () => e.cellsInCircle(center().x, center().y, size() * 1.35);
  const interior = () => e.cellsInPolygon(poly);

  const choose: Step = {
    title: 'Design',
    hint: 'Pick a design',
    cursor: null,
    tools: [
      { id: 'heart', label: 'Heart', icon: '❤️' },
      { id: 'star', label: 'Star', icon: '⭐' },
      { id: 'moon', label: 'Moon', icon: '🌙' },
    ],
    select(id) {
      this.tool = id;
      const c = e.maskCenter;
      design = { design: id as DesignId, x: c.x, y: c.y + 40 * e.u, size: Math.min(150 * e.u, (e.maskBox.x1 - e.maskBox.x0) * 0.3) };
      ({ path, poly } = designPath(design, 4 * e.u));
      revealed = path.map(() => false);
      traced = path.map(() => false);
      ghost?.destroy();
      ghost = new Graphics();
      ghost.poly(poly.flatMap((p) => [p.x, p.y])).stroke({ width: 3 * e.u, color: 0xb98cff, alpha: 0.6 });
      e.fx.addChild(ghost);
    },
    exit() {
      ghost?.destroy();
      ghost = null;
    },
    progress: () => (design ? 1 : 0),
  };

  const clean = rubStep(e, {
    title: 'Clean',
    hint: 'Wipe the area with green soap',
    cursor: 'gauze',
    layer: 'wet',
    mode: 'paint',
    radius: 70,
    alpha: 0.45,
    target: 0.85,
    region: area,
  });

  const stencil: Step = {
    title: 'Stencil',
    hint: 'Press the transfer paper over the area',
    cursor: 'paper',
    move(p) {
      let n = 0;
      path.forEach((q, i) => {
        if (revealed[i] || dist(q, p) > 70 * e.u) return;
        revealed[i] = true;
        n++;
        if (i % 2 === 0) e.stamp('stencil', q.x, q.y, 2.6 * e.u, { alpha: 0.85, tint: 0x6a2bd6, tex: 'hard' });
      });
      if (n) e.work(n * 0.15);
      e.pinch(p.x, p.y, 80 * e.u, 0.05);
    },
    progress: () => clamp01(revealed.filter(Boolean).length / Math.max(1, path.length) / 0.97),
  };

  // Tattoo machine: shared by lining and shading.
  let buzzT = 0;
  let travel = 0;
  const machineFx = (p: { x: number; y: number; dx: number; dy: number }, d: number) => {
    travel += d;
    e.force(p.x, p.y, 80 * e.u, p.dx * 0.15, p.dy * 0.15);
    e.stamp('redness', p.x, p.y, 34 * e.u, { alpha: 0.05 });
    if (travel > 30 * e.u) {
      travel = 0;
      // Excess ink pooling on the skin around the needle.
      e.stamp('smudge', p.x + rand(-12, 12) * e.u, p.y + rand(-12, 12) * e.u, rand(12, 22) * e.u, { alpha: 0.32, tint: 0x221a2a });
      // Pinpoint plasma / blood beading along fresh lines.
      if (Math.random() < 0.35) {
        const s = e.sprite('blood', p.x + rand(-6, 6) * e.u, p.y + rand(-6, 6) * e.u, rand(4, 8) * e.u, { alpha: 0.85 });
        plasma.push(e.attach(s, s.x, s.y));
      }
    }
  };
  const machineUpdate = (dt: number) => {
    // vibrating machine
    e.cursor.pivot.set(rand(-1.5, 1.5), rand(-1.5, 1.5));
    if (e.ptr.down) {
      buzzT += dt;
      if (buzzT > 0.05) {
        buzzT = 0;
        e.hooks.haptic('tick');
      }
    }
  };

  const lining: Step = {
    title: 'Lining',
    hint: 'Trace the stencil with the machine',
    cursor: 'machine',
    down() {
      e.hooks.loop('buzz', true);
    },
    up() {
      e.hooks.loop('buzz', false);
    },
    move(p) {
      const d = Math.hypot(p.dx, p.dy);
      if (d === 0 || d > 120 * e.u) return;
      e.paintLine('ink', p.x - p.dx, p.y - p.dy, p.x, p.y, 3.6 * e.u, { alpha: 0.95, tint: INK, tex: 'hard' }, 0.5);
      inkLen += d;
      if (distToPath(p.x, p.y, path) > 14 * e.u) offLen += d;
      let n = 0;
      path.forEach((q, i) => {
        if (!traced[i] && dist(q, p) < 11 * e.u) {
          traced[i] = true;
          n++;
        }
      });
      if (n) e.work(n * 0.35);
      machineFx(p, d);
    },
    update: machineUpdate,
    exit() {
      e.cursor.pivot.set(0, 0);
    },
    progress: () => clamp01(traced.filter(Boolean).length / Math.max(1, path.length) / 0.92),
  };

  const wipeStep = (title: string): Step => {
    let start = 0.01;
    let plasmaStart = 0;
    return {
      title,
      hint: 'Wipe off excess ink and blood',
      cursor: 'gauze',
      enter() {
        start = Math.max(0.01, e.coverage('smudge', area(), 0.15));
        plasmaStart = plasma.length;
      },
      move(p) {
        e.paintLine('smudge', p.x - p.dx, p.y - p.dy, p.x, p.y, 48 * e.u, { erase: true, alpha: 0.35 });
        e.paintLine('stencil', p.x - p.dx, p.y - p.dy, p.x, p.y, 48 * e.u, { erase: true, alpha: 0.2 });
        e.force(p.x, p.y, 70 * e.u, p.dx * 0.4, p.dy * 0.4);
        for (let i = plasma.length - 1; i >= 0; i--) {
          if (dist(plasma[i], p) < 40 * e.u) {
            e.detach(plasma[i]);
            plasma.splice(i, 1);
            e.work(1);
          }
        }
      },
      progress() {
        const s = e.coverage('smudge', area(), 0.15);
        const smudgeP = s <= 0.03 ? 1 : clamp01((start - s) / (start - 0.03));
        const plasmaP = plasmaStart ? 1 - plasma.length / plasmaStart : 1;
        return Math.min(smudgeP, plasmaP);
      },
    };
  };

  const shading: Step = {
    title: 'Shading',
    hint: 'Fill the inside with soft shading',
    cursor: 'machine',
    down() {
      e.hooks.loop('buzz', true);
    },
    up() {
      e.hooks.loop('buzz', false);
    },
    move(p) {
      const d = Math.hypot(p.dx, p.dy);
      if (d === 0 || d > 120 * e.u) return;
      e.paintLine('shade', p.x - p.dx, p.y - p.dy, p.x, p.y, 9 * e.u, { alpha: 0.16, tint: SHADE }, 0.6);
      if (pointInPoly(p.x, p.y, poly)) shadeIn += d;
      else shadeOut += d;
      e.work(d / (60 * e.u));
      machineFx(p, d * 0.5);
    },
    update: machineUpdate,
    exit() {
      e.cursor.pivot.set(0, 0);
    },
    progress: () => clamp01(e.coverage('shade', interior(), 0.5) / 0.85),
  };

  const ointment = rubStep(e, {
    title: 'Ointment',
    hint: 'Thin layer of healing ointment',
    cursor: 'tube',
    layer: 'gloss',
    mode: 'paint',
    radius: 55,
    alpha: 0.45,
    target: 0.85,
    region: area,
  });

  // Cling film unrolled across the tattoo.
  let film: Container | null = null;
  let filmMask: Graphics | null = null;
  let filmReach = 0;
  const wrap: Step = {
    title: 'Wrap',
    hint: 'Swipe across to wrap it in film',
    cursor: null,
    enter() {
      const w = size() * 2.8;
      film = new Container();
      const ts = new TilingSprite({ texture: e.T.film, width: w, height: w });
      ts.anchor.set(0.5);
      film.addChild(ts);
      filmMask = new Graphics();
      film.addChild(filmMask);
      ts.mask = filmMask;
      e.attach(film, center().x, center().y);
      filmReach = 0;
      filmMask.rect(-w / 2, -w / 2, 0.001, w).fill(0xffffff);
    },
    move(p) {
      if (!film || !filmMask) return;
      const w = size() * 2.8;
      const x0 = center().x - w / 2;
      const reach = clamp01((p.x - x0) / w);
      if (reach > filmReach && Math.abs(p.y - center().y) < w / 2) {
        filmReach = reach;
        filmMask.clear().rect(-w / 2, -w / 2, w * filmReach, w).fill(0xffffff);
        e.hooks.haptic('tick');
        e.work(0.5);
      }
    },
    progress: () => clamp01(filmReach / 0.95),
  };

  return {
    id: 'tattoo',
    steps: [choose, clean, stencil, lining, wipeStep('Wipe'), shading, wipeStep('Wipe again'), ointment, wrap],
    // Called once, when the last step completes.
    accuracy() {
      const lineAcc = inkLen ? 1 - offLen / inkLen : 0;
      const shadeAcc = shadeIn + shadeOut ? shadeIn / (shadeIn + shadeOut) : 0;
      if (design) ctx.saveTattoo(design);
      return clamp01(lineAcc * 0.6 + shadeAcc * 0.4);
    },
    dispose() {
      for (const s of plasma) e.detach(s);
      ghost?.destroy();
      if (film) e.detach(film);
      e.cursor.pivot.set(0, 0);
      // The tattoo itself (ink, shade) stays on the skin; prep layers go.
      for (const id of ['stencil', 'smudge', 'gloss', 'wet'] as const) e.clearLayer(id);
      e.fadeLayer('redness', 0.6);
    },
  };
}

// ---------------------------------------------------------------------------
// Laser removal

export function removalProcedure(e: Engine, ctx: ProcCtx): Procedure {
  const t = ctx.getTattoo();
  const c = t ? { x: t.x, y: t.y } : e.maskCenter;
  const size = t?.size ?? 150 * e.u;
  const area = () => e.cellsInCircle(c.x, c.y, size * 1.35);
  const inkAt = (i: number) => e.layers.ink.grid[i] + e.layers.shade.grid[i];
  const inkCells = area().filter((i) => inkAt(i) > 0.15);
  const inkLeft = () => inkCells.filter((i) => inkAt(i) > 0.15).length;
  const inkStart = Math.max(1, inkLeft());
  const dots: Sprite[] = [];
  const bandage = { s: null as Sprite | null };
  let pulseT = 0;
  let aim: Sprite | null = null;

  const clean = rubStep(e, {
    title: 'Clean',
    hint: 'Alcohol wipe over the tattoo',
    cursor: 'swab',
    layer: 'wet',
    mode: 'paint',
    radius: 60,
    alpha: 0.5,
    target: 0.85,
    region: area,
  });

  const laser: Step = {
    title: 'Laser',
    hint: 'Hold over the ink. Real removal takes 6–10 sessions',
    cursor: 'laser',
    enter() {
      aim = e.sprite('hard', 0, 0, 10 * e.u, { tint: 0xff2030 });
      aim.blendMode = 'add';
      e.fx.addChild(aim);
    },
    exit() {
      aim?.destroy();
      aim = null;
    },
    update(dt) {
      if (aim) {
        aim.visible = e.ptr.down;
        aim.position.set(e.ptr.x, e.ptr.y);
      }
      e.fadeLayer('frost', dt * 0.12);
      if (!e.ptr.down) return;
      pulseT += dt;
      if (pulseT < 0.09) return;
      pulseT = 0;
      const { x, y } = e.ptr;
      e.particle('sparkle', x, y, 60 * e.u, { blend: 'add', max: 0.12, tint: 0xdff8ff });
      e.hooks.sfx('zap');
      e.hooks.haptic('light');
      const i = e.cellIndex(x, y);
      if (i < 0 || inkAt(i) < 0.12) return;
      // Ink shatters; the skin "frosts" white for a few seconds.
      e.stamp('ink', x, y, 20 * e.u, { erase: true, alpha: 0.4 });
      e.stamp('shade', x, y, 20 * e.u, { erase: true, alpha: 0.4 });
      e.stamp('frost', x, y, 14 * e.u, { alpha: 0.5, tex: 'hard' });
      e.stamp('redness', x, y, 30 * e.u, { alpha: 0.08 });
      e.kick(x, y, 40 * e.u, 200 * e.u);
      e.work(1.2);
      if (Math.random() < 0.07) {
        const s = e.sprite('blood', x + rand(-8, 8) * e.u, y + rand(-8, 8) * e.u, rand(4, 7) * e.u);
        dots.push(e.attach(s, s.x, s.y));
      }
    },
    progress: () => clamp01((1 - inkLeft() / inkStart) / 0.9),
  };

  const cool = rubStep(e, {
    title: 'Cool',
    hint: 'Ice pack to calm the redness',
    cursor: 'ice',
    layer: 'redness',
    mode: 'erase',
    radius: 80,
    alpha: 0.18,
    target: 0.1,
    region: area,
    onUpdate(dt) {
      e.fadeLayer('frost', dt * 0.2);
    },
  });

  const blot: Step = {
    title: 'Blot',
    hint: 'Blot the pinpoint bleeding',
    cursor: 'gauze',
    move(p) {
      for (let i = dots.length - 1; i >= 0; i--)
        if (dist(dots[i], p) < 40 * e.u) {
          e.detach(dots[i]);
          dots.splice(i, 1);
          e.work(1);
        }
    },
    progress: () => (dots.length ? 0 : 1),
  };

  const ointment = rubStep(e, {
    title: 'Ointment',
    hint: 'Healing ointment over the area',
    cursor: 'tube',
    layer: 'gloss',
    mode: 'paint',
    radius: 55,
    alpha: 0.45,
    target: 0.8,
    region: area,
  });

  const dress = bandageStep(e, () => c, () => size, bandage);

  const heal = healStep(
    e,
    3.5,
    (k, dt) => {
      e.fadeLayer('ink', dt * 0.9);
      e.fadeLayer('shade', dt * 0.9);
      e.fadeLayer('redness', dt * 0.8);
      e.fadeLayer('frost', dt);
      e.fadeLayer('gloss', dt * 0.6);
      if (bandage.s && k > 0.6) bandage.s.alpha = clamp01((1 - k) / 0.4);
    },
    () => {
      ctx.saveTattoo(null);
      e.clearLayer('ink');
      e.clearLayer('shade');
    },
  );

  return {
    id: 'removal',
    steps: [clean, laser, cool, blot, ointment, dress, heal],
    accuracy: () => clamp01(1 - inkLeft() / inkStart),
    dispose() {
      for (const s of dots) e.detach(s);
      if (bandage.s) e.detach(bandage.s);
      aim?.destroy();
      for (const id of ['frost', 'gloss', 'wet'] as const) e.clearLayer(id);
    },
  };
}
