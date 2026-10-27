import * as THREE from 'three';
import { ease, type Engine, type Procedure, type Step } from '../engine.ts';
import { createTool } from '../tools3d.ts';
import { bead, clamp01, downhill, fizz, marker, rand, rubStep, setBeadSize, type ProcCtx, type Surf } from './common.ts';

interface Point extends Surf {
  marker: ReturnType<typeof marker>;
  phaseOff: number;
  needle: THREE.Object3D | null;
  inserted: boolean;
  quality: number;
  qi: number;
  removed: boolean;
  bleed: boolean;
}

interface Drop extends Surf {
  vol: number;
  grow: number;
  age: number;
  m: THREE.Mesh;
  trickle: { path: THREE.Vector3[]; tip: THREE.Mesh | null; treated: boolean; dir: THREE.Vector3 } | null;
  treatedUntil: number;
}

const PULSE = 1.1;
const DEPTH = 0.007; // needle depth in the skin

export function acupunctureProcedure(e: Engine, ctx: ProcCtx): Procedure {
  const pts: Point[] = [];
  const drops: Drop[] = [];
  let time = 0;
  let lines: THREE.LineSegments | null = null;
  let bled = 0;
  let trickles = 0;

  const surfs: Surf[] = ctx.model.acupoints?.length
    ? ctx.model.acupoints.map(([x, y, z]) => e.surfaceAt(new THREE.Vector3(x, y, z))!).filter(Boolean)
    : [];
  while (surfs.length < 6) surfs.push(e.randomSolePoint(surfs.map((s) => s.p), 120 * e.u, 0.03, 0.2));
  for (const s of surfs) pts.push({ ...s, marker: marker(e, s, 0x7cf7ff), phaseOff: Math.random(), needle: null, inserted: false, quality: 0, qi: 0, removed: false, bleed: false });
  e.debug.points = pts;
  // Skin stays slightly dimpled around every needle that is in.
  const holdDimples = () => {
    for (const p of pts) if (p.inserted && !p.removed) e.press(p.p, 22 * e.u, 0.0009);
  };
  const phase = (p: Point) => (((time / PULSE + p.phaseOff) % 1) + 1) % 1;
  const needleAt = (p: Point, lift: number) => p.p.clone().addScaledVector(p.n, lift - DEPTH);

  // 1. Disinfect ---------------------------------------------------------------
  const pointCells = () => pts.flatMap((p) => e.cellsInSphere(p.p, 34 * e.u));
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

  // 2. Insert ------------------------------------------------------------------
  const insert: Step = {
    title: 'Insert',
    hint: 'Tap a point when its ring closes in',
    cursor: 'needle',
    update(dt) {
      time += dt;
      for (const p of pts) if (!p.inserted) p.marker.draw(phase(p), 1);
      holdDimples();
    },
    down(ptr) {
      const p = pts.filter((q) => !q.inserted).sort((a, b) => a.p.distanceTo(ptr.p) - b.p.distanceTo(ptr.p))[0];
      if (!p || p.p.distanceTo(ptr.p) > 60 * e.u) return;
      const ph = phase(p);
      const quality = clamp01(1 - Math.abs(ph - 0.92) / 0.45);
      p.inserted = true;
      p.quality = quality;
      p.marker.g.visible = false;
      const n = createTool('needle', e.M, e.T);
      p.needle = e.attach(n, needleAt(p, 0.03), p.n);
      n.rotateY(rand(0, Math.PI * 2));
      e.tween(
        0.32,
        (k) => {
          e.moveAttached(n, needleAt(p, 0.03 * (1 - ease.back(k))));
          e.press(p.p, 30 * e.u, 0.0015 * k);
        },
        () => {
          e.ripple(p.p, 0x7cf7ff, 0.008);
          e.impulse(p.p, 35 * e.u, 0.06);
          e.hooks.sfx('needle');
          e.react(quality < 0.35 ? 'pain' : 'sting', quality < 0.35 ? 1 : 0.3);
          e.hooks.haptic('medium');
          e.work(4 + quality * 6);
          if (quality > 0.75) e.floatText(p.p, 'Perfect', '#7cf7ff');
          else if (quality < 0.35) {
            p.bleed = true;
            e.kick(p.p, 220 * e.u, 0.15);
            e.shake(8);
            e.floatText(p.p, 'Ouch!', '#ff7b7b', 26);
            e.hooks.sfx('ouch');
            e.hooks.haptic('error');
          }
        },
      );
    },
    progress: () => pts.filter((p) => p.inserted).length / pts.length,
  };

  // 3. Stimulate ---------------------------------------------------------------
  const twirl: Step = {
    title: 'Stimulate',
    hint: 'Circle around each needle to twirl it',
    cursor: null,
    enter() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.length * 6), 3));
      lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x7cf7ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      e.root.add(lines);
    },
    exit() {
      lines?.removeFromParent();
      lines?.geometry.dispose();
      lines = null;
    },
    update(dt) {
      time += dt;
      for (const p of pts) {
        const near = e.ptr.down && e.ptr.hit && e.ptr.p.distanceTo(p.p) < 110 * e.u && e.ptr.speed > 150 * e.u;
        if (near && p.qi < 1) {
          p.qi = Math.min(1, p.qi + dt * 0.9);
          e.work(dt * 8);
          if (Math.random() < 0.3) e.particle('sparkle', p.p.clone().addScaledVector(p.n, rand(0.005, 0.05)), rand(2, 4) * 0.001, { add: true, v: p.n.clone().multiplyScalar(0.02), max: 0.6, tint: 0x9ffcff });
        }
        if (near) p.needle?.rotateY(dt * 14);
      }
      holdDimples();
      if (lines) {
        const a = (lines.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
        a.fill(0);
        const active = pts.filter((p) => p.qi > 0.2);
        for (let i = 1; i < active.length; i++) {
          const pa = active[i - 1].p.clone().addScaledVector(active[i - 1].n, 0.001);
          const pb = active[i].p.clone().addScaledVector(active[i].n, 0.001);
          a.set([pa.x, pa.y, pa.z, pb.x, pb.y, pb.z], (i - 1) * 6);
        }
        lines.geometry.attributes.position.needsUpdate = true;
        (lines.material as THREE.LineBasicMaterial).opacity = 0.35 + Math.sin(time * 6) * 0.25;
      }
    },
    progress: () => pts.reduce((s, p) => s + p.qi, 0) / pts.length,
  };

  // 4. Remove -------------------------------------------------------------------
  let grabbed: Point | null = null;
  const grabFrom = new THREE.Vector3();
  const addDrop = (p: Point) => {
    const m = bead(e, p, e.M.blood, 0.0005);
    drops.push({ p: p.p.clone(), n: p.n.clone(), uv: p.uv.clone(), vol: 0, grow: rand(0.6, 1), age: 0, m, trickle: null, treatedUntil: 0 });
    bled++;
  };
  const remove: Step = {
    title: 'Remove',
    hint: 'Grab a needle and drag it out',
    cursor: null,
    down(ptr) {
      grabbed = pts.filter((p) => !p.removed && p.p.distanceTo(ptr.p) < 120 * e.u).sort((a, b) => a.p.distanceTo(ptr.p) - b.p.distanceTo(ptr.p))[0] ?? null;
      grabFrom.copy(ptr.p);
    },
    move(ptr) {
      const p = grabbed;
      if (!p || !p.needle) return;
      const pull = ptr.p.distanceTo(grabFrom);
      // Skin tents outward with the needle before letting go.
      e.force(p.p, 45 * e.u, p.n.clone().multiplyScalar(Math.min(pull, 70 * e.u) * 0.45));
      e.moveAttached(p.needle, needleAt(p, Math.min(pull, 60 * e.u) * 0.6));
      if (pull > 110 * e.u) {
        p.removed = true;
        grabbed = null;
        const n = p.needle;
        p.needle = null;
        const from = needleAt(p, DEPTH);
        e.tween(
          0.35,
          (k) => {
            e.moveAttached(n, from.clone().addScaledVector(p.n, k * 0.05));
            n.scale.setScalar(1 - k * 0.3);
          },
          () => e.detach(n),
        );
        e.impulse(p.p, 60 * e.u, -0.08);
        e.hooks.sfx('pop');
        e.react('sting', 0.25);
        e.hooks.haptic('light');
        e.work(5);
        const last = pts.every((q) => q.removed);
        if (p.bleed || Math.random() < 0.4 || (last && bled === 0)) addDrop(p);
      }
    },
    up() {
      if (grabbed?.needle) e.moveAttached(grabbed.needle, needleAt(grabbed, 0));
      grabbed = null;
    },
    update(dt) {
      updateDrops(dt);
      holdDimples();
    },
    progress: () => pts.filter((p) => p.removed).length / pts.length,
  };

  // 5. Aftercare ------------------------------------------------------------------
  let maxStain = 0.01;
  const stainCells = () => pts.flatMap((p) => e.cellsInSphere(p.p.clone().addScaledVector(downhill(p.n), 0.012), 110 * e.u));
  function updateDrops(dt: number) {
    for (const d of drops) {
      if (d.vol <= 0 && d.age > 0.5) continue;
      d.age += dt;
      if (d.vol < d.grow && d.age < 1.4) d.vol = Math.min(d.grow, d.vol + dt * 0.8);
      setBeadSize(d.m, (0.6 + 2.4 * d.vol) * 0.001);
      // Left alone, a big drop starts running down the skin.
      if (!d.trickle && d.age > 3.5 && d.vol > 0.45) {
        d.trickle = { path: [d.p.clone()], tip: null, treated: false, dir: downhill(d.n) };
        trickles++;
        e.hooks.haptic('error');
      }
      const t = d.trickle;
      if (t && t.path.length < 60 && d.vol > 0.2) {
        const last = t.path[t.path.length - 1];
        const s = e.surfaceAt(last.clone().addScaledVector(t.dir, 0.0006).add(new THREE.Vector3(Math.sin(t.path.length * 0.7) * 0.0002, 0, 0)));
        if (s) {
          t.dir = downhill(s.n);
          e.paintLine('blood', last, s.p, 5 * e.u, { alpha: 0.95, tex: 'hard' }, 0.5);
          t.path.push(s.p);
          if (!t.tip) t.tip = bead(e, s, e.M.blood, 0.0012);
          e.moveAttached(t.tip, s.p);
        }
      }
    }
    maxStain = Math.max(maxStain, e.coverage('blood', stainCells(), 0.25));
  }

  const nearDrop = (d: Drop, p: THREE.Vector3, r: number) => d.p.distanceTo(p) < r || !!d.trickle?.path.some((q) => q.distanceTo(p) < r * 0.8);
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
      e.press(ptr.p, 60 * e.u, 0.0012);
      for (const d of drops) {
        if (!nearDrop(d, ptr.p, 45 * e.u) || d.vol <= 0) continue;
        d.vol = Math.max(0, d.vol - ptr.delta.length() / (160 * e.u));
        if (Math.random() < 0.4) e.stamp('blood', ptr.uv, 16 * e.u, { alpha: 0.12 });
        if (d.vol <= 0) {
          d.m.visible = false;
          e.work(4);
        }
      }
      // Dried runs barely come off unless treated with peroxide first.
      const treated = drops.some((d) => d.treatedUntil > time && nearDrop(d, ptr.p, 200 * e.u));
      e.stamp('blood', ptr.uv, 34 * e.u, { erase: true, alpha: treated ? 0.55 : 0.07 });
      for (const d of drops) if (d.trickle?.tip && d.vol <= 0 && treated) d.trickle.tip.visible = false;
    },
    update(dt) {
      time += dt;
      updateDrops(dt);
      if (this.tool === 'peroxide' && e.ptr.down && e.ptr.hit) {
        e.toolPose.lift = 0.015;
        e.hooks.haptic('tick');
        for (const d of drops) {
          if (!nearDrop(d, e.ptr.p, 60 * e.u)) continue;
          d.treatedUntil = time + 6;
          if (d.trickle) d.trickle.treated = true;
          // Peroxide foams pink on blood.
          fizz(e, e.ptr, 0.004, 0xffc9d2);
          if (Math.random() < 0.08) e.react('sting', 0.3);
          e.stamp('foam', e.ptr.uv, 14 * e.u, { tex: 'foam', alpha: 0.25 });
          e.work(dt * 6);
        }
        if (Math.random() < 0.5) fizz(e, e.ptr, 0.003);
      } else e.toolPose.lift = 0;
      e.fadeLayer('foam', dt * 0.15);
    },
    progress() {
      const live = drops.filter((d) => d.vol > 0).length;
      const dropsDone = drops.length ? 1 - live / drops.length : 1;
      const stain = e.coverage('blood', stainCells(), 0.25);
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
        e.detach(p.marker.g);
        if (p.needle) e.detach(p.needle);
      }
      for (const d of drops) {
        e.detach(d.m);
        if (d.trickle?.tip) e.detach(d.trickle.tip);
      }
      lines?.removeFromParent();
      for (const id of ['blood', 'foam', 'wet'] as const) e.clearLayer(id);
    },
  };
}
