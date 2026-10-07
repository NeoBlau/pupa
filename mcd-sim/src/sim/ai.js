// Другие поезда линии: попутные и встречные по расписанию. Вдали — «виртуальные» (положение по графику,
// занимают блок-участки), вблизи игрока — полноценная физика TrainSim с автоведением и 3D-моделью.
import { TrainSim } from './train.js';
import { virtualPosition } from './timetable.js';
import { TrainModel } from '../train/trainModel.js';

class AIDriver {
  constructor(route, signals, sim, run) {
    this.route = route; this.signals = signals; this.sim = sim; this.run = run;
    this.k = 0; this.state = 'run'; this.dwellUntil = 0;
  }

  update(dt, time) {
    const sim = this.sim, r = this.route;
    const dir = sim.dir;
    const stops = this.run.stops;
    while (this.k < stops.length && (stops[this.k].station.s + dir * sim.length / 2 - sim.s) * dir < -30) this.k++;
    const stop = stops[this.k];
    if (!stop) { this.done = true; return; }
    const sStop = stop.station.s + dir * (sim.length / 2);
    const dStop = (sStop - sim.s) * dir;
    if (this.state === 'dwell') {
      sim.setLever(-0.5);
      if (time > stop.dep - 12 && !sim.doorsClosed) sim.closeDoors();
      if (time >= stop.dep && sim.doorsClosed && sim.doors.left === 0 && sim.doors.right === 0) {
        const sig = this.signals.nextSignal(sim.s, dir, 0);
        if (!sig || sig.aspect !== 'red' || (sig.s - sim.s) * dir > 300) { this.state = 'run'; this.k++; }
      }
      return;
    }
    let vT = Math.min(r.limitRange(sim.s, sim.rearS), sim.spec.maxSpeed) - 3;
    const drop = r.nextLimitDrop(sim.s, dir, vT + 3, 2500);
    if (drop) vT = Math.min(vT, Math.sqrt((drop.v / 3.6) ** 2 + 2 * 0.45 * Math.max(0, drop.dist - 30)) * 3.6);
    const sig = this.signals.nextSignal(sim.s, dir, 0);
    if (sig && sig.aspect === 'red') { const d = (sig.s - sim.s) * dir - 25; vT = Math.min(vT, Math.sqrt(2 * 0.5 * Math.max(0, d)) * 3.6); }
    if (sig && sig.aspect === 'yellow') vT = Math.min(vT, 60);
    vT = Math.min(vT, Math.sqrt(2 * 0.55 * Math.max(0, dStop)) * 3.6 + (dStop > 3 ? 1.5 : 0));
    const v = sim.speedKmh;
    sim.reverser = 1;
    if (dStop < 1.5 && v < 0.5) {
      this.state = 'dwell';
      sim.setLever(-0.6);
      const st = stop.station;
      // двери — со стороны платформы: островная — слева по ходу, боковая — справа (правостороннее движение)
      sim.openDoors(st.island ? 'left' : 'right');
      if (this.k === stops.length - 1) this.done = true;
      return;
    }
    const err = vT - v;
    let lever = err > 2 ? Math.min(1, err * 0.08) : err < -1 ? Math.max(-1, err * 0.12) : 0;
    if (vT < 1 && v < 3) lever = -0.6;
    sim.setLever(lever);
  }
}

export class Traffic {
  constructor(scene, route, signals, allRuns, playerRunId, trainSpecFor) {
    this.scene = scene; this.route = route; this.signals = signals;
    this.runs = allRuns.filter((r) => r.id !== playerRunId);
    this.active = new Map(); // id → {sim, model, driver}
    this.trainSpecFor = trainSpecFor;
    this.building = new Set();
  }

  // Занятость блок-участков: реальные AI + виртуальные попутные
  occupants(time, playerS) {
    const occ = [];
    for (const run of this.runs) {
      const a = this.active.get(run.id);
      if (a) { occ.push({ dir: a.sim.dir, front: a.sim.s, rear: a.sim.rearS }); continue; }
      const vp = virtualPosition(this.route, run, time);
      if (vp.before || vp.after) continue;
      if (Math.abs(vp.s - playerS) > 20000) continue;
      occ.push({ dir: run.dir, front: vp.s + run.dir * 60, rear: vp.s - run.dir * 200 });
    }
    return occ;
  }

  async update(dt, time, playerS, camPos) {
    // спавн
    for (const run of this.runs) {
      if (this.active.has(run.id) || this.building.has(run.id)) continue;
      const vp = virtualPosition(this.route, run, time);
      if (vp.before || vp.after) continue;
      const d = Math.abs(vp.s - playerS);
      if (d < 3500 && d > 400) this.spawn(run, vp, time);
    }
    for (const [id, a] of this.active) {
      a.driver.update(dt, time);
      const grade = this.route.grade(a.sim.s);
      for (let k = 0; k < 2; k++) a.sim.update(dt / 2, grade, this.route.curveRadius(a.sim.s));
      a.model.updatePose(this.route, a.sim.s, a.sim.dir, a.sim.dir, dt, a.sim.v);
      a.model.setDoors(a.sim.doors.left, a.sim.doors.right);
      const far = Math.abs(a.sim.s - playerS) > 5000;
      if (far || a.driver.done && a.sim.speedKmh < 0.1 && time > a.run.stops[a.run.stops.length - 1].arr + 60) {
        a.model.group.removeFromParent();
        this.active.delete(id);
      }
    }
  }

  async spawn(run, vp, time) {
    this.building.add(run.id);
    const spec = this.trainSpecFor(run);
    const cars = spec.defaultCars;
    const sim = new TrainSim(spec, cars, { s: vp.s + run.dir * spec.carLength * cars / 2, dir: run.dir });
    sim.reverser = 1;
    sim.v = Math.min(vp.v || 0, 25);
    const model = new TrainModel(spec, cars);
    await model.build();
    model.setLights({ head: true, night: 0 });
    this.scene.add(model.group);
    const driver = new AIDriver(this.route, this.signals, sim, run);
    this.active.set(run.id, { sim, model, driver, run });
    this.building.delete(run.id);
  }

  nearestOpposite(s, dir) {
    let best = Infinity;
    for (const a of this.active.values()) if (a.sim.dir !== dir) best = Math.min(best, Math.abs(a.sim.s - s));
    return best;
  }

  clear() { for (const a of this.active.values()) a.model.group.removeFromParent(); this.active.clear(); }
}
