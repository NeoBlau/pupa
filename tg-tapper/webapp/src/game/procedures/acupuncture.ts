import { Graphics, type Container, type Sprite } from 'pixi.js';
import { ease, type Engine, type Procedure, type Step } from '../engine.ts';
import { clamp01, dist, fizz, marker, rand, rubStep, type ProcCtx } from './common.ts';

interface Point {
  x: number;
  y: number;
  marker: { c: Container; draw: (phase: number, alpha: number) => void };
  phaseOff: number;
  needle: Sprite | null;
  inserted: boolean;
  quality: number;
  qi: number;
  removed: boolean;
  bleed: boolean;
}

interface Drop {
  x: number;
  y: number;
  vol: number;
  grow: number;
  age: number;
  s: Sprite;
  trickle: { len: number; tip: Sprite | null; treated: boolean } | null;
  treatedUntil: number;
}

const PULSE = 1.1; // seconds per pulse

export function acupunctureProcedure(e: Engine, ctx: ProcCtx): Procedure {
  const pts: Point[] = [];
  const drops: Drop[] = [];
  const NEEDLE_H = 190;
  let time = 0;
  let lines: Graphics | null = null;
  let bled = 0;
  let trickles = 0;

  const norm = ctx.model.acupoints;
  const positions = norm?.length
    ? norm.map(([x, y]) => ({ x: x * e.texW, y: y * e.texH }))
    : Array.from({ length: 6 }).reduce<{ x: number; y: number }[]>((acc) => {
        acc.push(e.randomMaskPoint(acc, 120 * e.u, { y0: e.maskBox.y0 + (e.maskBox.y1 - e.maskBox.y0) * 0.22, y1: e.maskBox.y1 }));
        return acc;
      }, []);
  for (const p of positions) {
    pts.push({ ...p, marker: marker(e, p.x, p.y, 0x7cf7ff), phaseOff: Math.random(), needle: null, inserted: false, quality: 0, qi: 0, removed: false, bleed: false });
  }
  e.debug.points = pts;
  const phase = (p: Point) => ((time / PULSE + p.phaseOff) % 1 + 1) % 1;

  // 1. Disinfect -------------------------------------------------------------
  const pointCells = () => pts.flatMap((p) => e.cellsInCircle(p.x, p.y, 34 * e.u));
  const disinfect = rubStep(e, {
    title: 'Disinfect',
    hint: 'Wipe each point with an alcohol swab',
    cursor: 'swab',
    layer: 'wet',
    mode: 'paint',
    radius: 42,
    alpha: 0.55,
    target: 0.8,
    region: pointCells,
    onUpdate(dt) {
      time += dt;
      for (const p of pts) p.marker.draw(1, 0.45);
    },
  });

  // 2. Insert ---------------------------------------------------------------
  const insert: Step = {
    title: 'Insert',
    hint: 'Tap a point when its ring closes in',
    cursor: 'needle',
    update(dt) {
      time += dt;
      for (const p of pts) if (!p.inserted) p.marker.draw(phase(p), 1);
    },
    down(ptr) {
      const p = pts.filter((q) => !q.inserted).sort((a, b) => dist(a, ptr) - dist(b, ptr))[0];
      if (!p || dist(p, ptr) > 60 * e.u) return;
      const ph = phase(p);
      // The ring is smallest right before it wraps: best timing at ph≈0.92.
      const quality = clamp01(1 - Math.abs(ph - 0.92) / 0.45);
      p.inserted = true;
      p.quality = quality;
      p.marker.c.visible = false;
      const n = e.sprite('needle', p.x, p.y, (NEEDLE_H / 240) * 24 * e.u, { anchor: [0.5, 1], rot: rand(-0.12, 0.12), alpha: 0 });
      p.needle = e.attach(n, p.x, p.y);
      n.pivot.y = 0;
      e.tween(
        0.3,
        (k) => {
          const t = ease.back(k);
          n.alpha = Math.min(1, k * 3);
          // Positive pivot lifts the needle: it starts 120u above and plunges in.
          n.pivot.y = ((1 - t) * 120 * e.u) / n.scale.y;
          e.pinch(p.x, p.y, 40 * e.u, 0.25 * k);
        },
        () => {
          e.ripple(p.x, p.y, 0x7cf7ff, 40);
          e.hooks.sfx('needle');
          e.hooks.haptic('medium');
          e.work(4 + quality * 6);
          if (quality > 0.75) e.floatText(p.x, p.y - 90 * e.u, 'Perfect', 0x7cf7ff, 40);
          else if (quality < 0.35) {
            p.bleed = true;
            e.kick(p.x, p.y, 220 * e.u, 1400 * e.u);
            e.shake(8);
            e.floatText(p.x, p.y - 90 * e.u, 'Ouch!', 0xff7b7b, 46);
            e.hooks.sfx('ouch');
            e.hooks.haptic('error');
          }
        },
      );
    },
    progress: () => pts.filter((p) => p.inserted).length / pts.length,
  };

  // 3. Stimulate (twirl) ----------------------------------------------------
  const twirl: Step = {
    title: 'Stimulate',
    hint: 'Circle your finger around each needle to twirl it',
    cursor: null,
    enter() {
      lines = new Graphics();
      e.attachedC.addChildAt(lines, 0);
    },
    exit() {
      lines?.destroy();
      lines = null;
    },
    update(dt) {
      time += dt;
      for (const p of pts) {
        const near = e.ptr.down && dist(p, e.ptr) < 110 * e.u && e.ptr.speed > 150 * e.u;
        if (near && p.qi < 1) {
          p.qi = Math.min(1, p.qi + dt * 0.9);
          e.work(dt * 8);
          if (Math.random() < 0.3) e.particle('sparkle', p.x + rand(-20, 20) * e.u, p.y - rand(0, 60) * e.u, rand(10, 20) * e.u, { blend: 'add', vy: -60 * e.u, max: 0.6, tint: 0x9ffcff });
        }
        if (p.needle) p.needle.rotation = Math.sin(time * 14) * (near ? 0.12 : 0.02);
      }
      // energy lines between stimulated needles
      if (lines) {
        lines.clear();
        const active = pts.filter((p) => p.qi > 0.2);
        for (let i = 1; i < active.length; i++) {
          const a = active[i - 1];
          const b = active[i];
          const oa = e.skinOffset(a.x, a.y);
          const ob = e.skinOffset(b.x, b.y);
          lines
            .moveTo(a.x + oa.x, a.y + oa.y)
            .lineTo(b.x + ob.x, b.y + ob.y)
            .stroke({ width: 5 * e.u, color: 0x7cf7ff, alpha: 0.25 + 0.25 * Math.sin(time * 6 + i) * Math.min(a.qi, b.qi) });
        }
      }
    },
    progress: () => pts.reduce((s, p) => s + p.qi, 0) / pts.length,
  };

  // 4. Remove -----------------------------------------------------------------
  let grabbed: Point | null = null;
  const addDrop = (p: Point) => {
    const s = e.attach(e.sprite('blood', p.x, p.y, 4 * e.u), p.x, p.y);
    drops.push({ x: p.x, y: p.y, vol: 0, grow: rand(0.6, 1), age: 0, s, trickle: null, treatedUntil: 0 });
    bled++;
  };
  const remove: Step = {
    title: 'Remove',
    hint: 'Grab a needle and pull it straight up',
    cursor: null,
    down(ptr) {
      grabbed =
        pts
          .filter((p) => !p.removed)
          .map((p) => ({ p, d: Math.min(dist(p, ptr), dist({ x: p.x, y: p.y - NEEDLE_H * 0.5 * e.u }, ptr)) }))
          .filter((x) => x.d < 120 * e.u)
          .sort((a, b) => a.d - b.d)[0]?.p ?? null;
    },
    move(ptr) {
      const p = grabbed;
      if (!p || !p.needle) return;
      const pull = Math.max(0, p.y - NEEDLE_H * 0.5 * e.u - ptr.y);
      // Skin tents up with the needle before letting go.
      e.force(p.x, p.y, 45 * e.u, 0, -Math.min(pull, 70 * e.u) * 0.45);
      p.needle.pivot.y = Math.min(pull, 60 * e.u) / p.needle.scale.y;
      if (pull > 110 * e.u) {
        p.removed = true;
        grabbed = null;
        const n = p.needle;
        p.needle = null;
        e.tween(
          0.35,
          (k) => {
            n.pivot.y += (40 * e.u) / n.scale.y;
            n.alpha = 1 - k;
          },
          () => e.detach(n),
        );
        e.kick(p.x, p.y, 80 * e.u, 300 * e.u);
        e.hooks.sfx('pop');
        e.hooks.haptic('light');
        e.work(5);
        const last = pts.every((q) => q.removed);
        if (p.bleed || Math.random() < 0.4 || (last && bled === 0)) addDrop(p);
      }
    },
    up() {
      if (grabbed?.needle) grabbed.needle.pivot.y = 0;
      grabbed = null;
    },
    update(dt) {
      updateDrops(dt);
    },
    progress: () => pts.filter((p) => p.removed).length / pts.length,
  };

  // 5. Aftercare --------------------------------------------------------------
  let maxStain = 0.01;
  const stainCells = () => pts.flatMap((p) => e.cellsInCircle(p.x, p.y + 60 * e.u, 110 * e.u));
  function updateDrops(dt: number) {
    for (const d of drops) {
      if (d.vol <= 0 && d.age > 0.5) continue;
      d.age += dt;
      if (d.vol < d.grow && d.age < 1.4) d.vol = Math.min(d.grow, d.vol + dt * 0.8);
      d.s.scale.set(((6 + 22 * d.vol) * e.u) / d.s.texture.width);
      // Left alone, a big drop starts running down the skin.
      if (!d.trickle && d.age > 3.5 && d.vol > 0.45) {
        d.trickle = { len: 0, tip: null, treated: false };
        trickles++;
        e.hooks.haptic('error');
      }
      const t = d.trickle;
      if (t && t.len < 150 * e.u && d.vol > 0.2) {
        const step = dt * 35 * e.u;
        const y0 = d.y + t.len;
        t.len += step;
        const wob = Math.sin(t.len / (12 * e.u)) * 3 * e.u;
        e.paintLine('fluid', d.x + wob, y0, d.x + wob, d.y + t.len, 5 * e.u, { alpha: 0.95, tint: 0x8c0d16, tex: 'hard' }, 0.5);
        if (!t.tip) t.tip = e.attach(e.sprite('blood', d.x, d.y + t.len, 12 * e.u), d.x, d.y + t.len);
        e.moveAttached(t.tip, d.x + wob, d.y + t.len);
      }
    }
    maxStain = Math.max(maxStain, e.coverage('fluid', stainCells(), 0.25));
  }

  let cottonRed = 0;
  const aftercare: Step = {
    title: 'Aftercare',
    hint: 'Blot blood with cotton. Running blood? Peroxide first',
    cursor: 'cotton',
    tools: [
      { id: 'cotton', label: 'Cotton', icon: '☁️' },
      { id: 'peroxide', label: 'Peroxide', icon: '🧪' },
    ],
    tool: 'cotton',
    select(id) {
      this.tool = id;
      this.cursor = id === 'peroxide' ? 'peroxide' : 'cotton';
    },
    down() {
      if (this.tool === 'peroxide') e.hooks.loop('fizz', true);
    },
    up() {
      e.hooks.loop('fizz', false);
    },
    move(ptr) {
      if (this.tool !== 'cotton') return;
      e.force(ptr.x, ptr.y, 60 * e.u, ptr.dx * 0.4, ptr.dy * 0.4);
      for (const d of drops) {
        const near = dist(d, ptr) < 45 * e.u || (d.trickle && Math.abs(ptr.x - d.x) < 40 * e.u && ptr.y > d.y && ptr.y < d.y + d.trickle.len + 30 * e.u);
        if (!near) continue;
        if (d.vol > 0) {
          d.vol = Math.max(0, d.vol - Math.hypot(ptr.dx, ptr.dy) / (160 * e.u));
          if (Math.random() < 0.4) e.stamp('fluid', ptr.x, ptr.y, 16 * e.u, { alpha: 0.12, tint: 0xc4505c });
          cottonRed = Math.min(1, cottonRed + 0.02);
          if (d.vol <= 0) {
            d.s.visible = false;
            e.work(4);
          }
        }
      }
      // Dried runs barely come off unless treated with peroxide first.
      const treated = drops.some((d) => d.treatedUntil > time && dist(d, ptr) < 200 * e.u);
      e.stamp('fluid', ptr.x, ptr.y, 34 * e.u, { erase: true, alpha: treated ? 0.55 : 0.07 });
      for (const d of drops) if (d.trickle?.tip && d.vol <= 0 && treated) d.trickle.tip.visible = false;
      e.cursor.tint = mix(0xffffff, 0xe8a0a8, cottonRed);
    },
    update(dt) {
      time += dt;
      updateDrops(dt);
      if (this.tool === 'peroxide' && e.ptr.down) {
        e.hooks.haptic('tick');
        for (const d of drops) {
          const run = d.trickle?.len ?? 0;
          const near = dist(d, e.ptr) < 60 * e.u || (run && Math.abs(e.ptr.x - d.x) < 50 * e.u && e.ptr.y > d.y - 30 * e.u && e.ptr.y < d.y + run + 40 * e.u);
          if (!near) continue;
          d.treatedUntil = time + 6;
          if (d.trickle) d.trickle.treated = true;
          // Peroxide foams pink on blood.
          fizz(e, e.ptr.x, e.ptr.y, 26 * e.u, d.vol > 0 || run ? 0xffc9d2 : 0xffffff);
          e.work(dt * 6);
        }
        if (Math.random() < 0.5) fizz(e, e.ptr.x, e.ptr.y, 20 * e.u);
      }
    },
    progress() {
      const live = drops.filter((d) => d.vol > 0).length;
      const dropsDone = drops.length ? 1 - live / drops.length : 1;
      const stain = e.coverage('fluid', stainCells(), 0.25);
      const clean = stain <= 0.02 ? 1 : clamp01(1 - stain / maxStain);
      const untreated = drops.some((d) => d.trickle && !d.trickle.treated);
      return Math.min(untreated ? 0.85 : 1, dropsDone * 0.6 + clean * 0.4);
    },
  };

  return {
    id: 'needles',
    steps: [disinfect, insert, twirl, remove, aftercare],
    accuracy() {
      const q = pts.reduce((s, p) => s + p.quality, 0) / pts.length;
      return clamp01(q * 0.75 + (trickles ? 0.1 : 0.25));
    },
    dispose() {
      for (const p of pts) {
        e.detach(p.marker.c);
        if (p.needle) e.detach(p.needle);
      }
      for (const d of drops) {
        e.detach(d.s);
        if (d.trickle?.tip) e.detach(d.trickle.tip);
      }
      lines?.destroy();
      e.cursor.tint = 0xffffff;
      e.clearLayer('fluid');
    },
  };
}

function mix(a: number, b: number, t: number) {
  const ch = (s: number) => [(s >> 16) & 255, (s >> 8) & 255, s & 255];
  const [r1, g1, b1] = ch(a);
  const [r2, g2, b2] = ch(b);
  return (Math.round(r1 + (r2 - r1) * t) << 16) | (Math.round(g1 + (g2 - g1) * t) << 8) | Math.round(b1 + (b2 - b1) * t);
}
export { mix };
