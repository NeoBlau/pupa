// Игровая сессия: связывает симуляцию, мир, поезд, кабину, камеры, звук, расписание и оценку.
import * as THREE from 'three';
import { input } from './core/input.js';
import { settings } from './core/settings.js';
import { assets } from './core/assets.js';
import { Route } from './sim/route.js';
import { TrainSim } from './sim/train.js';
import { SignalSystem } from './sim/signals.js';
import { Safety } from './sim/safety.js';
import { Score } from './sim/scoring.js';
import { generateRuns, fmtTime } from './sim/timetable.js';
import { Traffic } from './sim/ai.js';
import { World } from './world/world.js';
import { platformsOf, loadStationProps } from './world/station.js';
import { loadScenery } from './world/scenery.js';
import { loadPeople, Crowd } from './world/people.js';
import { loadSignalModel } from './core/realModels.js';
import { TrainModel } from './train/trainModel.js';
import { Cab } from './train/cab.js';
import { CameraRig } from './player/cameras.js';
import { audio } from './audio/audio.js';
import { TRAINS, consistLength } from './data/trains.js';
import LINES from './data/lines.json';

let commonLoaded = null;
export function loadCommon(renderer, progress) {
  if (!commonLoaded) {
    commonLoaded = (async () => {
      progress?.('Светофоры и дома (Sketchfab)…', 0.05);
      await loadSignalModel();
      progress?.('Модели окружения (Poly Haven, Sketchfab)…', 0.1);
      await loadScenery(renderer);
      progress?.('Реквизит станций…', 0.4);
      await loadStationProps();
      progress?.('Пассажиры…', 0.6);
      await loadPeople();
    })();
  }
  return commonLoaded;
}

export function getRoute(lineId) {
  const cache = getRoute.cache || (getRoute.cache = new Map());
  if (!cache.has(lineId)) cache.set(lineId, new Route(LINES.lines[lineId]));
  return cache.get(lineId);
}

