// Оценка поездки: пунктуальность, точность остановки, комфорт, безопасность.
import { fmtTime } from './timetable.js';

export class Score {
  constructor(mode) {
    this.mode = mode;
    this.points = 1000;
    this.log = [];
    this.stops = [];
    this.overspeedTime = 0;
    this.counts = { spad: 0, overspeedPenalty: 0, vigilance: 0, emergency: 0, wrongDoors: 0, doorsMoving: 0, missedStop: 0, harsh: 0 };
    this.comfortTimer = 0;
  }

  add(delta, text) {
    this.points += delta;
    this.log.push({ delta, text });
  }

  event(kind) {
    this.counts[kind] = (this.counts[kind] || 0) + 1;
    const pen = { spad: -300, overspeedPenalty: -60, vigilance: -80, emergency: -40, wrongDoors: -50, missedStop: -150, harsh: -10 }[kind] || 0;
    const txt = { spad: 'Проезд запрещающего сигнала', overspeedPenalty: 'Принудительное торможение КЛУБ', vigilance: 'Не подтверждена бдительность', emergency: 'Экстренное торможение', wrongDoors: 'Двери открыты не с той стороны', missedStop: 'Пропуск остановки', harsh: 'Резкое изменение ускорения' }[kind] || kind;
    if (pen) this.add(pen, txt);
  }

  overspeed(dt, over) {
    this.overspeedTime += dt;
    this.points -= dt * Math.min(10, over) * 0.8;
  }

  comfort(dt, accel, jerk) {
    if (Math.abs(jerk) > 1.6 || Math.abs(accel) > 1.5) {
      this.comfortTimer += dt;
      if (this.comfortTimer > 0.6) { this.comfortTimer = -3; this.event('harsh'); }
    } else this.comfortTimer = Math.max(0, this.comfortTimer - dt);
  }

  // остановка у платформы: err — отклонение от знака остановки (м, + перелёт); dev — отклонение от расписания (с, + опоздание)
  arrival(station, err, dev) {
    let pts = 0;
    const ae = Math.abs(err);
    pts += ae <= 2 ? 30 : ae <= 5 ? 15 : ae <= 15 ? 0 : -40;
    let note = `точность ${err >= 0 ? '+' : ''}${err.toFixed(1)} м`;
    if (dev != null) {
      if (dev <= 30 && dev >= -60) pts += 40;
      else if (dev > 30) pts -= Math.min(150, Math.round(dev / 60 * 25));
      else pts += 10; // приехал раньше — без штрафа, но ждать отправления
      note += `, ${dev >= 0 ? 'опоздание' : 'раньше на'} ${fmtDev(Math.abs(dev))}`;
    }
    this.stops.push({ station: station.name, err, dev, pts });
    this.add(pts, `${station.name}: ${note}`);
  }

  departure(station, dev) {
    if (dev < -10) this.add(-100, `${station.name}: отправление раньше расписания на ${fmtDev(-dev)}`);
    const last = this.stops[this.stops.length - 1];
    if (last && last.station === station.name) last.depDev = dev;
  }

  grade() {
    const p = this.points;
    if (this.counts.spad > 0) return { text: 'Неудовлетворительно', note: 'Проезд запрещающего сигнала' };
    if (p >= 1150) return { text: 'Отлично', note: '' };
    if (p >= 950) return { text: 'Хорошо', note: '' };
    if (p >= 700) return { text: 'Удовлетворительно', note: '' };
    return { text: 'Неудовлетворительно', note: '' };
  }
}

export function fmtDev(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec} с`;
  return `${Math.floor(sec / 60)} мин ${sec % 60} с`;
}
export { fmtTime };
