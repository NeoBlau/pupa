// Автоблокировка: занятость блок-участков, показания светофоров, удержание выходных сигналов по расписанию.
export class SignalSystem {
  constructor(route) {
    this.route = route;
    this.trains = new Set(); // объекты с полями dir, s (голова), rearS, length — либо виртуальные позиции
    this.held = new Set(); // сигналы, закрытые диспетчером (выходные до времени отправления)
    this.lists = route.signals;
  }

  // occupant: { dir, front, rear } в координатах пикетажа, dir — направление движения по пути
  computeAspects(occupants) {
    for (const dir of [1, -1]) {
      const L = this.lists[dir];
      const occ = new Array(L.length).fill(false);
      for (const o of occupants) {
        if (o.dir !== dir) continue;
        const lo = Math.min(o.front, o.rear), hi = Math.max(o.front, o.rear);
        for (let i = 0; i < L.length; i++) {
          // блок i: от сигнала i до сигнала i+1 по ходу
          const a = L[i].s, b = i + 1 < L.length ? L[i + 1].s : L[i].s + dir * 3000;
          const blo = Math.min(a, b), bhi = Math.max(a, b);
          if (hi >= blo && lo <= bhi) occ[i] = true;
        }
      }
      let next = 'red';
      for (let i = L.length - 1; i >= 0; i--) {
        const sg = L[i];
        let asp;
        if (sg.kind === 'end' || occ[i] || this.held.has(sg)) asp = 'red';
        else if (next === 'red') asp = 'yellow';
        else asp = 'green';
        sg.aspect = asp;
        next = asp;
      }
    }
  }

  // следующий сигнал по ходу от позиции s (голова) в направлении dir
  nextSignal(s, dir, after = 0) {
    const L = this.lists[dir];
    for (const sg of L) if ((sg.s - s) * dir > after) return sg;
    return null;
  }

  signalAfter(sg) {
    const L = this.lists[sg.dir];
    return L[sg.i + 1] || null;
  }

  exitSignalFor(stationIndex, dir) {
    return this.lists[dir].find((sg) => (sg.kind === 'exit' || sg.kind === 'end') && sg.station === stationIndex) || null;
  }
}
