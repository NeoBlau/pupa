// Free-play simulation of the foot: wounds bleed until they clot, pus drains only when
// pressed around, dirt and blood stay until cleaned, wounds heal on their own when clean.
// Tools (tools.ts) act on this state; orders (orders.ts) only read it for their checklists.

import * as THREE from 'three';
import type { Engine } from '../engine.ts';
import { createTool } from '../tools3d.ts';
import { bead, clamp01, downhill, fizz, rand, setBeadSize, type Surf } from '../procedures/common.ts';

export type WoundKind = 'puncture' | 'cut' | 'abscess' | 'pinpoint';

export interface Trickle {
  path: THREE.Vector3[];
  dir: THREE.Vector3;
  tip: THREE.Mesh;
}

export interface Wound {
  id: number;
  kind: WoundKind;
  s: Surf;
  /** Flow rate when fully open (0..1). */
  bleed: number;
  /** 0 = open, 1 = sealed. Pressure and peroxide help; lifting a pad too early re-opens it. */
  clot: number;
  /** Blood pooled in a bead on the wound (0..1); above ~0.6 it starts running downhill. */
  pool: number;
  bead: THREE.Mesh | null;
  trickles: Trickle[];
  pus: number;
  pusHead: THREE.Mesh | null;
  ooze: THREE.Mesh | null;
  dirt: THREE.Mesh[];
  infection: number;
  disinfected: boolean;
  ointment: boolean;
  covered: boolean;
  heal: number;
  decal: THREE.Object3D | null;
  size: number;
  /** Seconds a pad has been pressed on it right now. */
  pressT: number;
}

export interface Needle {
  obj: THREE.Object3D;
  s: Surf;
  /** metres below the skin (negative = not through yet) */
  depth: number;
  through: boolean;
  /** pushed too hard → bleeds when pulled */
  bleedRisk: number;
  qi: number;
  insertedAt: number;
}

export interface Dressing {
  o: THREE.Object3D;
  s: Surf;
  r: number;
  kind: 'bandage' | 'film';
}

export class World {
  e: Engine;
  wounds: Wound[] = [];
  needles: Needle[] = [];
  dressings: Dressing[] = [];
  time = 0;
  /** Whole-foot flush (warm, pink pressure areas), 0..1. */
  flush = 0;
  /** Stats the orders read. */
  stats = { massage: 0, tickle: 0, peroxideOnWound: 0, alcohol: 0, pain: 0, inkLen: 0, inkOff: 0, shadeIn: 0, shadeOut: 0, laserPulses: 0 };
  tattoo: { path: THREE.Vector3[]; traced: boolean[]; revealed: boolean[]; inside: (p: THREE.Vector3) => boolean; c: Surf; size: number; design: string } | null = null;
  private nextId = 1;
  private redFadeT = 0;

  constructor(e: Engine) {
    this.e = e;
  }

  // ---------------------------------------------------------------------------
  // Wounds

  addWound(kind: WoundKind, s: Surf, o: Partial<Wound> = {}): Wound {
    const e = this.e;
    const w: Wound = {
      id: this.nextId++,
      kind,
      s,
      bleed: kind === 'cut' ? 0.5 : kind === 'puncture' ? 0.25 : kind === 'pinpoint' ? 0.08 : 0.1,
      clot: kind === 'abscess' ? 0.8 : 0,
      pool: 0,
      bead: null,
      trickles: [],
      pus: 0,
      pusHead: null,
      ooze: null,
      dirt: [],
      infection: 0,
      disinfected: false,
      ointment: false,
      covered: false,
      heal: 0,
      decal: null,
      size: kind === 'cut' || kind === 'abscess' ? 0.012 : kind === 'puncture' ? 0.002 : 0.001,
      pressT: 0,
      ...o,
    };
    if (kind === 'cut' || kind === 'abscess') {
      w.decal = e.decal(e.M.cutDecal.clone(), s.p, s.n, new THREE.Vector3(0.03, 0.015, 0.02), rand(-0.5, 0.5));
      for (let i = 0; i < 6; i++) e.stamp('redness', s.p.clone().add(new THREE.Vector3(rand(-1, 1) * 0.006, rand(-1, 1) * 0.006, 0)), rand(90, 140) * e.u, { alpha: 0.45 });
    }
    if (kind === 'abscess') {
      w.pus = 1;
      w.infection = 0.6;
      w.pusHead = bead(e, s, e.M.pus, 0.0032);
      e.stamp('pus', s.uv, 16 * e.u, { alpha: 0.75 });
    }
    this.wounds.push(w);
    return w;
  }

