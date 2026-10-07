// Проверка симуляции без графики: поезд проходит перегон по расписанию с автоведением,
// проверяются время хода, точность остановки, работа сигналов и КЛУБ.
//   node tools/simtest.mjs [D1] [es2g] [cars] [startIdx] [dir]
import fs from 'node:fs';
import { Route } from '../src/sim/route.js';
import { TrainSim } from '../src/sim/train.js';
import { SignalSystem } from '../src/sim/signals.js';
import { Safety } from '../src/sim/safety.js';
import { generateRuns, runTime, fmtTime } from '../src/sim/timetable.js';
import { TRAINS } from '../src/data/trains.js';

const [lineId = 'D1', trainId = 'es2g', carsArg, startArg = '15', dirArg = '-1'] = process.argv.slice(2);
const LINES = JSON.parse(fs.readFileSync(new URL('../src/data/lines.json', import.meta.url)));
const route = new Route(LINES.lines[lineId]);
const spec = TRAINS[trainId];
const cars = Number(carsArg || spec.defaultCars);
const dir = Number(dirArg);
const startIdx = Number(startArg);
console.log(`${lineId}: длина оси ${(route.length / 1000).toFixed(1)} км, станций ${route.stations.length}, сигналов ${route.signals[1].length}+${route.signals[-1].length}, ограничений ${route.limits.length}`);
const runs = generateRuns(route, spec, dir);
console.log(`рейсов в направлении ${dir}: ${runs.length}; первый ${runs[0].number} ${fmtTime(runs[0].stops[0].dep)}, ход ${Math.round((runs[0].stops.at(-1).arr - runs[0].stops[0].dep) / 60)} мин`);

const st = route.stations[startIdx];
const sim = new TrainSim(spec, cars, { s: st.s + dir * spec.carLength * cars / 2, dir });
const signals = new SignalSystem(route);
const score = { event: (k) => { events.push(k); console.log('EVENT', k, 't', t.toFixed(1), 'passed', safety.lastPassed?.kind, safety.lastPassed?.name, safety.lastPassed?.s.toFixed(0), safety.lastPassed?.aspect, 'front', sim.s.toFixed(0)); }, overspeed: () => {} };
const events = []; let t = 0;
const safety = new Safety(route, signals, sim, score);
sim.reverser = 1;
const next = route.nextStation(st.s, dir);
const sStop = next.s + dir * sim.length / 2;
const planned = runTime(route, st.s, next.s, spec);
let maxV = 0, overs = 0;
const dt = 1 / 60;
while (t < 1200) {
  signals.computeAspects([{ dir, front: sim.s, rear: sim.rearS }]);
  safety.update(dt);
  const dStop = (sStop - sim.s) * dir;
  let vT = Math.min(safety.vAllowed - 4, Math.sqrt(2 * (spec.controller === 'combined' ? 0.6 : 0.4) * Math.max(0, dStop - (spec.controller === 'combined' ? 0 : 12))) * 3.6 + (dStop > 2 ? 1 : 0));
  const v = sim.speedKmh;
  const err = vT - v;
  if (spec.controller === 'combined') {
    sim.setLever(err > 2 ? Math.min(1, err * 0.08) : err < -1 ? Math.max(-1, err * 0.15) : 0);
    if (dStop < 0.5 && v < 2) sim.setLever(-1);
  } else {
    // ЭД4М: КМ и кран 395 — с упреждением, т.к. тормоз инерционный
    sim.km = err > 4 ? 5 : err > 1 ? sim.km : 0;
    const need = err < -1 || (dStop < 0.5 && v < 2);
    sim.kran = need ? (err < -6 ? 4 : 3) : 1;
    if (dStop < 0.5) sim.kran = 4;
  }
  if (safety.vigActive) safety.pressVigilance();
  for (let k = 0; k < 2; k++) sim.update(dt / 2, route.grade(sim.s), route.curveRadius(sim.s));
  t += dt;
  maxV = Math.max(maxV, v);
  if (safety.warn) overs++;
  if (dStop < 30 && sim.speedKmh < 0.01) break;
}
const errStop = (sim.s - sStop) * dir;
console.log(`${st.name} → ${next.name}: ${((Math.abs(next.s - st.s)) / 1000).toFixed(2)} км, время ${t.toFixed(0)} с (по расчёту ${planned.toFixed(0)} с), Vmax ${maxV.toFixed(0)} км/ч, точность ${errStop.toFixed(2)} м, превышений ${overs} кадров, события: ${events.join(',') || 'нет'}`);
console.log('ошибки:', [sim.emergency ? 'экстренное' : '', Math.abs(errStop) > 5 ? 'неточная остановка' : ''].filter(Boolean).join(', ') || 'нет');
