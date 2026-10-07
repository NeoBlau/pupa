// Физика и органы управления электропоезда.
// Положение: s — пикетаж (м) переднего (ведущего) конца поезда по оси линии; dir — направление «вперёд» кабины (+1/−1).
import { ED4M_KM } from '../data/trains.js';

const G = 9.81;

export class TrainSim {
  constructor(spec, cars, { s = 0, dir = 1, loadFactor = 0.6 } = {}) {
    this.spec = spec;
    this.cars = cars;
    this.length = spec.carLength * cars;
    this.mass = (spec.tareMassPerCar + spec.loadMassPerCar * loadFactor) * cars * 1000; // кг
    this.massEq = this.mass * 1.08; // с учётом вращающихся масс
    this.maxForce = spec.maxForcePerCar * cars * 1000; // Н
    this.maxPower = spec.powerPerCar * cars * 1000; // Вт
    this.s = s;
    this.dir = dir;
    this.v = 0; // м/с, + вперёд по кабине
    this.a = 0;
    this.jerk = 0;
    // органы управления
    this.lever = 0; // единая рукоятка: −1 (полное служебное) … +1 (полная тяга)
    this.km = 0; // ЭД4М: позиция КМ
    this.kran = 1; // ЭД4М: положение крана 395 (индекс), II — поездное
    this.reverser = 0; // −1 назад, 0, +1 вперёд
    this.emergency = false;
    this.pantograph = true;
    this.headlights = true;
    this.cabLight = false;
    this.wipers = 0;
    // состояние систем
    this.tractionEffort = 0; // фактическая доля силы тяги (с ограничением рывка)
    this.edBrake = 0; // доля электрического торможения
    this.brakeCyl = 0; // давление в ТЦ, бар (0…3.8, экстренное до 4.2)
    this.brakePipe = 5.0; // давление в ТМ, бар
    this.mainRes = 8.5; // главный резервуар
    this.compressorOn = false;
    this.doors = { left: 0, right: 0 }; // 0 закрыты … 1 открыты
    this.doorsTarget = { left: 0, right: 0 };
    this.doorWarnUntil = 0;
    this.tractionForce = 0;
    this.brakeForce = 0;
    this.odometer = 0;
    this.energyKWh = 0;
    this.messages = [];
    this.interlockReason = '';
    this.penaltyBrake = false; // принудительное торможение от системы безопасности
    this.events = []; // для звука: 'doorsOpen', 'doorsClose', 'brakeRelease', 'contactor' …
  }

  get speedKmh() { return Math.abs(this.v) * 3.6; }
  get doorsClosed() { return this.doors.left === 0 && this.doors.right === 0 && this.doorsTarget.left === 0 && this.doorsTarget.right === 0; }
  get rearS() { return this.s - this.dir * this.length; }

  emit(e) { this.events.push(e); }

  // ── органы управления ──
  moveLever(delta) {
    if (this.spec.controller === 'combined') {
      const prev = this.lever;
      this.lever = Math.max(-1, Math.min(1, this.lever + delta));
      // фиксация нуля при переходе через нейтраль
      if ((prev > 0 && this.lever < 0) || (prev < 0 && this.lever > 0)) this.lever = 0;
      if (Math.abs(this.lever) < 1e-6) this.lever = 0;
    }
  }
  setLever(v) { if (this.spec.controller === 'combined') this.lever = Math.max(-1, Math.min(1, v)); }
  kmStep(d) {
    const n = Math.max(0, Math.min(ED4M_KM.length - 1, this.km + d));
    if (n !== this.km) { this.km = n; this.emit('contactor'); }
  }
  kranStep(d) {
    const n = Math.max(0, Math.min(6, this.kran + d));
    if (n !== this.kran) { this.kran = n; this.emit('kran'); }
  }
  setReverser(r) {
    if (Math.abs(this.v) > 0.3 && r !== this.reverser) { this.msg('Реверсор переключается только на стоянке'); return; }
    if (r !== this.reverser) { this.reverser = r; this.emit('reverser'); }
  }
  applyEmergency() {
    if (!this.emergency) { this.emergency = true; this.emit('emergency'); }
    if (this.spec.controller === 'separate') this.kran = 6;
  }
  openDoors(side) {
    if (this.speedKmh > 0.5) { this.msg('Двери открываются только после полной остановки'); return false; }
    if (this.doorsTarget[side] === 1) return false;
    this.doorsTarget[side] = 1;
    this.emit('doorsOpen');
    return true;
  }
  closeDoors() {
    if (this.doorsTarget.left === 0 && this.doorsTarget.right === 0) return false;
    this.doorsTarget.left = 0; this.doorsTarget.right = 0;
    this.emit('doorsClose');
    return true;
  }
  msg(t) { this.messages.push(t); }