  addDirt(w: Wound, n: number) {
    const e = this.e;
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 });
    for (let i = 0; i < n; i++) {
      const s = e.surfaceAt(w.s.p.clone().add(new THREE.Vector3(rand(-1, 1) * 0.016, rand(-1, 1) * 0.013, 0)));
      if (!s) continue;
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.4, 0.9) * 0.001, 0), mat);
      m.scale.y = 0.4;
      w.dirt.push(e.attach(m, s.p, s.n));
    }
  }

  nearestWound(p: THREE.Vector3, r: number, filter: (w: Wound) => boolean = () => true) {
    let best: Wound | null = null;
    let bd = r;
    for (const w of this.wounds) {
      if (w.heal >= 1 || !filter(w)) continue;
      const d = w.s.p.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }

  /** Is p on blood (bead, trickle or stain)? */
  onBlood(p: THREE.Vector3, r: number) {
    return this.wounds.some((w) => (w.pool > 0.05 && w.s.p.distanceTo(p) < r) || w.trickles.some((t) => t.path.some((q) => q.distanceTo(p) < r)));
  }

  /** Pressure from a pad (cotton, gauze) at p with force 0..1. */
  padPress(p: THREE.Vector3, force: number, dt: number) {
    for (const w of this.wounds) {
      if (w.heal >= 1 || w.s.p.distanceTo(p) > w.size + 0.008) continue;
      w.pressT += dt;
      // Held pressure seals the wound; it also soaks up the pooled blood.
      w.clot = clamp01(w.clot + dt * force * (w.kind === 'cut' ? 0.12 : 0.35));
      w.pool = Math.max(0, w.pool - dt * force * 1.5);
    }
  }

  /** Pad lifted: wounds that were not held long enough open up again. */
  padLift() {
    for (const w of this.wounds) {
      if (w.pressT > 0 && w.clot < 0.7 && w.bleed > 0.05) {
        w.clot = Math.max(0, w.clot - 0.25);
        this.e.hooks.haptic('light');
      }
      w.pressT = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Needles

  findNeedle(p: THREE.Vector3, r: number) {
    return this.needles.filter((n) => n.s.p.distanceTo(p) < r).sort((a, b) => a.s.p.distanceTo(p) - b.s.p.distanceTo(p))[0] ?? null;
  }

  addNeedle(s: Surf): Needle {
    const obj = createTool('needle', this.e.M, this.e.T);
    this.e.attach(obj, s.p.clone().addScaledVector(s.n, 0.0005), s.n);
    obj.rotateY(rand(0, Math.PI * 2));
    const n: Needle = { obj, s, depth: -0.0005, through: false, bleedRisk: 0, qi: 0, insertedAt: this.time };
    this.needles.push(n);
    return n;
  }

  placeNeedle(n: Needle) {
    this.e.moveAttached(n.obj, n.s.p.clone().addScaledVector(n.s.n, -n.depth));
  }

  pullNeedle(n: Needle) {
    const e = this.e;
    this.needles = this.needles.filter((x) => x !== n);
    const from = n.obj.position.clone();
    e.tween(
      0.35,
      (k) => {
        e.moveAttached(n.obj, from.clone().addScaledVector(n.s.n, k * 0.05));
        n.obj.scale.setScalar(1 - k * 0.3);
      },
      () => e.detach(n.obj),
    );
    if (!n.through) return;
    e.impulse(n.s.p, 60 * e.u, -0.08);
    e.react('sting', 0.25);
    e.hooks.sfx('pop');
    // Deep or forced needles leave a bleeding puncture.
    if (Math.random() < 0.3 + n.bleedRisk) this.addWound('puncture', { ...n.s }, { bleed: 0.15 + 0.35 * n.bleedRisk + rand(0, 0.1) });
  }

  // ---------------------------------------------------------------------------
  // Dressings

  dress(kind: 'bandage' | 'film', s: Surf, r: number) {
    const e = this.e;
    const w = r * 2.4;
    const o =
      kind === 'bandage'
        ? e.decal(e.M.bandageDecal.clone(), s.p, s.n, new THREE.Vector3(w, w * 0.45, w), rand(-0.5, 0.5))
        : e.decal(e.M.film.clone(), s.p, s.n, new THREE.Vector3(w * 1.2, w * 1.2, w), 0);
    this.dressings.push({ o, s, r: w / 2, kind });
    e.impulse(s.p, r, 0.04);
    e.hooks.sfx('squish');
    e.hooks.haptic('medium');
    this.updateCovered();
  }

  removeDressing(p: THREE.Vector3) {
    const d = this.dressings.find((x) => x.s.p.distanceTo(p) < x.r);
    if (!d) return false;
    this.dressings = this.dressings.filter((x) => x !== d);
    this.e.detach(d.o);
    this.updateCovered();
    return true;
  }

  private updateCovered() {
    for (const w of this.wounds) w.covered = this.dressings.some((d) => d.s.p.distanceTo(w.s.p) < d.r * 0.8);
  }

  // ---------------------------------------------------------------------------

  update(dt: number) {
    const e = this.e;
    this.time += dt;
    this.flush = Math.max(0, this.flush - dt * 0.006);
    e.setFlush(this.flush);

    // Friction redness slowly fades (wounds keep re-stamping their own inflammation).
    this.redFadeT += dt;
    if (this.redFadeT > 0.5) {
      e.fadeLayer('redness', this.redFadeT * 0.006);
      e.fadeLayer('wet', this.redFadeT * 0.004);
      e.fadeLayer('foam', this.redFadeT * 0.02); // peroxide foam settles within ~30 s
      this.redFadeT = 0;
    }

    for (const n of this.needles) if (n.through) e.press(n.s.p, 22 * e.u, 0.0009);

    for (const w of this.wounds) {
      if (w.heal >= 1) continue;
      const open = w.bleed * (1 - w.clot) * (w.covered ? 0.1 : 1);
      // Natural clotting (slow for cuts, quick for pinpoints).
      w.clot = clamp01(w.clot + dt * (w.kind === 'pinpoint' ? 0.08 : w.kind === 'puncture' ? 0.025 : 0.006));

      // Blood pools on the wound, then runs downhill.
      if (open > 0.005) {
        w.pool = Math.min(1.2, w.pool + open * dt * 0.6);
        if (!w.bead && w.pool > 0.02) w.bead = bead(e, w.s, e.M.blood, 0.0005);
      }
      if (w.bead) {
        setBeadSize(w.bead, (0.5 + 2.6 * Math.min(1, w.pool)) * 0.001 * (w.kind === 'pinpoint' ? 0.5 : 1));
        w.bead.visible = w.pool > 0.02;
      }
      if (w.pool > 0.6 && !w.covered) {
        let t = w.trickles[w.trickles.length - 1];
        if (!t || t.path.length > 70) {
          t = { path: [w.s.p.clone()], dir: downhill(w.s.n), tip: bead(e, w.s, e.M.blood, 0.0011) };
          w.trickles.push(t);
          e.hooks.haptic('light');
        }
        const last = t.path[t.path.length - 1];
        // Slow sideways meander (skin creases), not per-frame jitter.
        const wander = Math.sin(t.path.length * 0.21 + w.id * 1.7) * 0.25;
        const dir = t.dir.clone().addScaledVector(new THREE.Vector3(1, 0, 0).projectOnPlane(t.dir).normalize(), wander).normalize();
        const s = e.surfaceAt(last.clone().addScaledVector(dir, dt * 0.012 * (0.5 + w.pool)));
        if (s) {
          t.dir = downhill(s.n);
          // Thick at the source, thinning as it runs.
          const width = (4.2 - Math.min(1.8, t.path.length * 0.03)) * e.u;
          e.paintLine('blood', last, s.p, width, { alpha: 0.7 }, 0.25);
          t.path.push(s.p);
          e.moveAttached(t.tip, s.p);
        }
        w.pool -= dt * 0.25;
      }

      // Abscess: bulges while full; infection keeps the area red.
      if (w.pus > 0) e.press(w.s.p, 45 * e.u, -0.0022 * w.pus);
      if (w.pusHead) setBeadSize(w.pusHead, 0.0012 + 0.002 * w.pus);
      const dirty = w.dirt.length > 0 || w.pus > 0.05 || (!w.disinfected && this.time > 30 && w.kind !== 'pinpoint');
      w.infection = clamp01(w.infection + dt * (dirty ? 0.004 : -0.01));
      if (w.infection > 0.05 && Math.random() < dt * 2) e.stamp('redness', w.s.uv, (60 + 80 * w.infection) * e.u, { alpha: 0.05 * w.infection });

      // Healing: only once it stopped bleeding and the area is clean.
      const stopped = w.clot > 0.9 || w.bleed * (1 - w.clot) < 0.01;
      const nearBlood = e.coverage('blood', e.cellsInSphere(w.s.p, 0.012), 0.25) > 0.05 || w.pool > 0.05;
      const clean = w.dirt.length === 0 && w.pus < 0.02 && !nearBlood && w.infection < 0.3;
      if (stopped && clean && (w.disinfected || w.kind === 'pinpoint')) {
        w.heal = clamp01(w.heal + dt * (w.covered ? 1 / 35 : 1 / 120) * (w.ointment ? 1.6 : 1));
        if (w.decal) w.decal.traverse((x) => { const m = (x as THREE.Mesh).material as THREE.Material | undefined; if (m) m.opacity = 1 - w.heal; });
        if (w.heal >= 1) this.healed(w);
      }
    }
  }

  private healed(w: Wound) {
    const e = this.e;
    if (w.decal) e.detach(w.decal);
    if (w.bead) e.detach(w.bead);
    if (w.pusHead) e.detach(w.pusHead);
    if (w.ooze) e.detach(w.ooze);
    for (const t of w.trickles) e.detach(t.tip);
    w.decal = w.bead = w.pusHead = w.ooze = null;
    e.floatText(w.s.p, 'Healed ✨', '#9dffc4', 24);
    e.hooks.sfx('heal');
  }

  /** Peroxide poured at p: fizzes on blood and wounds, helps clot, stings a little. */
  peroxide(p: Surf, dt: number) {
    const e = this.e;
    let hit = false;
    for (const w of this.wounds) {
      if (w.heal >= 1) continue;
      const near = w.s.p.distanceTo(p.p) < w.size + 0.01 || w.trickles.some((t) => t.path.some((q) => q.distanceTo(p.p) < 0.006));
      if (!near) continue;
      hit = true;
      w.clot = clamp01(w.clot + dt * 0.25);
      w.disinfected = true;
      w.infection = Math.max(0, w.infection - dt * 0.05);
      this.stats.peroxideOnWound += dt;
      fizz(e, p, 0.004, w.pool > 0.05 || w.trickles.length ? 0xffc9d2 : 0xffffff);
      if (Math.random() < dt * 1.5) e.react('sting', 0.3);
    }
    if (hit || this.onBlood(p.p, 0.008)) e.stamp('foam', p.uv, 16 * e.u, { tex: 'foam', alpha: 0.2 });
    else if (Math.random() < 0.4) fizz(e, p, 0.002);
  }

  /** Disinfect wounds under an alcohol swab / antiseptic. */
  disinfect(p: THREE.Vector3, dt: number) {
    for (const w of this.wounds) if (w.s.p.distanceTo(p) < w.size + 0.012) {
      w.disinfected = true;
      w.infection = Math.max(0, w.infection - dt * 0.03);
      if (w.kind !== 'pinpoint' && w.clot < 0.9 && Math.random() < dt) this.e.react('sting', 0.4);
    }
    this.stats.alcohol += dt;
  }

  /** Wiping with a pad: removes blood (easy when wet or after peroxide), pus, dirt. */
  wipe(p: Surf, delta: THREE.Vector3, force: number, r: number) {
    const e = this.e;
    const wet = Math.max(e.amountAt('wet', p.uv), e.amountAt('foam', p.uv));
    e.stamp('blood', p.uv, r, { erase: true, alpha: (0.07 + 0.5 * wet) * (0.4 + force) });
    e.stamp('pus', p.uv, r, { erase: true, alpha: 0.25 * (0.4 + force) });
    e.stamp('foam', p.uv, r, { erase: true, alpha: 0.4 * (0.4 + force) });
    for (const w of this.wounds) {
      if (w.pool > 0 && w.s.p.distanceTo(p.p) < r + w.size) {
        w.pool = Math.max(0, w.pool - delta.length() / (160 * e.u));
        if (Math.random() < 0.3) e.stamp('blood', p.uv, 16 * e.u, { alpha: 0.1 });
      }
      for (const t of w.trickles) if (wet > 0.2 && t.path.some((q) => q.distanceTo(p.p) < r)) t.tip.visible = false;
      if (w.ooze && w.s.p.distanceTo(p.p) < r + 0.004) {
        e.detach(w.ooze);
        w.ooze = null;
      }
      if (w.pusHead && w.pus < 0.1 && w.s.p.distanceTo(p.p) < r) w.pusHead.visible = false;
      // Wiping a fresh open wound hurts a bit and breaks the clot.
      // Proportional to how far the pad slid, so a steady hold (with finger jitter) doesn't count.
      const slide = delta.length();
      if (w.kind !== 'pinpoint' && w.clot < 0.6 && w.s.p.distanceTo(p.p) < w.size && force > 0.6 && slide > 0.0008) {
        w.clot = Math.max(0, w.clot - slide * 6);
        if (Math.random() < 0.05) e.react('sting', 0.3);
      }
    }
  }

  /** Pressing around an abscess drains it; pressing on it hurts. Returns the reaction. */
  pressAt(p: Surf, force: number, dt: number) {
    const e = this.e;
    for (const w of this.wounds) {
      if (w.pus <= 0 || w.heal >= 1) continue;
      const d = p.p.distanceTo(w.s.p);
      if (d < w.size * 0.45 && force > 0.15) {
        if (Math.random() < dt * 6) {
          this.pain(w.s, 0.6 + force * 0.4);
          e.floatText(w.s.p, 'Ouch! Not on it', '#ff7b7b', 20);
        }
        continue;
      }
      if (d > w.size * 2.6) continue;
      e.force(p.p, 80 * e.u, w.s.p.clone().sub(p.p).normalize().multiplyScalar(0.0015 * force));
      w.pus = Math.max(0, w.pus - dt * 0.25 * force);
      const tint = w.pus < 0.25;
      if (Math.random() < dt * 8) {
        const a = rand(0, Math.PI * 2);
        const rr = rand(0, 1) * (1 - w.pus) * 0.006;
        const at = w.s.p.clone().add(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, 0)).addScaledVector(downhill(w.s.n), (1 - w.pus) * 0.004);
        e.stamp(tint ? 'blood' : 'pus', at, rand(10, 18) * e.u, { alpha: tint ? 0.25 : 0.55 });
        if (!w.ooze) w.ooze = bead(e, w.s, e.M.pus, 0.001);
        setBeadSize(w.ooze, (1 + (1 - w.pus) * 4) * 0.001);
        e.hooks.sfx('squish');
      }
      if (Math.random() < dt * 1.5) e.react('sting', 0.2 + force * 0.3);
      e.work(dt * 10);
    }
  }

  pain(s: Surf, k: number) {
    const e = this.e;
    this.stats.pain += k;
    this.flush = clamp01(this.flush + 0.05 * k);
    e.react('pain', k);
    e.kick(s.p, 200 * e.u, 0.15 * k);
    e.shake(8 * k);
    e.hooks.sfx('ouch');
    e.hooks.haptic('error');
  }

  dispose() {
    const e = this.e;
    for (const w of this.wounds) {
      for (const o of [w.decal, w.bead, w.pusHead, w.ooze, ...w.dirt, ...w.trickles.map((t) => t.tip)]) if (o) e.detach(o);
    }
    for (const n of this.needles) e.detach(n.obj);
    for (const d of this.dressings) e.detach(d.o);
    this.wounds = [];
    this.needles = [];
    this.dressings = [];
  }
}
