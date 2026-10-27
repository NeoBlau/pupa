import * as THREE from 'three';
import type { Engine, Procedure, Step } from '../engine.ts';
import { bandageStep, bead, clamp01, downhill, fizz, healStep, rand, rubStep, setBeadSize, spray, tweenTo, type Surf } from './common.ts';

/**
 * Infected cut: rinse dirt, drain pus by pressing AROUND the wound, blot,
 * peroxide, ointment, dressing, then a healing time-lapse.
 * (In-game disclaimer: real abscesses must be drained by a doctor.)
 */
export function woundProcedure(e: Engine): Procedure {
  const w: Surf = e.randomSolePoint([], 0, 0.04, 0.15);
  const R = 70 * e.u;
  const region = () => e.cellsInSphere(w.p, R * 2.2);
  const rot = rand(-0.5, 0.5);
  let penalty = 0;
  e.debug.wound = w;

  // Setup: inflamed halo, swollen abscess with a yellow head, the cut, dirt.
  for (let i = 0; i < 6; i++) e.stamp('redness', w.p.clone().add(new THREE.Vector3(rand(-1, 1) * 0.006, rand(-1, 1) * 0.006, 0)), rand(90, 140) * e.u, { alpha: 0.5 });
  e.stamp('redness', w.uv, 70 * e.u, { alpha: 0.9 });
  e.stamp('pus', w.uv, 16 * e.u, { alpha: 0.75 });
  const cut = e.decal(e.M.cutDecal.clone(), w.p, w.n, new THREE.Vector3(0.03, 0.015, 0.02), rot);
  const head = bead(e, w, e.M.pus, 0.0032);
  const specks: THREE.Mesh[] = [];
  const dirt = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 });
  for (let i = 0; i < 9; i++) {
    const s = e.surfaceAt(w.p.clone().add(new THREE.Vector3(rand(-1, 1) * 0.016, rand(-1, 1) * 0.013, 0)));
    if (!s) continue;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.4, 0.9) * 0.001, 0), dirt);
    m.scale.y = 0.4;
    specks.push(e.attach(m, s.p, s.n));
  }
  const specksTotal = Math.max(1, specks.length);

  // 1. Rinse ---------------------------------------------------------------------
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
      e.toolPose.lift = 0.02;
      if (!e.ptr.down || !e.ptr.hit) return;
      spray(e, e.ptr, 0.003);
      e.stamp('wet', e.ptr.uv, 50 * e.u, { alpha: 0.2 });
      for (let i = specks.length - 1; i >= 0; i--) {
        const s = specks[i];
        if (s.position.distanceTo(e.ptr.p) > 45 * e.u) continue;
        specks.splice(i, 1);
        tweenTo(e, s, s.position.clone().addScaledVector(downhill(w.n), 0.02), 0.6, () => e.detach(s));
        e.work(2);
      }
    },
    progress: () => 1 - specks.length / specksTotal,
  };

  // 2. Drain -----------------------------------------------------------------------
  let pus = 1;
  let ouchCd = 0;
  let ooze: THREE.Mesh | null = null;
  let oozeT = 0;
  const drain: Step = {
    title: 'Drain',
    hint: 'Press gently AROUND the wound, not on it',
    cursor: 'gauze',
    update(dt) {
      ouchCd -= dt;
      // The abscess bulges while it is full.
      e.press(w.p, 45 * e.u, -0.0022 * pus);
      setBeadSize(head, (0.0012 + 0.002 * pus));
      if (!e.ptr.down || !e.ptr.hit || pus <= 0) return;
      const d = e.ptr.p.distanceTo(w.p);
      if (d < R * 0.45) {
        if (ouchCd <= 0) {
          ouchCd = 0.9;
          penalty++;
          e.kick(w.p, 200 * e.u, 0.15);
          e.shake(10);
          e.floatText(w.p, 'Ouch! Not on it', '#ff7b7b', 22);
          e.hooks.sfx('ouch');
          e.hooks.haptic('error');
        }
        return;
      }
      if (d > R * 2.4) return;
      // Pressing: dent under the finger, tissue pushed toward the wound.
      e.press(e.ptr.p, 70 * e.u, 0.0025);
      e.force(e.ptr.p, 80 * e.u, w.p.clone().sub(e.ptr.p).normalize().multiplyScalar(0.0015));
      pus = Math.max(0, pus - dt * 0.22);
      e.work(dt * 10);
      oozeT += dt;
      if (oozeT > 0.12) {
        oozeT = 0;
        // Late in drainage it turns blood-tinged — that's when to stop.
        const a = rand(0, Math.PI * 2);
        const r = rand(0, 1) * (1 - pus) * 0.006;
        const at = w.p.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0)).addScaledVector(downhill(w.n), (1 - pus) * 0.004);
        e.stamp(pus < 0.25 ? 'blood' : 'pus', at, rand(10, 18) * e.u, { alpha: pus < 0.25 ? 0.25 : 0.55 });
        if (!ooze) ooze = bead(e, w, e.M.pus, 0.001);
        setBeadSize(ooze, (1 + (1 - pus) * 4) * 0.001);
        if (Math.random() < 0.25) {
          e.hooks.sfx('squish');
          e.hooks.haptic('tick');
        }
      }
    },
    progress: () => 1 - pus,
  };

  // 3. Blot ---------------------------------------------------------------------------
  const blot = rubStep(e, {
    title: 'Blot',
    hint: 'Blot away all the discharge',
    cursor: 'gauze',
    layer: 'pus',
    mode: 'erase',
    radius: 45,
    alpha: 0.3,
    target: 0.03,
    alsoErase: [['blood', 0.3]],
    region,
    onMove(p) {
      e.press(p.p, 50 * e.u, 0.0008);
      if (ooze && p.p.distanceTo(w.p) < 50 * e.u) {
        e.detach(ooze);
        ooze = null;
      }
      if (head.visible && p.p.distanceTo(w.p) < 40 * e.u) head.visible = false;
    },
  });

  // 4. Peroxide ---------------------------------------------------------------------
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
      e.toolPose.lift = 0.015;
      if (!e.ptr.down || !e.ptr.hit || e.ptr.p.distanceTo(w.p) > R * 1.3) return;
      fizzT += dt;
      e.work(dt * 6);
      fizz(e, w, 0.008, Math.random() < 0.4 ? 0xffd9e0 : 0xffffff);
      if (Math.random() < 0.5) e.stamp('foam', w.p.clone().add(new THREE.Vector3(rand(-1, 1) * 0.006, rand(-1, 1) * 0.005, 0)), rand(14, 26) * e.u, { tex: 'foam', alpha: 0.7 });
      e.hooks.haptic('tick');
    },
    progress: () => clamp01(fizzT / 3),
  };

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

  const ointment = rubStep(e, {
    title: 'Ointment',
    hint: 'Antibiotic ointment over the wound',
    cursor: 'tube',
    layer: 'gloss',
    mode: 'paint',
    radius: 40,
    alpha: 0.5,
    target: 0.8,
    region: () => e.cellsInSphere(w.p, R * 1.2),
  });

  const bandage = { o: null as THREE.Object3D | null };
  const dress = bandageStep(e, () => w, () => R * 0.9, bandage);
  const cutMesh = cut.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  const heal = healStep(e, 4, (k, dt) => {
    e.fadeLayer('redness', dt * 0.9);
    e.fadeLayer('gloss', dt * 0.5);
    e.fadeLayer('pus', dt);
    cutMesh.material.opacity = 1 - k;
    if (bandage.o && k > 0.55)
      bandage.o.traverse((x) => {
        const m = (x as THREE.Mesh).material as THREE.Material | undefined;
        if (m) m.opacity = clamp01((1 - k) / 0.45);
      });
  });

  return {
    id: 'wound',
    steps: [rinse, drain, blot, peroxide, blotFoam, ointment, dress, heal],
    accuracy: () => clamp01(1 - penalty * 0.15),
    dispose() {
      for (const s of specks) e.detach(s);
      if (ooze) e.detach(ooze);
      if (bandage.o) e.detach(bandage.o);
      e.detach(cut);
      e.detach(head);
      for (const id of ['blood', 'pus', 'foam', 'gloss', 'wet'] as const) e.clearLayer(id);
      e.fadeLayer('redness', 1);
    },
  };
}
