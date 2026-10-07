// Упрощённая модель КЛУБ-У / АЛС-АРС: допустимая скорость, кривая торможения, контроль бдительности,
// фиксация проезда запрещающего сигнала. Параметры приблизительные.
import { settings } from '../core/settings.js';

const B_CURVE = 0.6; // м/с² — расчётное замедление кривой допустимой скорости
const YELLOW_V = 60; // км/ч на жёлтый (approx)

export class Safety {
  constructor(route, signals, train, score) {
    this.route = route; this.signals = signals; this.train = train; this.score = score;
    this.vAllowed = 120; this.vTarget = 120; this.targetDist = 0; this.targetKind = '';
    this.als = 'Б';
    this.warn = false; this.warnTime = 0;
    this.vigTimer = 70 + Math.random() * 30; this.vigActive = false; this.vigCountdown = 0;
    this.redPermission = null; // разрешение проследовать красный проходной
    this.redStopTimer = 0;
    this.lastPassed = null;
    this.prevFront = train.s;
    this.nextSig = null;
    this.prompt = '';
  }

  pressVigilance() {
    if (this.vigActive) { this.vigActive = false; this.vigTimer = this.vigPeriod(); return true; }
    if (this.redOffer && !this.redPermission) { this.redPermission = this.redOffer; this.train.msg('Разрешено проследовать проходной светофор с запрещающим показанием, не более 20 км/ч'); return true; }
    this.vigTimer = Math.max(this.vigTimer, this.vigPeriod() * 0.5);
    return false;
  }

  vigPeriod() { return this.als === 'З' ? 75 + Math.random() * 25 : 35 + Math.random() * 10; }

  update(dt) {
    const t = this.train, r = this.route;
    const dir = t.dir * (t.reverser < 0 ? -1 : 1);
    const front = t.reverser < 0 ? t.rearS : t.s;
    const kmh = t.speedKmh;

    // текущее ограничение — по всей длине поезда
    let vLim = r.limitRange(t.s, t.rearS);
    vLim = Math.min(vLim, t.spec.maxSpeed);
    // сигнал впереди
    const sig = this.signals.nextSignal(front, dir, 0.5);
    this.nextSig = sig;
    const sigDist = sig ? (sig.s - front) * dir : Infinity;
    this.als = !sig ? 'Б' : sig.aspect === 'green' ? 'З' : sig.aspect === 'yellow' ? 'Ж' : 'КЖ';
    if (this.redPermission && this.redPermission !== sig) {
      // разрешение действует до прохода этого сигнала, после — 20 км/ч до следующего
      if (this.lastPassed === this.redPermission) vLim = Math.min(vLim, 20);
      if (sig && sig !== this.redPermission && this.lastPassed !== this.redPermission) this.redPermission = null;
    }
    if (this.lastPassed && this.lastPassed.aspect === 'red' && this.lastPassed === this.redPermission) vLim = Math.min(vLim, 20);

    // цели кривой торможения
    let vAllowed = vLim; let target = { v: vLim, d: 0, kind: '' };
    const consider = (vt, d, kind) => {
      if (d <= 0) return;
      const vc = Math.sqrt((vt / 3.6) ** 2 + 2 * B_CURVE * Math.max(0, d)) * 3.6;
      if (vc < vAllowed) { vAllowed = vc; }
      if (vt < vLim && (target.kind === '' || d < target.d)) target = { v: vt, d, kind };
    };
    const drop = r.nextLimitDrop(front, dir, vLim, 3500);
    if (drop) consider(drop.v, drop.dist, 'limit');
    if (sig) {
      if (sig.aspect === 'red' && !(this.redPermission === sig)) consider(0, sigDist - 15, 'signal');
      else if (sig.aspect === 'yellow') consider(Math.min(YELLOW_V, vLim), sigDist, 'signal');
      else if (this.redPermission === sig) consider(20, sigDist, 'signal');
    }
    this.vAllowed = Math.max(0, vAllowed);
    this.vLimit = vLim;
    this.vTarget = target.v; this.targetDist = target.d; this.targetKind = target.kind;

    // превышение
    const over = kmh - Math.max(this.vAllowed, 3);
    if (over > 1.5) {
      this.warnTime += dt;
      if (!this.warn) { this.warn = true; t.emit('klubWarn'); }
      if ((over > 5 || this.warnTime > 4) && !t.penaltyBrake) {
        t.penaltyBrake = true; t.emit('penalty');
        t.msg('КЛУБ: принудительное торможение из-за превышения скорости');
        this.score?.event('overspeedPenalty');
      }
      this.score?.overspeed(dt, over);
    } else {
      this.warn = false; this.warnTime = 0;
    }
    if (t.penaltyBrake && kmh < this.vAllowed - 3 && (t.spec.controller !== 'combined' || t.lever <= 0)) t.penaltyBrake = false;
    if (t.penaltyBrake && kmh < 0.3) t.penaltyBrake = false;

    // проезд сигналов
    for (const sg of this.signals.lists[dir]) {
      const before = (sg.s - this.prevFront) * dir, after = (sg.s - front) * dir;
      if (before > 0 && after <= 0) {
        this.lastPassed = sg;
        if (sg.aspect === 'red' && this.redPermission !== sg) {
          t.applyEmergency();
          t.msg(`Проезд запрещающего сигнала ${sg.name}!`);
          t.emit('spad');
          this.score?.event('spad');
        }
      }
    }
    this.prevFront = front;

    // остановка у красного проходного → предложение проследовать
    this.redOffer = null; this.prompt = '';
    if (sig && sig.aspect === 'red' && sig.kind === 'block' && sigDist < 250 && kmh < 0.5) {
      this.redStopTimer += dt;
      if (this.redStopTimer > 30 && this.redPermission !== sig) {
        this.redOffer = sig;
        this.prompt = 'Стоянка у красного проходного: нажмите РБ, чтобы проследовать со скоростью не более 20 км/ч';
      }
    } else this.redStopTimer = 0;

    // бдительность
    if (settings.gameplay.vigilance && kmh > 5) {
      if (!this.vigActive) {
        this.vigTimer -= dt;
        if (this.vigTimer <= 0) { this.vigActive = true; this.vigCountdown = 7; t.emit('vigilance'); }
      } else {
        this.vigCountdown -= dt;
        if (this.vigCountdown <= 0) {
          this.vigActive = false; this.vigTimer = this.vigPeriod();
          t.applyEmergency(); t.msg('Не подтверждена бдительность — экстренное торможение');
          this.score?.event('vigilance');
        }
      }
    } else if (this.vigActive && kmh <= 5) { this.vigActive = false; this.vigTimer = this.vigPeriod(); }
  }
}