export class Game {
  // cfg: {mode:'schedule'|'free', line, train, cars, run?, fromIdx, toIdx, dir, startIdx, time, weather, season}
  constructor(renderer, scene, camera, env, cfg, ui) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.env = env; this.cfg = cfg; this.ui = ui;
    this.audio = audio;
    this.line = LINES.lines[cfg.line];
    this.route = getRoute(cfg.line);
    this.spec = TRAINS[cfg.train];
    this.timeScale = 1;
    this.paused = false;
    this.prompt = '';
    this.messages = [];
    this.finished = false;
    this.trackPos = 1;
  }

  async init(progress) {
    const cfg = this.cfg, route = this.route, spec = this.spec;
    await loadCommon(this.renderer, progress);
    this.env.setWeather(cfg.weather); this.env.setSeason(cfg.season);
    // расписание
    progress?.('Расписание…', 0.65);
    this.runs = { 1: generateRuns(route, spec, 1), [-1]: generateRuns(route, spec, -1) };
    let dir, startStation, startTime;
    if (cfg.mode === 'schedule') {
      this.run = cfg.run;
      dir = this.run.dir;
      this.stops = this.run.stops.slice(cfg.fromIdx, cfg.toIdx + 1);
      startStation = this.stops[0].station;
      startTime = this.stops[0].dep - 75;
    } else {
      dir = cfg.dir;
      startStation = route.stations[cfg.startIdx];
      startTime = cfg.time;
      this.stops = null;
    }
    this.env.time = startTime;
    this.trackPos = dir;
    const len = consistLength(spec, cfg.cars);
    this.sim = new TrainSim(spec, cfg.cars, { s: startStation.s + dir * len / 2, dir });
    this.sim.reverser = 0; this.sim.lever = -0.7; this.sim.km = 0; this.sim.kran = 4;
    if (spec.controller === 'separate') { this.sim.brakePipe = 4.3; this.sim.brakeCyl = 1.7; } else this.sim.brakeCyl = 2.6;
    this.signals = new SignalSystem(route);
    this.score = new Score(cfg.mode);
    this.safety = new Safety(route, this.signals, this.sim, this.score);
    // мир
    progress?.('Строим линию…', 0.7);
    this.world = new World(this.scene, route, this.line, { season: cfg.season, trainLen: len, cars: cfg.cars });
    this.world.update(this.sim.s, null, { immediate: true, time: this.env.time });
    // поезд
    progress?.('Состав и кабина…', 0.85);
    this.model = new TrainModel(spec, cfg.cars);
    await this.model.build();
    this.scene.add(this.model.group);
    this.cab = new Cab(spec);
    await this.cab.build(this.model.cars[0], this.model);
    this.rig = new CameraRig(this.camera, this);
    this.crowd = new Crowd(this.scene, route);
    const allRuns = [...this.runs[1], ...this.runs[-1]];
    this.traffic = new Traffic(this.scene, route, this.signals, allRuns, this.run?.id, (run) => (run.dir === dir ? spec : TRAINS.es2g));
    // состояние остановок
    this.stopState = { stoppedAt: null, arrivedIdx: -1, departedIdx: -1, announcedNext: -1, populated: -1 };
    if (cfg.mode === 'schedule') {
      this.stopIdx = 0; // индекс текущей/следующей остановки в this.stops
      this.stopState.arrivedIdx = 0;
      this.sim.doorsTarget[this.platformSide(startStation)] = 1; this.sim.doors[this.platformSide(startStation)] = 1;
      this.holdExit(startStation);
    }
    await audio.init();
    audio.resume();
    audio.setInside(true);
    const voice = this.voiceFor(startStation, dir);
    if (cfg.mode === 'schedule') audio.announce(['welcome', `to_${this.line.id}_${this.terminusFor(dir).id}`], voice);
    this.populate(startStation);
    this.msg(cfg.mode === 'schedule'
      ? `Рейс № ${this.run.number}: ${this.stops[0].station.name} → ${this.stops[this.stops.length - 1].station.name}. Отправление в ${fmtTime(this.stops[0].dep)}`
      : `Свободный режим: ${startStation.name}, направление на ${this.terminusFor(dir).name}`);
    this.msg(`Подготовка: реверсор вперёд (${input.bindingLabel('reverserFwd')}), закрыть двери (${input.bindingLabel('doorsClose')}), отпустить тормоз и набрать тягу (${input.bindingLabel('throttleUp')})`);
    progress?.('Готово', 1);
  }

  terminusFor(dir) { const st = this.route.stations; return dir > 0 ? st[st.length - 1] : st[0]; }
  voiceFor(st, dir) {
    // по аналогии с метро: к центру — мужской голос, от центра — женский (approx)
    const next = this.route.nextStation(st.s, dir);
    if (!next) return 'm';
    return Math.hypot(next.x, next.z) < Math.hypot(st.x, st.z) ? 'm' : 'f';
  }
  platformSide(st) { return st.island ? 'left' : 'right'; }
  trackLat(s) {
    const a = this.route.trackOffset(s, -1), b = this.route.trackOffset(s, 1);
    return a + (b - a) * ((this.trackPos + 1) / 2);
  }
  msg(t) { this.messages.push({ t, until: performance.now() + 6000 }); this.ui?.toast?.(t); }

  holdExit(st) {
    if (this.cfg.mode !== 'schedule') return;
    const sig = this.signals.exitSignalFor(st.index, this.sim.dir);
    if (sig) { this.signals.held.add(sig); this.heldSig = { sig, st }; }
  }

  populate(st) {
    if (this.stopState.populated === st.index) return;
    this.stopState.populated = st.index;
    this.crowd.populate(st, platformsOf(this.route, st), this.env.time);
  }

  // Двери: есть ли открытая дверь у позиции ds (м от головы назад) на стороне side
  doorAt(ds, side, tol = 0.8) {
    const sim = this.sim;
    if (sim.doors[side] < 0.8) return false;
    if (ds < 0 || ds > sim.length) return false;
    const m = this.model;
    for (let i = 0; i < m.cars.length; i++) {
      const c = m.carCenter(i), L = m.lens[i];
      if (Math.abs(ds - c) > L / 2) continue;
      const local = ds - c;
      for (const dz of [-L / 4, L / 4]) if (Math.abs(local - dz) < this.spec.doorWidth / 2 + tol - 0.4) return true;
    }
    return false;
  }

  doorPoints() {
    const sim = this.sim, pts = [];
    const side = sim.doors.left > 0.8 ? -1 : sim.doors.right > 0.8 ? 1 : 0;
    if (!side) return pts;
    const m = this.model;
    for (let i = 0; i < m.cars.length; i++) {
      for (const dz of [-m.lens[i] / 4, m.lens[i] / 4]) {
        const s = sim.s - sim.dir * (m.carCenter(i) + dz);
        pts.push({ s, lat: this.trackLat(s) + sim.dir * side * (this.spec.carWidth / 2 + 0.3) });
      }
    }
    return pts;
  }

  // ── управление ──
  handleControls(dt) {
    const sim = this.sim, spec = this.spec;
    const inCab = this.rig.mode === 'cab' || this.rig.mode === 'exterior' || this.rig.mode === 'trackside';
    if (!inCab) return;
    const rate = 0.55 * settings.controls.leverSpeed * dt;
    if (spec.controller === 'combined') {
      if (settings.controls.analogTriggers && input.pad) {
        const up = input.padValue(7), dn = input.padValue(6);
        if (up > 0.02 || dn > 0.02) sim.setLever(up - dn);
      } else {
        const up = input.value('throttleUp'), dn = Math.max(input.value('throttleDown'), input.value('brakeMore'));
        if (up > 0) sim.moveLever(rate * up * (sim.lever < 0 ? 1.6 : 1));
        if (dn > 0) sim.moveLever(-rate * dn * (sim.lever > 0 ? 1.6 : 1));
        if (input.down('brakeLess') && sim.lever < 0) sim.moveLever(rate);
      }
      if (sim.emergency && sim.speedKmh < 0.1 && sim.lever <= -0.99) sim.releaseEmergency();
    } else {
      this.kmCooldown = Math.max(0, (this.kmCooldown || 0) - dt);
      if (this.kmCooldown === 0) {
        if (input.down('throttleUp')) { sim.kmStep(1); this.kmCooldown = 0.35; }
        else if (input.down('throttleDown')) { sim.kmStep(-1); this.kmCooldown = 0.25; }
        else if (input.down('brakeMore')) { sim.kranStep(1); this.kmCooldown = 0.3; }
        else if (input.down('brakeLess')) { sim.kranStep(-1); this.kmCooldown = 0.3; }
      }
      if (sim.emergency && sim.speedKmh < 0.1 && sim.kran <= 4) sim.releaseEmergency();
    }
    if (input.pressed('emergency')) { sim.applyEmergency(); if (sim.speedKmh > 1) this.score.event('emergency'); }
    if (input.pressed('reverserFwd')) sim.setReverser(Math.min(1, sim.reverser + 1));
    if (input.pressed('reverserBack')) sim.setReverser(Math.max(-1, sim.reverser - 1));
    if (input.pressed('reverserCycle')) sim.setReverser(sim.reverser === 1 ? 0 : sim.reverser === 0 ? -1 : 1);
    if (input.pressed('doorsLeft')) this.openDoors('left');
    if (input.pressed('doorsRight')) this.openDoors('right');
    if (input.pressed('doorsClose')) this.closeDoors();
    if (input.pressed('vigilance')) this.safety.pressVigilance();
    if (input.pressed('headlights')) sim.headlights = !sim.headlights;
    if (input.pressed('cabLight')) { sim.cabLight = !sim.cabLight; this.cab.setLight(sim.cabLight); }
    if (input.pressed('wipers')) sim.wipers = (sim.wipers + 1) % 3;
    if (input.pressed('pantograph')) { if (sim.speedKmh < 1 || !sim.pantograph) sim.pantograph = !sim.pantograph; }
    if (input.pressed('changeEnds')) this.changeEnds();
    if (input.down('horn')) audio.hornOn('horn'); else if (input.down('whistle')) audio.hornOn('whistle'); else audio.hornOff();
  }

  openDoors(side) {
    const sim = this.sim;
    const st = this.route.stationAt(sim.s - sim.dir * sim.length / 2, 0);
    if (!sim.openDoors(side)) return;
    const front = sim.s, rear = sim.rearS;
    const onPlatform = st && Math.min(front, rear) > st.s - st.platformLength / 2 - 5 && Math.max(front, rear) < st.s + st.platformLength / 2 + 5;
    if (!st || !onPlatform) { this.msg('Двери открыты вне платформы!'); this.score.event('wrongDoors'); return; }
    if (side !== this.platformSide(st)) { this.msg('Двери открыты не со стороны платформы!'); this.score.event('wrongDoors'); return; }
    this.onDoorsOpenAtStation(st);
  }

  closeDoors() {
    const sim = this.sim;
    if (!sim.closeDoors()) return;
    const st = this.route.stationAt(sim.s - sim.dir * sim.length / 2, 20);
    if (st) {
      const next = this.nextStopStation(st);
      const voice = this.voiceFor(st, sim.dir);
      audio.announce(['doors', next ? `next_${next.id}` : null], voice);
    }
  }

  nextStopStation(st) {
    if (this.stops) {
      const i = this.stops.findIndex((x) => x.station === st);
      return this.stops[i + 1]?.station || null;
    }
    return this.route.nextStation(st.s, this.sim.dir);
  }

  onDoorsOpenAtStation(st) {
    const sim = this.sim;
    const voice = this.voiceFor(st, sim.dir);
    const isLast = this.stops ? this.stops[this.stops.length - 1].station === st : this.terminusFor(sim.dir) === st;
    audio.announce([`arr_${st.id}`, st.transfer ? `tr_${st.id}` : null, isLast ? 'terminal' : null], voice);
    this.populate(st);
    setTimeout(() => this.crowd.board(this.doorPoints()), 2500);
    if (this.cfg.mode === 'schedule' && isLast) {
      setTimeout(() => this.finish(), 6000);
    } else if (isLast) {
      this.msg(`Конечная. Для продолжения смените кабину (${input.bindingLabel('changeEnds')}) и следуйте в обратном направлении.`);
    }
  }

  changeEnds() {
    const sim = this.sim;
    if (!sim.doorsClosed && sim.speedKmh < 0.1) { /* можно и с открытыми дверями */ }
    if (!sim.changeEnds()) return;
    this.model.reverse();
    // кабина переходит в новый головной вагон
    this.cab.group.removeFromParent();
    this.cab.build(this.model.cars[0], this.model).then(() => {});
    this.msg('Кабина сменена. Реверсор в нейтрали.');
    this.stopState.arrivedIdx = -1;
    if (this.cfg.mode === 'free') {
      const st = this.route.stationAt(sim.s - sim.dir * sim.length / 2, 30);
      if (st) audio.announce([`to_${this.line.id}_${this.terminusFor(sim.dir).id}`], this.voiceFor(st, sim.dir));
    }
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.ui.showResults(this);
  }

  // ── логика остановок и расписания ──
  updateStops(dt) {
    const sim = this.sim, route = this.route, time = this.env.time;
    const dir = sim.dir;
    const mid = sim.s - dir * sim.length / 2;
    const st = route.stationAt(mid, 40);
    // посадка людей при приближении
    const ahead = route.nextStation(sim.s, dir, true);
    if (ahead && Math.abs(ahead.s - sim.s) < 700) this.populate(ahead);
    if (this.cfg.mode !== 'schedule') {
      if (st && sim.speedKmh < 0.05 && this.stopState.stoppedAt !== st.index) {
        this.stopState.stoppedAt = st.index;
        const err = (sim.s - (st.s + dir * sim.length / 2)) * dir;
        this.msg(`${st.name}: остановка ${err >= 0 ? '+' : ''}${err.toFixed(1)} м от знака`);
      }
      if (!st || sim.speedKmh > 5) this.stopState.stoppedAt = null;
      return;
    }
    const stops = this.stops;
    const k = this.stopIdx;
    const cur = stops[k];
    if (!cur) return;
    const sStop = cur.station.s + dir * sim.length / 2;
    const err = (sim.s - sStop) * dir;
    // прибытие
    if (this.stopState.arrivedIdx < k && sim.speedKmh < 0.05 && Math.abs(err) < 60) {
      this.stopState.arrivedIdx = k;
      this.score.arrival(cur.station, err, time - cur.arr);
      this.msg(`${cur.station.name}: точность ${err >= 0 ? '+' : ''}${err.toFixed(1)} м, ${time - cur.arr > 0 ? 'опоздание' : 'запас'} ${Math.abs(Math.round(time - cur.arr))} с`);
      this.holdExit(cur.station);
    }
    // пропуск остановки
    if (this.stopState.arrivedIdx < k && err > 80 && k > 0) {
      this.score.event('missedStop');
      this.msg(`Пропущена остановка ${cur.station.name}!`);
      this.stopState.arrivedIdx = k; this.stopState.departedIdx = k;
      this.stopIdx++;
      return;
    }
    // открытие выходного по расписанию
    if (this.heldSig && this.heldSig.st === cur.station && time >= cur.dep - 20 && this.stopState.arrivedIdx >= k) {
      this.signals.held.delete(this.heldSig.sig); this.heldSig = null;
    }
    // отправление
    if (this.stopState.arrivedIdx >= k && this.stopState.departedIdx < k && sim.speedKmh > 1 && k < stops.length - 1) {
      this.stopState.departedIdx = k;
      this.score.departure(cur.station, time - cur.dep);
      if (time - cur.dep < -10) this.msg(`Отправление раньше расписания на ${Math.round(cur.dep - time)} с!`);
      this.stopIdx++;
      this.pendingForget = time + 25;
    }
    if (this.pendingForget && time > this.pendingForget) {
      this.pendingForget = null;
      if (Math.random() < 0.3) audio.announce([Math.random() < 0.5 ? 'forget' : 'smoking'], this.voiceFor(cur.station, dir));
    }
  }

  // информация для HUD
  info() {
    const sim = this.sim, route = this.route, time = this.env.time, dir = sim.dir;
    let next, nextArr = null, nextDep = null;
    if (this.stops) {
      const s = this.stops[this.stopIdx];
      next = s?.station; nextArr = s?.arr; nextDep = s?.dep;
    } else next = route.nextStation(sim.s - dir * 20, dir, true);
    const nextDist = next ? (next.s + dir * sim.length / 2 - sim.s) * dir : null;
    return { time, next, nextName: next?.name, nextDist, nextArr, nextDep, dev: nextArr != null ? null : null };
  }

  boardsFor(st) {
    // табло станции: ближайшие поезда в обе стороны
    const t = this.env.time;
    const rows = [];
    for (const d of [1, -1]) {
      const run = this.runs[d].find((r) => { const x = r.stops.find((y) => y.station === st); return x && x.dep >= t - 30; });
      if (run) { const x = run.stops.find((y) => y.station === st); rows.push({ time: fmtTime(x.dep), dest: run.to, note: x.arr - t < 120 && x.arr - t > -40 ? 'ПРИБЫВАЕТ' : '' }); }
    }
    return rows.sort((a, b) => a.time.localeCompare(b.time));
  }

  update(dtReal) {
    if (this.paused || this.finished) return;
    const dt = Math.min(0.05, dtReal) * this.timeScale;
    const sim = this.sim, route = this.route;
    // камеры
    if (input.pressed('camCab')) this.rig.setMode('cab');
    if (input.pressed('camExterior')) this.rig.setMode('exterior');
    if (input.pressed('camTrackside')) this.rig.setMode('trackside');
    if (input.pressed('camWalk')) this.rig.setMode('walk');
    if (input.pressed('cameraNext')) this.rig.cycle();
    if (input.pressed('interact') && this.rig.mode === 'cab') { this.rig.setMode('walk'); input.pressedKeys.clear(); }
    if (this.cfg.mode === 'free') {
      if (input.pressed('timeFast')) { this.timeScale = Math.min(8, this.timeScale * 2); this.msg(`Ускорение времени ×${this.timeScale}`); }
      if (input.pressed('timeNormal')) { this.timeScale = 1; this.msg('Обычное время'); }
    }
    this.handleControls(dt);
    // физика с подшагами
    const n = Math.ceil(dt / (1 / 120));
    const h = dt / n;
    for (let i = 0; i < n; i++) sim.update(h, route.grade(sim.s - sim.dir * sim.length / 2), route.curveRadius(sim.s));
    // съезд на «свой» путь после оборота (условный съезд)
    if (this.trackPos !== sim.dir && sim.speedKmh > 1) {
      this.trackPos += Math.sign(sim.dir - this.trackPos) * (sim.speedKmh / 3.6) * dt / 120;
      if (Math.abs(this.trackPos - sim.dir) < 0.01 || Math.sign(sim.dir - this.trackPos) !== Math.sign(sim.dir)) this.trackPos = sim.dir;
    }
    // упор в тупик
    const endS = sim.dir > 0 ? route.length - 30 : 30;
    if ((sim.s - endS) * sim.dir > 0) { sim.s = endS; sim.v = 0; this.msg('Упор!'); sim.applyEmergency(); }
    this.env.time += dt;
    this.safety.update(dt);
    this.score.comfort(dt, sim.a, sim.jerk);
    for (const e of sim.events) audio.event(e, this.spec);
    sim.events.length = 0;
    for (const m of sim.messages) this.msg(m);
    sim.messages.length = 0;
    this.updateStops(dt);
    // светофоры
    const occ = [{ dir: sim.dir, front: sim.s, rear: sim.rearS }, ...this.traffic.occupants(this.env.time, sim.s)];
    this.signals.computeAspects(occ);
    // попутные/встречные
    this.traffic.update(dt, this.env.time, sim.s, this.camera.position);
    // модель
    this.placeOnTrack(dt);
    this.cab.setInside?.(this.rig.mode === 'cab');
    this.model.setDoors(sim.doors.left, sim.doors.right);
    this.model.setLights({ head: sim.headlights, night: this.env.night });
    this.model.setPantograph(sim.pantograph ? 1 : 0);
    this.cab.update(dt, sim, this.safety, this.info());
    this.rig.update(dtReal);
    this.crowd.update(dt, this.camera.position);
    const camS = this.rig.mode === 'walk' && !this.rig.walk.inTrain ? this.rig.walk.s : sim.s;
    this.world.update(camS, this.camera.position, { time: this.env.time, night: this.env.night, boardsFor: (st) => this.boardsFor(st) });
    const aiNear = this.traffic.nearestOpposite(sim.s, sim.dir);
    const zone = Math.hypot(this.camera.position.x, this.camera.position.z) < 14000 ? 1 : 0.3;
    audio.update(dt, sim, this.env, { view: this.rig.mode, aiNear: aiNear < 60 ? 1 - aiNear / 60 : 0, city: zone, walking: this.rig.mode === 'walk' });
  }

  placeOnTrack(dt = 0) {
    this.model.place(this.route, this.sim.s, this.sim.dir, (s) => this.trackLat(s), dt, this.sim.v);
  }

  dispose() {
    audio.hornOff();
    this.traffic.clear();
    this.crowd.clear();
    for (const ch of this.world.chunks.values()) if (ch) this.world.disposeGroup(ch.group);
    for (const g of this.world.stations.values()) this.world.disposeGroup(g);
    this.world.root.removeFromParent();
    this.world.ground.removeFromParent();
    this.model.group.removeFromParent();
  }
}

export { LINES, TRAINS, generateRuns, fmtTime, assets };
