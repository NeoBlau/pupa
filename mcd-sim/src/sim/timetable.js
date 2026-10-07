// Генерация расписания. Реальное расписание МЦД не используется (нет открытых машиночитаемых данных) —
// времена хода рассчитываются по тяговым характеристикам поезда и ограничениям скорости, интервалы — приблизительные.

export function fmtTime(sec, withSec = false) {
  sec = ((Math.round(sec) % 86400) + 86400) % 86400;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return withSec ? `${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}`;
}

// Минимальное время хода между двумя остановками (кривая разгон—выбег—торможение)
export function runTime(route, sA, sB, train) {
  const dir = Math.sign(sB - sA);
  const dist = Math.abs(sB - sA);
  const ds = 10;
  const n = Math.max(2, Math.ceil(dist / ds));
  const acc = Math.min(0.75, (train.maxForcePerCar * 1000) / ((train.tareMassPerCar + train.loadMassPerCar * 0.6) * 1000 * 1.08)) * 0.85;
  const dec = 0.55;
  const v = new Float64Array(n + 1);
  const lim = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) lim[i] = Math.min(route.limitAt(sA + dir * i * ds), train.maxSpeed) / 3.6 * 0.95;
  v[0] = 0;
  for (let i = 1; i <= n; i++) v[i] = Math.min(lim[i], Math.sqrt(v[i - 1] ** 2 + 2 * acc * ds));
  v[n] = 0;
  for (let i = n - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * dec * ds));
  let t = 0;
  for (let i = 1; i <= n; i++) t += ds / Math.max(0.5, (v[i] + v[i - 1]) / 2);
  return t;
}

export function headwayAt(t) {
  const h = t / 3600;
  if ((h >= 7 && h < 10) || (h >= 17 && h < 20)) return 6 * 60;
  if (h >= 22 || h < 6) return 15 * 60;
  return 10 * 60;
}

// Все рейсы линии в направлении dir. stops: [{station, arr, dep}]
export function generateRuns(route, train, dir) {
  const st = dir > 0 ? route.stations : [...route.stations].reverse();
  // шаблон хода (от отправления с начальной)
  const tmpl = [];
  let t = 0;
  for (let i = 0; i < st.length; i++) {
    if (i > 0) t += Math.ceil((runTime(route, st[i - 1].s, st[i].s, train) * 1.07 + 10) / 15) * 15;
    const arr = t;
    const dwell = i === 0 || i === st.length - 1 ? 0 : st[i].hub ? 60 : 40;
    t += dwell;
    tmpl.push({ station: st[i], arr, dep: t });
  }
  const runs = [];
  let dep = 5 * 3600 + 20 * 60 + (dir > 0 ? 0 : 4 * 60);
  let num = dir > 0 ? 6001 : 6002;
  const lineNo = route.id.slice(1);
  while (dep < 24 * 3600 + 30 * 60) {
    runs.push({
      id: `${route.id}-${dir}-${num}`,
      number: `${lineNo}${String(num).slice(1)}`,
      dir,
      from: st[0].name, to: st[st.length - 1].name,
      stops: tmpl.map((x) => ({ station: x.station, arr: dep + x.arr, dep: dep + x.dep })),
    });
    dep += headwayAt(dep);
    num += 2;
  }
  return runs;
}

// Положение поезда по расписанию (для виртуальных поездов, пока они далеко от игрока)
export function virtualPosition(route, run, time) {
  const S = run.stops;
  if (time <= S[0].dep) return { s: S[0].station.s, moving: false, before: true };
  if (time >= S[S.length - 1].arr) return { s: S[S.length - 1].station.s, moving: false, after: true };
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i], b = S[i + 1];
    if (time < a.dep) return { s: a.station.s, moving: false };
    if (time < b.arr) {
      const u = (time - a.dep) / (b.arr - a.dep);
      // плавный разгон/торможение
      const e = u * u * (3 - 2 * u);
      return { s: a.station.s + (b.station.s - a.station.s) * e, moving: true, v: Math.abs(b.station.s - a.station.s) / (b.arr - a.dep) * 6 * u * (1 - u) };
    }
  }
  return { s: S[S.length - 1].station.s, moving: false };
}