  // Смена кабины: «голова» становится «хвостом»
  changeEnds() {
    if (this.speedKmh > 0.1) { this.msg('Смена кабины возможна только на стоянке'); return false; }
    this.s = this.rearS;
    this.dir = -this.dir;
    this.reverser = 0;
    this.lever = -0.6;
    this.km = 0;
    this.emergency = false;
    return true;
  }

  // ── шаг физики ──
  // grade: уклон в ‰ по возрастанию пикетажа; curveR: радиус кривой (м) или Infinity
  update(dt, grade = 0, curveR = Infinity) {
    const spec = this.spec;
    const vAbs = Math.abs(this.v);
    const kmh = vAbs * 3.6;

    // двери
    for (const side of ['left', 'right']) {
      const t = this.doorsTarget[side];
      const d = this.doors[side];
      if (d !== t) this.doors[side] = t > d ? Math.min(t, d + dt / 2.6) : Math.max(t, d - dt / 3.0);
    }

    // желаемая тяга и торможение
    let tracDemand = 0, brakeDemand = 0;
    if (spec.controller === 'combined') {
      if (this.lever > 0) tracDemand = this.lever;
      else brakeDemand = -this.lever;
    } else {
      const pos = ED4M_KM[this.km];
      tracDemand = pos.force;
      if (pos.vmax && kmh > pos.vmax) tracDemand = 0;
    }

    // блокировки тяги
    this.interlockReason = '';
    if (!this.doorsClosed || this.doors.left > 0 || this.doors.right > 0) this.interlockReason = 'Двери не закрыты';
    else if (this.reverser === 0) this.interlockReason = 'Реверсор в нейтрали';
    else if (!this.pantograph) this.interlockReason = 'Токоприёмник опущен';
    else if (this.emergency) this.interlockReason = 'Экстренное торможение';
    else if (this.penaltyBrake) this.interlockReason = 'Принудительное торможение';
    else if (brakeDemand > 0 || this.brakeCyl > 0.4) this.interlockReason = tracDemand > 0 ? 'Тормоза не отпущены' : '';
    const tracAllowed = !this.interlockReason || this.interlockReason === '';
    if (!tracAllowed) tracDemand = 0;
    if (tracDemand > 0 && this.v * this.reverser < -0.3) tracDemand = 0; // движение против реверсора

    // ограничение рывка (плавный набор тяги)
    const jerkRate = spec.controller === 'combined' ? 0.55 : 0.9;
    if (this.tractionEffort < tracDemand) this.tractionEffort = Math.min(tracDemand, this.tractionEffort + jerkRate * dt);
    else this.tractionEffort = Math.max(tracDemand, this.tractionEffort - 1.2 * dt);

    // сила тяги: ограничение по силе и по мощности
    const fMax = Math.min(this.maxForce, this.maxPower / Math.max(vAbs, 0.5));
    let Ft = this.tractionEffort * fMax;
    if (kmh > spec.maxSpeed) Ft = 0;
    this.tractionForce = Ft;
    this.energyKWh += (Ft * vAbs * dt) / 3.6e6 / 0.88;

    // тормоза
    let targetCyl;
    if (spec.controller === 'combined') {
      targetCyl = brakeDemand * 3.8;
      if (this.emergency) targetCyl = 4.2;
      if (this.penaltyBrake) targetCyl = Math.max(targetCyl, 3.0);
      // электрическое торможение замещает пневматику на скорости > 7 км/ч
      const edAvail = spec.electricBrake && this.pantograph && kmh > 7 && !this.emergency ? 1 : 0;
      const edTarget = edAvail * targetCyl / 3.8;
      this.edBrake += (Math.min(1, edTarget) - this.edBrake) * Math.min(1, dt / 0.4);
      const pneuTarget = Math.max(0, targetCyl - this.edBrake * 3.8);
      const tc = pneuTarget > this.brakeCyl ? spec.brakeTimeConst : spec.brakeTimeConst * 1.5;
      this.brakeCyl += (pneuTarget - this.brakeCyl) * Math.min(1, dt / tc);
      this.brakePipe = 5.0 - Math.min(1.5, (this.brakeCyl + this.edBrake * 3.8) / 2.5);
    } else {
      // кран №395
      const rates = [+1.2, +0.35, 0, 0, -0.18, -0.06, -1.6];
      const r = rates[this.kran];
      if (this.emergency) this.kran = 6;
      if (r > 0) this.brakePipe = Math.min(this.kran === 0 ? 5.6 : 5.0, this.brakePipe + r * dt);
      else if (r < 0) this.brakePipe = Math.max(this.kran === 6 ? 0 : 3.4, this.brakePipe + r * dt);
      else if (this.kran === 3) this.brakePipe = Math.max(0, this.brakePipe - 0.004 * dt); // утечки без питания
      if (this.kran === 1 && this.brakePipe > 5.0) this.brakePipe = Math.max(5.0, this.brakePipe - 0.08 * dt); // ликвидация сверхзарядки
      targetCyl = Math.max(0, Math.min(this.kran === 6 ? 4.2 : 3.8, (5.0 - this.brakePipe) * 2.5));
      if (this.penaltyBrake) targetCyl = Math.max(targetCyl, 3.0);
      const tc = targetCyl > this.brakeCyl ? spec.brakeTimeConst : spec.brakeTimeConst * 1.6;
      this.brakeCyl += (targetCyl - this.brakeCyl) * Math.min(1, dt / tc);
      this.edBrake = 0;
    }
    if (this.brakeCyl < 0.01) this.brakeCyl = 0;

    // компрессор
    this.mainRes -= (this.brakeCyl > 0.1 ? 0.02 : 0.004) * dt;
    if (this.mainRes < 7.5) this.compressorOn = true;
    if (this.mainRes > 9.0) this.compressorOn = false;
    if (this.compressorOn && this.pantograph) this.mainRes += 0.12 * dt;

    const decelCyl = this.brakeCyl / 3.8;
    const brakeDecel = (this.emergency ? spec.emergencyDecel * Math.min(1, this.brakeCyl / 4.2) : spec.serviceDecel * Math.min(1.1, decelCyl))
      + this.edBrake * spec.serviceDecel;
    let Fb = brakeDecel * this.mass;
    this.brakeForce = Fb;

    // сопротивление движению (основное, Н/кН → Н) + уклон + кривая
    const w0 = 1.1 + 0.011 * kmh + 0.00022 * kmh * kmh;
    let Fr = (w0 * this.mass * G) / 1000;
    if (isFinite(curveR) && curveR > 50) Fr += ((700 / curveR) * this.mass * G) / 1000;
    const Fg = (grade / 1000) * this.mass * G * this.dir; // положительно — подъём по ходу кабины

    // итоговое ускорение
    const sign = this.reverser !== 0 ? this.reverser : Math.sign(this.v) || 1;
    let F = Ft * sign - Fg;
    // сопротивление и тормоз направлены против движения
    const resist = Fr + Fb;
    let a;
    if (vAbs < 0.02) {
      // стоим: тормоз/сопротивление удерживают, если хватает
      if (Math.abs(F) <= resist) { a = 0; this.v = 0; }
      else a = (F - Math.sign(F) * resist) / this.massEq;
    } else {
      a = (F - Math.sign(this.v) * resist) / this.massEq;
    }
    const vNew = this.v + a * dt;
    if (vAbs >= 0.02 && Math.sign(vNew) !== Math.sign(this.v) && Math.abs(F) <= resist) { this.v = 0; a = 0; }
    else this.v = vNew;
    this.jerk = (a - this.a) / Math.max(dt, 1e-3);
    this.a = a;

    const ds = this.v * dt;
    this.s += ds * this.dir;
    this.odometer += Math.abs(ds);

    if (this.emergency && Math.abs(this.v) < 0.05 && this.spec.controller === 'combined' && this.lever <= -0.99) {
      // после остановки экстренное отпускается переводом рукоятки в положение полного торможения
    }
  }

  releaseEmergency() {
    if (!this.emergency) return;
    if (Math.abs(this.v) > 0.05) { this.msg('Экстренное торможение отпускается после остановки'); return; }
    this.emergency = false;
    if (this.spec.controller === 'separate') this.kran = 4;
    else this.lever = -1;
    this.emit('brakeRelease');
  }
}
