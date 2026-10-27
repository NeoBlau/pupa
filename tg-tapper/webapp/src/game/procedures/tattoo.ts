import * as THREE from 'three';
import type { Engine, Procedure, Step } from '../engine.ts';
import { bandageStep, bead, clamp01, healStep, rand, rubStep, type DesignId, type ProcCtx, type Surf, type TattooSave } from './common.ts';

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

function pointInPoly(x: number, y: number, poly: P2[]) {
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

// ---------------------------------------------------------------------------

export function tattooProcedure(e: Engine, ctx: ProcCtx): Procedure {
  let design: TattooSave | null = null;
  let D: ReturnType<typeof designPath> | null = null;
  let revealed: boolean[] = [];
  let traced: boolean[] = [];
  let inkLen = 0;
  let offLen = 0;
  let shadeIn = 0;
  let shadeOut = 0;
  const plasma: THREE.Mesh[] = [];
  let ghost: THREE.Line | null = null;
  const prev = new THREE.Vector3();

  const centerSurf = (): Surf => e.surfaceAt(new THREE.Vector3(0.006, 0.112, 0.03))!;
  const size = () => design?.size ?? 0.017;
  const area = () => e.cellsInSphere(D?.f.c ?? centerSurf().p, size() * 1.4);
  const interior = () => (D ? e.paint.validCells.filter((c) => { const l = D!.local(e.paint.cellWorld(c)); return pointInPoly(l.x, l.y, D!.unit); }) : []);
  const distToPath = (p: THREE.Vector3) => (D ? Math.min(...D.path.map((q) => q.distanceTo(p))) : Infinity);

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
      const s = centerSurf();
      const t1 = new THREE.Vector3(1, 0, 0).sub(s.n.clone().multiplyScalar(s.n.x)).normalize();
      design = { design: id as DesignId, c: s.p.toArray() as TattooSave['c'], n: s.n.toArray() as TattooSave['n'], t1: t1.toArray() as TattooSave['t1'], size: 0.017 };
      D = designPath(e, design, 0.0008);
      revealed = D.path.map(() => false);
      traced = D.path.map(() => false);
      ghost?.removeFromParent();
      ghost = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(D.path.map((p, i) => p.clone().addScaledVector(D!.f.n, 0.0004 + 0 * i))),
        new THREE.LineDashedMaterial({ color: 0xb98cff, dashSize: 0.0015, gapSize: 0.001, transparent: true, opacity: 0.8 }),
      );
      ghost.computeLineDistances();
      e.root.add(ghost);
    },
    exit() {
      ghost?.removeFromParent();
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
      if (!D) return;
      let n = 0;
      D.path.forEach((q, i) => {
        if (revealed[i] || q.distanceTo(p.p) > 70 * e.u) return;
        revealed[i] = true;
        n++;
        if (i % 2 === 0) e.stamp('stencil', q, 2.6 * e.u, { alpha: 0.85, tex: 'hard' });
      });
      if (n) e.work(n * 0.15);
      e.press(p.p, 80 * e.u, 0.001);
    },
    progress: () => clamp01(revealed.filter(Boolean).length / Math.max(1, revealed.length) / 0.97),
  };

  // Tattoo machine: shared by lining and shading.
  let buzzT = 0;
  let travel = 0;
  const machineFx = (p: { p: THREE.Vector3; n: THREE.Vector3; uv: THREE.Vector2; delta: THREE.Vector3 }, d: number) => {
    travel += d;
    // The needle stings: toes twitch now and then.
    if (Math.random() < 0.04) e.react('sting', 0.25);
    // Soft skin: the needle tip presses in and drags the skin along.
    e.force(p.p, 80 * e.u, p.delta.clone().multiplyScalar(0.3));
    e.press(p.p, 40 * e.u, 0.0013);
    e.stamp('redness', p.uv, 34 * e.u, { alpha: 0.05 });
    if (travel > 30 * e.u) {
      travel = 0;
      // Excess ink pooling on the skin around the needle.
      e.stamp('smudge', p.p.clone().add(new THREE.Vector3(rand(-1, 1) * 0.0025, rand(-1, 1) * 0.0025, 0)), rand(12, 22) * e.u, { alpha: 0.32 });
      // Pinpoint plasma / blood beading along fresh lines.
      if (Math.random() < 0.35) {
        const s = e.surfaceAt(p.p.clone().add(new THREE.Vector3(rand(-1, 1) * 0.0012, rand(-1, 1) * 0.0012, 0)));
        if (s) plasma.push(bead(e, s, e.M.blood, rand(0.35, 0.7) * 0.001));
      }
    }
  };
  const machineUpdate = (dt: number) => {
    e.toolPose.jitter = e.ptr.down ? 0.0003 : 0.00008;
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
    down(p) {
      prev.copy(p.p);
      e.hooks.loop('buzz', true);
    },
    up() {
      e.hooks.loop('buzz', false);
    },
    move(p) {
      const d = p.p.distanceTo(prev);
      if (d === 0 || d > 0.03 || !D) {
        prev.copy(p.p);
        return;
      }
      e.paintLine('ink', prev, p.p, 3.6 * e.u, { alpha: 0.95, tex: 'hard' }, 0.5);
      inkLen += d;
      if (distToPath(p.p) > 14 * e.u) offLen += d;
      let n = 0;
      D.path.forEach((q, i) => {
        if (!traced[i] && q.distanceTo(p.p) < 11 * e.u) {
          traced[i] = true;
          n++;
        }
      });
      if (n) e.work(n * 0.35);
      machineFx(p, d);
      prev.copy(p.p);
    },
    update: machineUpdate,
    progress: () => clamp01(traced.filter(Boolean).length / Math.max(1, traced.length) / 0.92),
  };

  const wipeStep = (title: string): Step => {
    let start = 0.01;
    let plasmaStart = 0;
    const last = new THREE.Vector3();
    return {
      title,
      hint: 'Wipe off excess ink and blood',
      cursor: 'gauze',
      enter() {
        start = Math.max(0.01, e.coverage('smudge', area(), 0.15));
        plasmaStart = plasma.length;
      },
      down(p) {
        last.copy(p.p);
      },
      move(p) {
        e.paintLine('smudge', last, p.p, 48 * e.u, { erase: true, alpha: 0.35 });
        e.paintLine('stencil', last, p.p, 48 * e.u, { erase: true, alpha: 0.2 });
        last.copy(p.p);
        e.press(p.p, 70 * e.u, 0.0012);
        for (let i = plasma.length - 1; i >= 0; i--) {
          if (plasma[i].position.distanceTo(p.p) < 40 * e.u) {
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
    down(p) {
      prev.copy(p.p);
      e.hooks.loop('buzz', true);
    },
    up() {
      e.hooks.loop('buzz', false);
    },
    move(p) {
      const d = p.p.distanceTo(prev);
      if (d === 0 || d > 0.03 || !D) {
        prev.copy(p.p);
        return;
      }
      e.paintLine('shade', prev, p.p, 9 * e.u, { alpha: 0.16 }, 0.6);
      const l = D.local(p.p);
      if (pointInPoly(l.x, l.y, D.unit)) shadeIn += d;
      else shadeOut += d;
      e.work(d / (60 * e.u));
      machineFx(p, d * 0.5);
      prev.copy(p.p);
    },
    update: machineUpdate,
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

  // Cling film unrolled across the tattoo: a decal revealed left → right.
  let film: THREE.Object3D | null = null;
  let filmAlpha: CanvasRenderingContext2D | null = null;
  let filmTex: THREE.CanvasTexture | null = null;
  let reach = 0;
  const wrap: Step = {
    title: 'Wrap',
    hint: 'Swipe across to wrap it in film',
    cursor: null,
    enter() {
      if (!D) return;
      const cv = document.createElement('canvas');
      cv.width = 256;
      cv.height = 16;
      filmAlpha = cv.getContext('2d')!;
      filmTex = new THREE.CanvasTexture(cv);
      const mat = e.M.film.clone();
      mat.alphaMap = filmTex;
      mat.transparent = true;
      const w = size() * 3;
      film = e.decal(mat, D.f.c, D.f.n, new THREE.Vector3(w, w, w), Math.atan2(D.f.t1.y, D.f.t1.x));
      reach = 0;
    },
    move(p) {
      if (!D || !filmAlpha || !filmTex) return;
      const w = size() * 3;
      const r = clamp01((p.p.clone().sub(D.f.c).dot(D.f.t1) + w / 2) / w);
      if (r > reach) {
        reach = r;
        filmAlpha.fillStyle = '#000';
        filmAlpha.fillRect(0, 0, 256, 16);
        filmAlpha.fillStyle = '#fff';
        filmAlpha.fillRect(0, 0, 256 * reach, 16);
        filmTex.needsUpdate = true;
        e.hooks.haptic('tick');
        e.work(0.5);
      }
    },
    progress: () => clamp01(reach / 0.95),
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
      ghost?.removeFromParent();
      if (film) e.detach(film);
      for (const id of ['stencil', 'smudge', 'gloss', 'wet'] as const) e.clearLayer(id);
      e.fadeLayer('redness', 0.6);
    },
  };
}

// ---------------------------------------------------------------------------
// Laser removal

export function removalProcedure(e: Engine, ctx: ProcCtx): Procedure {
  const t = ctx.getTattoo();
  const f = t ? designPath(e, t, 0.002).f : { c: e.L.center, n: new THREE.Vector3(0, 0, 1) };
  const size = t?.size ?? 0.017;
  const center: Surf = e.surfaceAt(f.c) ?? e.randomSolePoint();
  const area = () => e.cellsInSphere(center.p, size * 1.4);
  const inkAt = (c: number) => e.paint.grids.ink[c] + e.paint.grids.shade[c];
  const inkCells = area().filter((c) => inkAt(c) > 0.15);
  const inkLeft = () => inkCells.filter((c) => inkAt(c) > 0.15).length;
  const inkStart = Math.max(1, inkLeft());
  const dots: THREE.Mesh[] = [];
  const bandage = { o: null as THREE.Object3D | null };
  let pulseT = 0;
  let aim: THREE.Sprite | null = null;

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
      aim = e.particle('hard', center.p, 0.0018, { add: true, tint: 0xff2030, max: 1e9, fade: false });
    },
    exit() {
      aim?.removeFromParent();
      aim = null;
    },
    update(dt) {
      e.toolPose.lift = 0.012;
      if (aim) {
        aim.visible = e.ptr.down && e.ptr.hit;
        aim.position.copy(e.ptr.p).addScaledVector(e.ptr.n, 0.0005);
      }
      e.fadeLayer('frost', dt * 0.12);
      if (!e.ptr.down || !e.ptr.hit) return;
      pulseT += dt;
      if (pulseT < 0.09) return;
      pulseT = 0;
      const { p, uv } = e.ptr;
      e.particle('sparkle', p.clone().addScaledVector(e.ptr.n, 0.001), 0.012, { add: true, max: 0.12, tint: 0xdff8ff });
      e.hooks.sfx('zap');
      if (Math.random() < 0.3) e.react('sting', 0.35);
      e.hooks.haptic('light');
      const c = e.paint.cellOf(uv.x, uv.y);
      if (c < 0 || inkAt(c) < 0.12) return;
      // Ink shatters; the skin "frosts" white for a few seconds.
      e.stamp('ink', uv, 20 * e.u, { erase: true, alpha: 0.4 });
      e.stamp('shade', uv, 20 * e.u, { erase: true, alpha: 0.4 });
      e.stamp('frost', uv, 14 * e.u, { alpha: 0.5, tex: 'hard' });
      e.stamp('redness', uv, 30 * e.u, { alpha: 0.08 });
      e.impulse(p, 30 * e.u, 0.03);
      e.work(1.2);
      if (Math.random() < 0.07) {
        const s = e.surfaceAt(p.clone().add(new THREE.Vector3(rand(-1, 1) * 0.0015, rand(-1, 1) * 0.0015, 0)));
        if (s) dots.push(bead(e, s, e.M.blood, rand(0.4, 0.7) * 0.001));
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
      if (e.ptr.down && Math.random() < dt * 0.8) e.react('cold', 0.5);
    },
  });

  const blot: Step = {
    title: 'Blot',
    hint: 'Blot the pinpoint bleeding',
    cursor: 'gauze',
    move(p) {
      for (let i = dots.length - 1; i >= 0; i--)
        if (dots[i].position.distanceTo(p.p) < 40 * e.u) {
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

  const dress = bandageStep(e, () => center, () => size, bandage);

  const heal = healStep(
    e,
    3.5,
    (k, dt) => {
      e.fadeLayer('ink', dt * 0.9);
      e.fadeLayer('shade', dt * 0.9);
      e.fadeLayer('redness', dt * 0.8);
      e.fadeLayer('frost', dt);
      e.fadeLayer('gloss', dt * 0.6);
      if (bandage.o && k > 0.6) bandage.o.traverse((x) => { const m = (x as THREE.Mesh).material as THREE.Material | undefined; if (m) m.opacity = clamp01((1 - k) / 0.4); });
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
      if (bandage.o) e.detach(bandage.o);
      aim?.removeFromParent();
      for (const id of ['frost', 'gloss', 'wet'] as const) e.clearLayer(id);
    },
  };
}
