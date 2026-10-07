// Интерфейс: главное меню, выбор режима/линии/поезда/рейса, загрузка, HUD, пауза, расписание, настройки, управление, итоги.
import { input, ACTIONS, PAD_NAMES, keyLabel } from '../core/input.js';
import { settings, saveSettings } from '../core/settings.js';
import { TRAINS } from '../data/trains.js';
import { WEATHER, SEASONS } from '../world/environment.js';
import { fmtTime } from '../sim/timetable.js';
import { fmtDev } from '../sim/scoring.js';
import { assets } from '../core/assets.js';

const $ = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class UI {
  constructor(root, app) {
    this.root = root; this.app = app;
    this.toastsEl = $('<div class="toasts"></div>');
    this.root.append(this.toastsEl);
    this.sel = { mode: 'schedule', line: 'D1', train: 'es2g', cars: 10, dir: 1, runIdx: 0, fromIdx: 0, toIdx: -1, startIdx: 0, time: 9 * 3600, weather: 'clear', season: 'summer', period: 'day' };
    this.menuNav = true;
  }

  clear() { for (const el of [...this.root.children]) if (el !== this.toastsEl) el.remove(); this.hud = null; }

  toast(t) {
    const el = $(`<div class="toast">${esc(t)}</div>`);
    this.toastsEl.append(el);
    setTimeout(() => el.remove(), 6000);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild.remove();
  }

  // ── главное меню ──
  mainMenu() {
    this.clear();
    const el = $(`<div class="menu"><div class="menu-inner">
      <div class="brand"><div class="logo">МЦД</div><div><h1>Симулятор Московских центральных диаметров</h1><p>D1 · D2 · D3 · D4 — электропоезда ЭС2Г, ЭГ2Тв, ЭД4М</p></div></div>
      <div class="step">Режим</div>
      <div class="cards">
        <button class="card" data-mode="schedule"><h3>По расписанию</h3><p>Рейс с графиком движения: время отправления и прибытия, остановки, сигналы, ограничения скорости. Поездка оценивается.</p></button>
        <button class="card" data-mode="free"><h3>Свободный режим</h3><p>Выберите линию, поезд, станцию и направление — и езжайте без графика. На конечной можно сменить кабину и продолжить.</p></button>
      </div>
      <div class="step">Прочее</div>
      <div class="row">
        <button class="btn" data-act="controls">Управление</button>
        <button class="btn" data-act="settings">Настройки</button>
        <button class="btn" data-act="about">О проекте и ассетах</button>
      </div>
      <p class="note" style="margin-top:22px">${this.assetNote()}</p>
    </div></div>`);
    el.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { this.sel.mode = b.dataset.mode; this.setupMenu(); });
    el.querySelector('[data-act=controls]').onclick = () => this.controlsPanel(() => this.mainMenu());
    el.querySelector('[data-act=settings]').onclick = () => this.settingsPanel(() => this.mainMenu());
    el.querySelector('[data-act=about]').onclick = () => this.aboutPanel(() => this.mainMenu());
    this.root.append(el);
    this.focusFirst(el);
  }

  assetNote() {
    const n = assets.sketchfab.size;
    return n
      ? `Подключено моделей Sketchfab: ${n}.`
      : 'Модели Sketchfab (Ласточка, кабина Desiro, ЭД4М, Иволга, панельные дома) не скачаны — поезда показаны запасными процедурными моделями. Как подключить: README → «Ассеты Sketchfab».';
  }

  // ── настройка поездки ──
  setupMenu() {
    this.clear();
    const S = this.sel;
    const LINES = this.app.LINES.lines;
    const route = this.app.getRoute(S.line);
    const spec = TRAINS[S.train];
    if (!spec.consists.includes(S.cars)) S.cars = spec.defaultCars;
    const lineCards = Object.values(LINES).map((l) => `<button class="card ${l.id === S.line ? 'sel' : ''}" data-line="${l.id}"><h3><span class="badge" style="background:${l.color}">${l.id}</span>${l.name}</h3><p>${l.full}: ${l.from} — ${l.to}<br>${l.stations.length} станций · ≈${l.approxKm} км (по координатам станций)</p></button>`).join('');
    const trainCards = Object.values(TRAINS).map((t) => {
      const acc = (t.maxForcePerCar / (t.tareMassPerCar + t.loadMassPerCar * 0.6) / 1.08).toFixed(2);
      return `<button class="card ${t.id === S.train ? 'sel' : ''}" data-train="${t.id}"><h3>${t.name}</h3><p>${t.description}</p>
        <div class="stats"><div><b>${t.maxSpeed}</b>км/ч</div><div><b>${acc}</b>м/с² разгон</div><div><b>${t.serviceDecel}</b>м/с² торм.</div><div><b>${t.controller === 'combined' ? 'единая' : 'КМ+395'}</b>рукоятка</div></div></button>`;
    }).join('');
    const isSched = S.mode === 'schedule';
    const el = $(`<div class="menu"><div class="menu-inner">
      <div class="brand"><div class="logo">МЦД</div><div><h1>${isSched ? 'Поездка по расписанию' : 'Свободный режим'}</h1><p>Выберите линию, электропоезд и ${isSched ? 'рейс' : 'начальную станцию'}</p></div></div>
      <div class="step">1. Линия</div><div class="cards">${lineCards}</div>
      <div class="step">2. Электропоезд</div><div class="cards">${trainCards}</div>
      <div class="row" style="margin-top:12px"><span class="note">Составность:</span> ${spec.consists.map((c) => `<button class="btn ${c === S.cars ? 'primary' : ''}" data-cars="${c}">${c} ваг.</button>`).join('')}</div>
      <div class="step">3. ${isSched ? 'Направление и рейс' : 'Станция и направление'}</div>
      <div class="row">
        <select data-k="dir"><option value="1" ${S.dir > 0 ? 'selected' : ''}>на ${esc(route.stations[route.stations.length - 1].name)}</option><option value="-1" ${S.dir < 0 ? 'selected' : ''}>на ${esc(route.stations[0].name)}</option></select>
        ${isSched ? `<select data-k="period">${[['morning', 'Утро 05–10'], ['day', 'День 10–16'], ['evening', 'Вечер 16–21'], ['night', 'Ночь 21–01']].map(([k, n]) => `<option value="${k}" ${S.period === k ? 'selected' : ''}>${n}</option>`).join('')}</select>` : ''}
        ${!isSched ? `<select data-k="startIdx">${route.stations.map((s, i) => `<option value="${i}" ${i === S.startIdx ? 'selected' : ''}>${esc(s.name)}${s.approx ? ' (коорд. прибл.)' : ''}</option>`).join('')}</select>
          <label class="note">Время <input data-k="time" type="time" value="${fmtTime(S.time)}" style="background:#1a212b;color:#fff;border:1px solid #333;border-radius:8px;padding:8px"></label>` : ''}
      </div>
      ${isSched ? '<div class="runs" style="margin-top:12px"></div><div class="row" style="margin-top:10px"><span class="note">Участок:</span><select data-k="fromIdx"></select><span class="note">→</span><select data-k="toIdx"></select></div>' : ''}
      <div class="step">4. Условия</div>
      <div class="row">
        <select data-k="season">${Object.entries(SEASONS).map(([k, v]) => `<option value="${k}" ${S.season === k ? 'selected' : ''}>${v.name}</option>`).join('')}</select>
        <select data-k="weather">${Object.entries(WEATHER).map(([k, v]) => `<option value="${k}" ${S.weather === k ? 'selected' : ''}>${v.name}</option>`).join('')}</select>
      </div>
      <div class="warnbox" style="margin-top:16px">Положение станций — по OpenStreetMap; ось пути между станциями, профиль, ограничения скорости, сигналы, тип платформ и расписание — приблизительные (сгенерированы), не официальные данные.${route.stations.some((s) => s.approx) ? ' Координаты станций с пометкой «прибл.» интерполированы.' : ''}</div>
      <div class="row" style="margin-top:20px"><button class="btn" data-act="back">← Назад</button><button class="btn primary big" data-act="start">Начать поездку</button></div>
    </div></div>`);
    el.querySelectorAll('[data-line]').forEach((b) => b.onclick = () => { S.line = b.dataset.line; S.runIdx = 0; S.fromIdx = 0; S.toIdx = -1; S.startIdx = 0; this.setupMenu(); });
    el.querySelectorAll('[data-train]').forEach((b) => b.onclick = () => { S.train = b.dataset.train; S.cars = TRAINS[S.train].defaultCars; this.setupMenu(); });
    el.querySelectorAll('[data-cars]').forEach((b) => b.onclick = () => { S.cars = +b.dataset.cars; this.setupMenu(); });
    el.querySelectorAll('select[data-k]').forEach((s) => s.onchange = () => {
      const k = s.dataset.k; const v = s.value;
      S[k] = ['dir', 'startIdx', 'fromIdx', 'toIdx'].includes(k) ? +v : v;
      if (k === 'dir' || k === 'period') { S.runIdx = 0; S.fromIdx = 0; S.toIdx = -1; }
      if (k === 'dir' || k === 'period' || k === 'fromIdx' || k === 'toIdx') this.setupMenu();
    });
    const ti = el.querySelector('input[data-k=time]');
    if (ti) ti.onchange = () => { const [h, m] = ti.value.split(':').map(Number); S.time = h * 3600 + m * 60; };
    if (isSched) this.fillRuns(el, route, spec);
    el.querySelector('[data-act=back]').onclick = () => this.mainMenu();
    el.querySelector('[data-act=start]').onclick = () => this.start();
    this.root.append(el);
    this.focusFirst(el);
  }

  fillRuns(el, route, spec) {
    const S = this.sel;
    const all = this.app.generateRuns(route, spec, S.dir);
    const range = { morning: [5, 10], day: [10, 16], evening: [16, 21], night: [21, 25.5] }[S.period];
    const runs = all.filter((r) => r.stops[0].dep >= range[0] * 3600 && r.stops[0].dep < range[1] * 3600);
    this.runsList = runs;
    S.runIdx = Math.min(S.runIdx, runs.length - 1);
    const box = el.querySelector('.runs');
    box.innerHTML = `<table><tr><th>№</th><th>Отпр.</th><th>Маршрут</th><th>Приб.</th><th>В пути</th><th>Остановок</th></tr>${runs.map((r, i) => {
      const a = r.stops[0], b = r.stops[r.stops.length - 1];
      return `<tr data-i="${i}" class="${i === S.runIdx ? 'sel' : ''}" tabindex="0"><td>${r.number}</td><td>${fmtTime(a.dep)}</td><td>${esc(r.from)} → ${esc(r.to)}</td><td>${fmtTime(b.arr)}</td><td>${Math.round((b.arr - a.dep) / 60)} мин</td><td>${r.stops.length}</td></tr>`;
    }).join('')}</table>`;
    box.querySelectorAll('tr[data-i]').forEach((tr) => tr.onclick = () => { S.runIdx = +tr.dataset.i; box.querySelectorAll('tr').forEach((x) => x.classList.toggle('sel', x === tr)); });
    const run = runs[S.runIdx];
    if (!run) return;
    if (S.toIdx < 0 || S.toIdx >= run.stops.length) S.toIdx = run.stops.length - 1;
    if (S.fromIdx >= S.toIdx) S.fromIdx = Math.max(0, S.toIdx - 1);
    const from = el.querySelector('select[data-k=fromIdx]'), to = el.querySelector('select[data-k=toIdx]');
    from.innerHTML = run.stops.slice(0, -1).map((x, i) => `<option value="${i}" ${i === S.fromIdx ? 'selected' : ''}>${esc(x.station.name)} ${fmtTime(x.dep)}</option>`).join('');
    to.innerHTML = run.stops.map((x, i) => i > S.fromIdx ? `<option value="${i}" ${i === S.toIdx ? 'selected' : ''}>${esc(x.station.name)} ${fmtTime(x.arr)}</option>` : '').join('');
  }

  start() {
    const S = this.sel;
    const cfg = { mode: S.mode, line: S.line, train: S.train, cars: S.cars, weather: S.weather, season: S.season };
    if (S.mode === 'schedule') {
      const run = this.runsList?.[S.runIdx];
      if (!run) { this.toast('Выберите рейс'); return; }
      Object.assign(cfg, { run, fromIdx: S.fromIdx, toIdx: S.toIdx < 0 ? run.stops.length - 1 : S.toIdx });
    } else Object.assign(cfg, { dir: S.dir, startIdx: S.startIdx, time: S.time });
    this.app.startGame(cfg);
  }

  loading(text, p) {
    let el = this.root.querySelector('.loading');
    if (!el) { this.clear(); el = $('<div class="loading"><div style="text-align:center"><div class="brand" style="justify-content:center"><div class="logo">МЦД</div></div><div class="lt"></div><div class="bar"><i></i></div></div></div>'); this.root.append(el); }
    el.querySelector('.lt').textContent = text;
    el.querySelector('.bar i').style.width = `${Math.round(p * 100)}%`;
  }

  // ── HUD ──
  buildHud(game) {
    this.clear();
    const el = $(`<div class="hud">
      <div class="tl"><span class="badge" style="background:${game.line.color}">${game.line.id}</span><div><div style="font-weight:700">${esc(game.spec.name)} · ${game.cfg.cars} ваг.</div><div class="k mode"></div></div><div style="margin-left:10px;text-align:right"><div class="clock" style="font-size:22px;font-weight:700"></div><div class="k dev"></div></div></div>
      <div class="tr"><div class="k">Следующая остановка</div><div class="next" style="font-size:20px;font-weight:700"></div><div class="nextinfo k"></div><div class="sig" style="margin-top:8px"></div></div>
      <div class="br"><div><span class="speed">0</span><span class="unit">км/ч</span><span style="float:right;text-align:right"><span class="als"></span> <span class="alsname k"></span></span></div>
        <div class="lim"><div class="limsign">—</div><div><div class="k">Допустимая <b class="vallow"></b></div><div class="k target"></div><div class="k grade"></div></div></div>
        <div class="lever"><b></b></div><div class="k ctrl"></div>
        <div class="bars"><span class="k">ТЦ</span><i><b class="bc"></b></i><span class="bcv"></span><span class="k">Тяга</span><i><b class="tr2" style="background:#3ccf6e"></b></i><span class="trv"></span></div>
      </div>
      <div class="bl"><div class="state"></div><div class="hints k" style="margin-top:6px"></div></div>
      <div class="prompt" style="display:none"></div><div class="vig" style="display:none">БДИТЕЛЬНОСТЬ — нажмите РБ</div><div class="crosshair" style="display:none"></div>
    </div>`);
    this.root.append(el);
    this.hud = { el, game, q: (s) => el.querySelector(s) };
    this.hudT = 0;
  }

  updateHud(dt) {
    const H = this.hud; if (!H) return;
    const g = H.game, sim = g.sim, sf = g.safety, q = H.q;
    const mode = settings.gameplay.hud;
    H.el.style.display = mode === 'off' ? 'none' : '';
    ['.tr', '.bl'].forEach((s) => { q(s).style.display = mode === 'minimal' ? 'none' : ''; });
    q('.speed').textContent = Math.round(sim.speedKmh);
    q('.crosshair').style.display = g.rig.mode === 'walk' ? '' : 'none';
    const pr = g.prompt || sf.prompt;
    q('.prompt').style.display = pr ? '' : 'none'; q('.prompt').textContent = pr;
    q('.vig').style.display = sf.vigActive ? '' : 'none';
    this.hudT += dt; if (this.hudT < 0.15) return; this.hudT = 0;
    const info = g.info();
    q('.clock').textContent = fmtTime(info.time, true);
    q('.mode').textContent = `${g.cfg.mode === 'schedule' ? `Рейс № ${g.run.number}` : 'Свободный режим'} · ${{ cab: 'кабина', exterior: 'снаружи', trackside: 'у пути', walk: 'пешком' }[g.rig.mode]}${g.timeScale > 1 ? ` · ×${g.timeScale}` : ''}`;
    if (info.next) {
      q('.next').textContent = info.next.name;
      let t = info.nextDist != null ? `${info.nextDist > 1000 ? (info.nextDist / 1000).toFixed(1) + ' км' : Math.max(0, Math.round(info.nextDist)) + ' м'}` : '';
      if (info.nextArr != null) {
        const eta = info.time + Math.max(0, info.nextDist) / Math.max(8, sim.speedKmh / 3.6) * (sim.speedKmh > 5 ? 1.15 : 1);
        t += ` · приб. ${fmtTime(info.nextArr)} · отпр. ${fmtTime(info.nextDep)}`;
        const dev = Math.round(eta - info.nextArr);
        q('.dev').textContent = sim.speedKmh < 1 && info.nextDist < 50 ? (info.time < info.nextDep ? `до отправления ${fmtDev(info.nextDep - info.time)}` : `опоздание ${fmtDev(info.time - info.nextDep)}`) : (dev > 30 ? `прогноз: +${fmtDev(dev)}` : 'по графику');
        q('.dev').style.color = dev > 60 && sim.speedKmh >= 1 ? '#ffb020' : '';
      } else q('.dev').textContent = '';
      q('.nextinfo').textContent = t + (info.next.island ? ' · платформа слева' : ' · платформа справа');
    } else { q('.next').textContent = '—'; q('.nextinfo').textContent = ''; }
    const sig = sf.nextSig;
    const col = { green: '#2ee66b', yellow: '#ffcc22', red: '#ff3322' };
    q('.sig').innerHTML = sig ? `<span class="als" style="background:${col[sig.aspect]}"></span> <span class="k">Светофор ${esc(sig.name)} · ${Math.round((sig.s - sim.s) * sim.dir)} м</span>` : '';
    const alsCol = { З: '#2ee66b', Ж: '#ffcc22', КЖ: 'linear-gradient(90deg,#ff3322 50%,#ffcc22 50%)', К: '#ff3322', Б: '#eef' }[sf.als];
    q('.br .als').style.background = alsCol; q('.alsname').textContent = `АЛСН: ${sf.als}`;
    q('.limsign').textContent = Math.round(sf.vLimit ?? 0);
    q('.vallow').textContent = `${Math.round(sf.vAllowed)} км/ч`;
    q('.target').textContent = sf.targetKind ? `Цель: ${Math.round(sf.vTarget)} км/ч через ${Math.round(sf.targetDist)} м` : '';
    q('.grade').textContent = `Уклон ${(g.route.grade(sim.s) * sim.dir).toFixed(1)} ‰ (прибл.)`;
    const lv = sim.spec.controller === 'combined' ? sim.lever : (sim.km > 0 ? sim.km / 5 : -(sim.brakeCyl / 3.8));
    q('.lever b').style.left = `${(lv + 1) * 50}%`;
    q('.ctrl').textContent = sim.spec.controller === 'combined'
      ? `Рукоятка: ${sim.lever > 0.005 ? `ТЯГА ${Math.round(sim.lever * 100)}%` : sim.lever < -0.005 ? `ТОРМОЗ ${Math.round(-sim.lever * 100)}%` : 'НОЛЬ'}${sim.emergency ? ' · ЭКСТРЕННОЕ' : ''}`
      : `КМ: ${['0', 'М', '1', '2', '3', '4'][sim.km]} · Кран 395: ${['I', 'II', 'III', 'IV', 'V', 'Va', 'VI'][sim.kran]}${sim.emergency ? ' · ЭКСТРЕННОЕ' : ''}`;
    q('.bc').style.width = `${(sim.brakeCyl / 4.2) * 100}%`; q('.bcv').textContent = sim.brakeCyl.toFixed(1);
    q('.tr2').style.width = `${sim.tractionEffort * 100}%`; q('.trv').textContent = `${Math.round(sim.tractionEffort * 100)}%`;
    q('.state').innerHTML = `Реверсор: <b>${sim.reverser > 0 ? 'Вперёд' : sim.reverser < 0 ? 'Назад' : '0'}</b> · Двери: <b style="color:${sim.doorsClosed ? '#3ccf6e' : '#ffb020'}">${sim.doorsClosed ? 'закрыты' : `${sim.doorsTarget.left ? 'Л' : ''}${sim.doorsTarget.right ? 'П' : ''} открыты`}</b><br>ТМ ${sim.brakePipe.toFixed(1)} бар · ГР ${sim.mainRes.toFixed(1)} бар${sim.interlockReason ? ` · <span style="color:#ff9a4a">${esc(sim.interlockReason)}</span>` : ''}<br>Очки: ${Math.round(g.score.points)}`;
    const L = (a) => `<kbd>${esc(input.bindingLabel(a))}</kbd>`;
    q('.hints').innerHTML = g.rig.mode === 'walk'
      ? `${L('moveForward')}${L('moveLeft')}${L('moveBack')}${L('moveRight')} идти · ${L('run')} бег · ${L('interact')} действие · ${L('camCab')} кабина`
      : sim.spec.controller === 'combined'
        ? `${L('throttleUp')}/${L('throttleDown')} рукоятка · ${L('reverserFwd')}/${L('reverserBack')} реверсор · ${L('doorsLeft')}/${L('doorsRight')}/${L('doorsClose')} двери · ${L('vigilance')} РБ · ${L('horn')} тифон · ${L('emergency')} экстр. · ${L('schedule')} расписание`
        : `${L('throttleUp')}/${L('throttleDown')} КМ · ${L('brakeLess')}/${L('brakeMore')} кран 395 · ${L('reverserFwd')}/${L('reverserBack')} реверсор · ${L('doorsLeft')}/${L('doorsRight')}/${L('doorsClose')} двери · ${L('vigilance')} РБ · ${L('schedule')} расписание`;
  }

  // ── расписание / схема линии ──
  schedulePanel(game) {
    if (this.root.querySelector('.overlay.sched-o')) { this.root.querySelector('.overlay.sched-o').remove(); return; }
    const route = game.route, sim = game.sim;
    const st = route.stations;
    const span = st[st.length - 1].s - st[0].s;
    const pos = (s) => ((s - st[0].s) / span) * 100;
    const dots = st.map((x) => `<div class="dot" title="${esc(x.name)}" style="left:${pos(x.s)}%;border-color:${game.line.color}"></div>`).join('');
    let rows = '';
    if (game.stops) {
      rows = game.stops.map((x, i) => `<tr class="${i < game.stopIdx ? 'done' : i === game.stopIdx ? 'cur' : ''}"><td>${esc(x.station.name)}</td><td>${i === 0 ? '' : fmtTime(x.arr)}</td><td>${i === game.stops.length - 1 ? '' : fmtTime(x.dep)}</td><td>${(Math.abs(x.station.s - game.stops[0].station.s) / 1000).toFixed(1)} км</td><td>${x.station.island ? 'слева' : 'справа'}</td></tr>`).join('');
    } else {
      const list = sim.dir > 0 ? st : [...st].reverse();
      rows = list.map((x) => `<tr class="${(x.s - sim.s) * sim.dir < -50 ? 'done' : ''}"><td>${esc(x.name)}${x.approx ? ' *' : ''}</td><td colspan="2">${x.transfer ? esc(x.transfer) : ''}</td><td>${(Math.abs(x.s - sim.s) / 1000).toFixed(1)} км</td><td>${x.island ? 'слева' : 'справа'}</td></tr>`).join('');
    }
    const el = $(`<div class="overlay sched-o"><div class="panel">
      <h2><span class="badge" style="background:${game.line.color}">${game.line.id}</span>${esc(game.line.name)} — ${esc(game.line.full)}</h2>
      <div class="diagram"><div class="ln" style="background:${game.line.color}"></div>${dots}<div class="me" style="left:${pos(sim.s)}%">🚆</div></div>
      <table class="sched"><tr><th>Станция</th><th>Приб.</th><th>Отпр.</th><th>Расст.</th><th>Платформа</th></tr>${rows}</table>
      <p class="note">Ограничения скорости на линии: ${[...new Set(route.limits.map((l) => l.v))].sort((a, b) => a - b).join(', ')} км/ч (рассчитаны по радиусам кривых и зонам — приблизительно).</p>
      <div class="row"><button class="btn" data-act="close">Закрыть (${esc(input.bindingLabel('schedule'))})</button></div></div></div>`);
    el.querySelector('[data-act=close]').onclick = () => el.remove();
    this.root.append(el);
  }

  pausePanel(game, onResume, onQuit) {
    const el = $(`<div class="overlay pause-o"><div class="panel" style="width:min(460px,92vw)"><h2>Пауза</h2>
      <div style="display:grid;gap:10px">
      <button class="btn primary" data-a="resume">Продолжить</button>
      <button class="btn" data-a="controls">Управление</button>
      <button class="btn" data-a="settings">Настройки</button>
      <button class="btn" data-a="quit">Выйти в меню</button></div></div></div>`);
    el.querySelector('[data-a=resume]').onclick = () => { el.remove(); onResume(); };
    el.querySelector('[data-a=controls]').onclick = () => { el.remove(); this.controlsPanel(() => this.pausePanel(game, onResume, onQuit), true); };
    el.querySelector('[data-a=settings]').onclick = () => { el.remove(); this.settingsPanel(() => this.pausePanel(game, onResume, onQuit), true); };
    el.querySelector('[data-a=quit]').onclick = () => { el.remove(); onQuit(); };
    this.root.append(el);
    this.focusFirst(el);
    return el;
  }

  controlsPanel(back, overlay = false) {
    if (!overlay) this.clear();
    const groups = { cab: 'Кабина', walk: 'Пешком', global: 'Общие' };
    const render = () => Object.entries(groups).map(([g, name]) => `<tr><td colspan="3" style="padding-top:14px;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:1px">${name}</td></tr>` +
      Object.entries(ACTIONS).filter(([, a]) => a.group === g).map(([k, a]) => `<tr><td>${a.label}</td><td><button class="btn" data-k="${k}" data-d="kb">${esc(keyLabel(input.bind[k].kb[0]))}</button></td><td><button class="btn" data-k="${k}" data-d="pad">${input.bind[k].pad.length ? esc(PAD_NAMES[input.bind[k].pad[0]]) : '—'}</button></td></tr>`).join('')).join('');
    const el = $(`<div class="overlay"><div class="panel"><h2>Управление</h2>
      <p class="note">Нажмите на кнопку и затем клавишу или кнопку геймпада. Delete — снять назначение. Геймпад: левый стик — ходьба, правый — обзор; курки RT/LT — рукоятка контроллера (в настройках можно включить прямое аналоговое управление).</p>
      <table class="binds"><tr><th>Действие</th><th>Клавиатура</th><th>Геймпад</th></tr>${render()}</table>
      <div class="row" style="margin-top:14px"><button class="btn" data-a="reset">Сбросить по умолчанию</button><button class="btn primary" data-a="back">Готово</button></div></div></div>`);
    const wire = () => el.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => {
      b.textContent = '…нажмите';
      input.capture((r) => {
        const k = b.dataset.k, d = b.dataset.d;
        if (r.kb === 'Delete') input.setBinding(k, d, null);
        else if (d === 'kb' && r.kb) input.setBinding(k, 'kb', r.kb);
        else if (d === 'pad' && r.pad != null) input.setBinding(k, 'pad', r.pad);
        el.querySelector('.binds').innerHTML = `<tr><th>Действие</th><th>Клавиатура</th><th>Геймпад</th></tr>${render()}`; wire();
      });
    });
    wire();
    el.querySelector('[data-a=reset]').onclick = () => { input.resetBindings(); el.remove(); this.controlsPanel(back, overlay); };
    el.querySelector('[data-a=back]').onclick = () => { el.remove(); back(); };
    this.root.append(el);
  }

  settingsPanel(back, overlay = false) {
    if (!overlay) this.clear();
    const s = settings;
    const range = (path, label, min, max, step) => {
      const [a, b] = path.split('.'); const v = s[a][b];
      return `<div class="setrow"><span>${label}</span><input type="range" data-p="${path}" min="${min}" max="${max}" step="${step}" value="${v}"><span class="v">${v}</span></div>`;
    };
    const check = (path, label) => { const [a, b] = path.split('.'); return `<div class="setrow"><span>${label}</span><input type="checkbox" data-p="${path}" ${s[a][b] ? 'checked' : ''}><span></span></div>`; };
    const select = (path, label, opts) => { const [a, b] = path.split('.'); return `<div class="setrow"><span>${label}</span><select data-p="${path}">${opts.map(([k, n]) => `<option value="${k}" ${s[a][b] === k ? 'selected' : ''}>${n}</option>`).join('')}</select><span></span></div>`; };
    const el = $(`<div class="overlay"><div class="panel"><h2>Настройки</h2>
      <h3>Графика</h3>
      ${select('graphics.quality', 'Качество', [['low', 'Низкое'], ['medium', 'Среднее'], ['high', 'Высокое'], ['ultra', 'Ультра']])}
      ${check('graphics.shadows', 'Тени')}${check('graphics.bloom', 'Свечение (bloom)')}
      ${range('graphics.viewDistance', 'Дальность прорисовки, м', 800, 3000, 100)}
      ${range('graphics.fov', 'Поле зрения, °', 45, 90, 1)}
      ${range('graphics.pixelRatio', 'Масштаб рендеринга', 0.5, 2, 0.25)}
      <h3>Звук</h3>
      ${range('audio.master', 'Общая громкость', 0, 1, 0.05)}${range('audio.train', 'Поезд', 0, 1, 0.05)}${range('audio.announcements', 'Объявления', 0, 1, 0.05)}${range('audio.ambient', 'Окружение', 0, 1, 0.05)}
      <h3>Управление</h3>
      ${range('controls.mouseSensitivity', 'Чувствительность мыши', 0.2, 3, 0.1)}
      ${range('controls.gamepadLookSensitivity', 'Чувствительность стика', 0.2, 3, 0.1)}
      ${range('controls.leverSpeed', 'Скорость рукоятки', 0.3, 3, 0.1)}
      ${range('controls.triggerDeadzone', 'Мёртвая зона курков', 0, 0.4, 0.01)}
      ${range('controls.stickDeadzone', 'Мёртвая зона стиков', 0, 0.4, 0.01)}
      ${check('controls.invertY', 'Инвертировать ось Y')}
      ${check('controls.analogTriggers', 'Курки напрямую задают тягу/торможение')}
      <h3>Игра</h3>
      ${check('gameplay.vigilance', 'Проверка бдительности (РБ)')}
      ${select('gameplay.hud', 'HUD', [['full', 'Полный'], ['minimal', 'Минимальный'], ['off', 'Выключен']])}
      <p class="note">Часть графических настроек (тени, качество) применяется после перезапуска поездки.</p>
      <div class="row"><button class="btn primary" data-a="back">Готово</button></div></div></div>`);
    el.querySelectorAll('[data-p]').forEach((inp) => {
      const [a, b] = inp.dataset.p.split('.');
      const apply = () => {
        let v = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? +inp.value : inp.value;
        s[a][b] = v;
        const span = inp.parentElement.querySelector('.v'); if (span) span.textContent = v;
        saveSettings(s);
        this.app.applySettings();
      };
      inp.oninput = apply; inp.onchange = apply;
    });
    el.querySelector('[data-a=back]').onclick = () => { el.remove(); back(); };
    this.root.append(el);
  }

  aboutPanel(back) {
    const el = $(`<div class="overlay"><div class="panel"><h2>О проекте и ассетах</h2>
      <p class="note">Движок: three.js (WebGL2, PBR, тени, динамическое небо). Данные станций — OpenStreetMap (Nominatim). Объявления синтезированы Piper TTS (голоса ru_RU dmitri / irina).</p>
      <p class="note"><b>Готовые ассеты:</b> Poly Haven (CC0) — деревья (сосна, ель, лиственное), кустарник, трава, фонари, скамейки, урны, камеры, сетчатое ограждение, автомобили, PBR-текстуры (щебень, бетон, плитка, металл, трава, снег, асфальт). three.js examples — модели людей и анимации (Mixamo).</p>
      <p class="note"><b>Sketchfab (CC-BY, требуется токен):</b> Ласточка, пульт Desiro «Ласточка», ЭД4М, Иволга, панельные дома, турникеты, пешеходный мост — подключены: ${assets.sketchfab.size ? [...assets.sketchfab].join(', ') : 'нет'}.</p>
      <p class="note"><b>Собственная геометрия (честно):</b> рельсы, шпалы, балласт, контактная сеть, светофоры, знаки, платформы, навесы, переходы, павильоны, запасные модели поездов, кабины и панельных домов. Пока модели Sketchfab не скачаны, поезда и кабина — запасные процедурные модели, это не уровень Train Sim World.</p>
      <div class="row"><button class="btn primary" data-a="back">Назад</button></div></div></div>`);
    el.querySelector('[data-a=back]').onclick = () => { el.remove(); back(); };
    this.root.append(el);
  }

  showResults(game) {
    const sc = game.score;
    const gr = sc.grade();
    const rows = sc.stops.map((x) => `<tr><td>${esc(x.station)}</td><td>${x.err >= 0 ? '+' : ''}${x.err.toFixed(1)} м</td><td>${x.dev == null ? '—' : (x.dev > 0 ? '+' : '−') + fmtDev(Math.abs(x.dev))}</td><td>${x.depDev == null ? '—' : (x.depDev > 0 ? '+' : '−') + fmtDev(Math.abs(x.depDev))}</td><td>${x.pts > 0 ? '+' : ''}${x.pts}</td></tr>`).join('');
    const log = sc.log.filter((l) => l.delta < 0).slice(-12).map((l) => `<li>${esc(l.text)} (${l.delta})</li>`).join('');
    const el = $(`<div class="overlay"><div class="panel"><h2>Итоги поездки: ${gr.text}</h2>
      <p>Очки: <b>${Math.round(sc.points)}</b> · Пробег ${(game.sim.odometer / 1000).toFixed(1)} км · Энергия ${game.sim.energyKWh.toFixed(0)} кВт·ч · Превышение скорости ${Math.round(sc.overspeedTime)} с ${gr.note ? '· ' + esc(gr.note) : ''}</p>
      <table class="sched"><tr><th>Станция</th><th>Точность</th><th>Прибытие</th><th>Отправление</th><th>Очки</th></tr>${rows}</table>
      ${log ? `<h3>Замечания</h3><ul class="note">${log}</ul>` : ''}
      <div class="row"><button class="btn primary" data-a="menu">В меню</button></div></div></div>`);
    el.querySelector('[data-a=menu]').onclick = () => { el.remove(); this.app.quitToMenu(); };
    this.root.append(el);
    document.exitPointerLock?.();
  }

  // ── навигация геймпадом по меню ──
  focusFirst(el) { setTimeout(() => el.querySelector('.card.sel, .btn.primary, .card, .btn')?.focus(), 30); }

  menuGamepad() {
    if (!input.pad) return;
    const dirs = [[12, 0, -1], [13, 0, 1], [14, -1, 0], [15, 1, 0]];
    const ax = input.padAxes;
    this.navCd = Math.max(0, (this.navCd || 0) - 1 / 60);
    let dx = 0, dy = 0;
    for (const [b, x, y] of dirs) if ((input.padButtons[b] || 0) > 0.5) { dx = x; dy = y; }
    if (Math.abs(ax[0]) > 0.6) dx = Math.sign(ax[0]);
    if (Math.abs(ax[1]) > 0.6) dy = Math.sign(ax[1]);
    if ((dx || dy) && this.navCd === 0) {
      this.navCd = 0.2;
      const items = [...this.root.querySelectorAll('button, select, tr[tabindex], input')].filter((e) => e.offsetParent);
      const cur = document.activeElement && items.includes(document.activeElement) ? document.activeElement : items[0];
      if (!cur) return;
      const r0 = cur.getBoundingClientRect();
      let best = null, bd = Infinity;
      for (const it of items) {
        if (it === cur) continue;
        const r = it.getBoundingClientRect();
        const vx = r.left + r.width / 2 - (r0.left + r0.width / 2), vy = r.top + r.height / 2 - (r0.top + r0.height / 2);
        if (dx && Math.sign(vx) !== dx) continue;
        if (dy && Math.sign(vy) !== dy) continue;
        const d = Math.hypot(vx, vy) + (dx ? Math.abs(vy) * 2 : Math.abs(vx) * 2);
        if (d < bd) { bd = d; best = it; }
      }
      if (best) { best.focus(); best.scrollIntoView({ block: 'nearest' }); }
    }
    const pressed = (i) => (input.padButtons[i] || 0) > 0.6 && !((input.prevPadButtons[i] || 0) > 0.6);
    if (pressed(0) && document.activeElement) document.activeElement.click();
    if (pressed(1)) this.root.querySelector('[data-act=back], [data-a=back], [data-a=resume]')?.click();
  }
}
