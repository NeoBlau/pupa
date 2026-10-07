// Кабина машиниста: пульт с действующими приборами (дисплеи на canvas, обновляются в реальном времени),
// рукоятки контроллера / крана, кнопки, стеклоочистители. Если скачана модель Sketchfab (es2g_cab),
// она устанавливается вместо процедурного пульта; дисплеи и рукоятки остаются функциональными.
import * as THREE from 'three';
import { assets } from '../core/assets.js';
import { ED4M_KM, KRAN395 } from '../data/trains.js';
import { fmtTime } from '../sim/timetable.js';
import { instantiate, carveParts } from '../core/realModels.js';

const FONT = '"Segoe UI", "Roboto", Arial, sans-serif';
const MONO = '"Consolas", "Courier New", monospace';

function screen(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { c, g: c.getContext('2d'), t };
}

export class Cab {
  constructor(spec) {
    this.spec = spec;
    this.group = new THREE.Group();
    this.eye = new THREE.Vector3();
    this.buttons = {};
    this.wiperT = 0;
    this.lastDraw = 0;
  }

  // Кабина: реальная модель (Sketchfab) с подменой экранов на живые дисплеи, либо запасной пульт
  async build(car, model) {
    this.main = screen(640, 400);
    this.side = screen(512, 320);
    this.klub = screen(512, 256);
    this.buttons = {}; this.wipers = [];
    const real = model?.real;
    if (real && real.cab && car.userData.real) return this.buildRealES2G(car, real);
    if (real && real.cfg.cabInModel && car.userData.real) return this.buildInModel(car, real);
    return this.buildProcedural(car);
  }

  buildRealES2G(car, real) {
    const c = real.cab, piece = car.userData.piece;
    const g = this.group;
    g.clear();
    const cabModel = instantiate(c.parts, { cast: false });
    g.add(cabModel);
    // нос головного вагона — минимальный z детали; пульт вплотную к лобовому стеклу
    const z0 = piece.box.min.z + c.frontInset + 0.72;
    g.position.set(0, c.floor, z0);
    g.rotation.set(0, 0, 0);
    car.userData.inner.add(g);
    this.eye.set(c.eye[0], c.eye[1], -c.eye[2]);
    // экраны пульта → живые дисплеи
    const map = { Display_HMI: this.main, Display_SLUC: this.klub, Display_CCTV: this.side };
    cabModel.traverse((o) => {
      if (!o.isMesh) return;
      for (const [k, scr] of Object.entries(map)) if (o.name.includes(k)) o.material = new THREE.MeshBasicMaterial({ map: scr.t, toneMapped: false });
    });
    this.lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2dc, emissiveIntensity: 0 });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.25), this.lightMat); lamp.position.set(0, 2.15, 1.0); g.add(lamp);
    this.cabLight = new THREE.PointLight(0xfff2dc, 0, 4); this.cabLight.position.set(0, 1.9, 0.8); g.add(this.cabLight);
    // вид из кабины: копия головного вагона с вырезанными лобовым и боковыми окнами кабины
    const nz = piece.box.min.z, eyeY = c.floor + c.eye[1];
    const carved = instantiate(carveParts(piece.parts, (x, y, z) =>
      (z < nz + 3.4 && y > eyeY - 0.45 && y < eyeY + 1.25) || (z < nz + 5.2 && y > eyeY - 0.3 && y < eyeY + 0.75 && Math.abs(x) > 1.25)), { cast: false });
    carved.visible = false;
    car.userData.inner.add(carved);
    this.carved = carved;
    this.hideInCab = car.userData.inner.children.filter((o) => o.isMesh);
    this.realCab = true;
    return this;
  }

  buildInModel(car, real) {
    const piece = car.userData.piece;
    const g = this.group;
    g.clear();
    g.position.set(0, 0, 0);
    car.userData.inner.add(g);
    const e = new THREE.Vector3(...real.cfg.cabInModel.eye).applyMatrix4(piece.matrix);
    this.eye.copy(e);
    // блок КЛУБ-У и дисплей на пульте (дооснащение ЭД4М)
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.6 });
    const mk = (scr, w, h, x, y, z, rx) => {
      const grp = new THREE.Group(); grp.position.set(e.x + x, e.y + y, e.z + z); grp.rotation.x = rx;
      const box = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.08), dark); box.position.z = -0.045; grp.add(box);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: scr.t, toneMapped: false })); grp.add(m);
      g.add(grp);
    };
    mk(this.klub, 0.28, 0.14, 0.05, -0.42, -0.62, -0.5);
    mk(this.main, 0.3, 0.19, -0.3, -0.48, -0.6, -0.6);
    mk(this.side, 0.26, 0.16, 0.36, -0.48, -0.6, -0.6);
    this.lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2dc, emissiveIntensity: 0 });
    this.cabLight = new THREE.PointLight(0xfff2dc, 0, 4); this.cabLight.position.set(e.x, e.y + 0.6, e.z); g.add(this.cabLight);
    this.hideInCab = [];
    this.realCab = true;
    return this;
  }

  setInside(inside) {
    for (const o of this.hideInCab || []) o.visible = !inside;
    if (this.carved) this.carved.visible = inside;
  }

  async buildProcedural(car) {
    const spec = this.spec;
    const off = car.userData.cabOffset ?? -spec.carLength / 2;
    const g = this.group;
    g.position.z = off;
    car.add(g);
    const FL = spec.floorHeight;
    const right = spec.controller === 'separate'; // ЭД4М: место машиниста справа
    const cx = right ? 0.55 : 0;
    this.eye.set(cx, FL + 1.27, -0.35);

    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.75, metalness: 0.1 });
    const panel = new THREE.MeshStandardMaterial({ color: spec.controller === 'separate' ? 0x5e6e64 : 0x3a3f46, roughness: 0.6, metalness: 0.15 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xbfc4c8, roughness: 0.4, metalness: 0.6 });
    const wall = new THREE.MeshStandardMaterial({ color: spec.controller === 'separate' ? 0x8fa596 : 0xd9dcde, roughness: 0.7 });
    this.lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2dc, emissiveIntensity: 0 });

    const ext = await assets.sketch(spec.models.cab);
    if (ext) {
      // внешний пульт: подгоняем по ширине кабины, ставим перед машинистом
      const root = ext.scene.clone(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const k = 2.9 / Math.max(size.x, size.z);
      root.scale.setScalar(k);
      const b2 = new THREE.Box3().setFromObject(root);
      root.position.set(-(b2.min.x + b2.max.x) / 2, FL - b2.min.y, -1.2 - (b2.min.z + b2.max.z) / 2);
      g.add(root);
      this.externalConsole = true;
    } else {
      // пульт: наклонная панель + стол
      const desk = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.85, 0.75), dark);
      desk.position.set(0, FL + 0.5, -1.3); g.add(desk);
      const slope = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.06, 0.8), panel);
      slope.position.set(0, FL + 1.0, -1.45); slope.rotation.x = 0.55; g.add(slope);
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.05, 0.45), panel);
      top.position.set(0, FL + 0.95, -0.95); g.add(top);
    }
    // стены/потолок кабины (видны изнутри)
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.6), wall); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, FL + 2.25, -0.6); g.add(ceil);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.3), wall); back.position.set(0, FL + 1.15, 0.45); back.rotation.y = Math.PI; g.add(back);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.95), trim); door.position.set(right ? -0.7 : 0.9, FL + 0.98, 0.44); door.rotation.y = Math.PI; g.add(door);
    for (const sx of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.12), dark);
      pillar.position.set(sx * 1.3, FL + 1.6, -1.65); pillar.rotation.z = sx * 0.1; g.add(pillar);
      const sideLow = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.0), wall); sideLow.position.set(sx * 1.6, FL + 0.5, -0.6); sideLow.rotation.y = -sx * Math.PI / 2; g.add(sideLow);
    }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.25), this.lightMat); lamp.position.set(0, FL + 2.22, -0.3); g.add(lamp);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.25), new THREE.MeshStandardMaterial({ color: 0x223322, transparent: true, opacity: 0.6 }));
    visor.position.set(cx, FL + 2.0, -1.5); visor.rotation.x = -0.4; g.add(visor);
    // кресло
    const seat = new THREE.Group();
    const sm = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.9 });
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.5), sm); s1.position.y = FL + 0.55; seat.add(s1);
    const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.1), sm); s2.position.set(0, FL + 0.95, 0.27); s2.rotation.x = -0.12; seat.add(s2);
    seat.position.set(cx, 0, 0.0); g.add(seat);

    // ── дисплеи ──
    const mkScreen = (s, w, h, pos, rx = 0.55) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: s.t, toneMapped: false }));
      m.position.copy(pos); m.rotation.x = -rx; g.add(m);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, h + 0.04, 0.03), dark); frame.position.copy(pos); frame.rotation.x = -rx; frame.translateZ(-0.02); g.add(frame);
      return m;
    };
    const dz = this.externalConsole ? -1.05 : -1.33;
    const dy = FL + (this.externalConsole ? 1.12 : 1.13);
    mkScreen(this.main, 0.42, 0.26, new THREE.Vector3(cx - 0.27, dy, dz));
    mkScreen(this.side, 0.34, 0.21, new THREE.Vector3(cx + 0.24, dy, dz));
    mkScreen(this.klub, 0.3, 0.15, new THREE.Vector3(cx + 0.0, dy + 0.21, dz - 0.14), 0.25);

    // ── органы управления ──
    const knob = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xc8a14a, roughness: 0.35, metalness: 0.6 });
    const ctrlBase = new THREE.Vector3(cx + (right ? -0.35 : 0.45), FL + 0.98, -0.82);
    this.lever = new THREE.Group(); this.lever.position.copy(ctrlBase); g.add(this.lever);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.24), trim); shaft.position.y = 0.12; this.lever.add(shaft);
    const grip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), knob); grip.position.y = 0.25; this.lever.add(grip);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.36), dark); slot.position.copy(ctrlBase); g.add(slot);
    if (spec.controller === 'separate') {
      // кран №395 слева от машиниста
      this.kran = new THREE.Group(); this.kran.position.set(cx - 0.55, FL + 0.98, -0.8); g.add(this.kran);
      const kb = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.08, 20), trim); this.kran.add(kb);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.025, 0.26), handleMat); arm.position.set(0, 0.06, 0.13); this.kranArm = new THREE.Group(); this.kranArm.position.y = 0.04; this.kranArm.add(arm); this.kran.add(this.kranArm);
      const kk = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), knob); kk.position.set(0, 0.07, 0.26); this.kranArm.add(kk);
    }
    // кнопки
    const btn = (name, color, x, z, r = 0.022) => {
      const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.05, roughness: 0.4 });
      const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.02, 16), m);
      b.position.set(cx + x, FL + 0.98, z); g.add(b);
      this.buttons[name] = { mesh: b, mat: m };
    };
    btn('doorsLeft', 0x22cc44, -0.85, -0.85); btn('doorsRight', 0x22cc44, 0.85, -0.85);
    btn('doorsClose', 0xdd2222, -0.75, -0.85); btn('doorsClose2', 0xdd2222, 0.75, -0.85);
    btn('vigilance', 0xffcc00, (right ? 0.25 : -0.2), -0.75, 0.035);
    btn('horn', 0x888888, 0.0, -0.95); btn('panto', 0x3388ff, 0.6, -1.05); btn('lights', 0xffffff, 0.68, -1.05);

    // стеклоочистители
    this.wipers = [];
    for (const x of [-0.6, 0.6]) {
      const w = new THREE.Group(); w.position.set(x, FL + 1.02, -1.95); g.add(w);
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.85, 0.02), knob); a.position.y = 0.42; w.add(a);
      const base = -1.45 * Math.sign(x);
      w.rotation.z = base; this.wipers.push({ g: w, base });
    }
    return this;
  }

  setLight(on) { this.lightMat.emissiveIntensity = on ? 1.5 : 0; if (this.cabLight) this.cabLight.intensity = on ? 2.5 : 0; }

  update(dt, sim, safety, info) {
    const spec = this.spec;
    // рукоятки
    if (!this.lever) { /* у реальной модели рукоятки не отделены */ }
    else if (spec.controller === 'combined') this.lever.rotation.x = -sim.lever * 0.6;
    else {
      this.lever.rotation.x = -(sim.km / (ED4M_KM.length - 1)) * 0.9;
      if (this.kranArm) this.kranArm.rotation.y = -0.9 + sim.kran * 0.3;
    }
    // стеклоочистители
    if (sim.wipers > 0) {
      this.wiperT += dt * (sim.wipers === 1 ? 1.4 : 2.4);
      const ph = (Math.sin(this.wiperT * Math.PI) + 1) / 2;
      for (const w of this.wipers) w.g.rotation.z = w.base * (1 - ph) + Math.sign(w.base) * 0.1 * ph;
    }
    // подсветка кнопок
    const B = this.buttons;
    const lit = (b, on) => { if (b) b.mat.emissiveIntensity = on ? 1.6 : 0.06; };
    lit(B.doorsLeft, sim.doorsTarget.left > 0); lit(B.doorsRight, sim.doorsTarget.right > 0);
    lit(B.doorsClose, sim.doorsClosed); lit(B.doorsClose2, sim.doorsClosed);
    lit(B.vigilance, safety.vigActive && Math.floor(performance.now() / 300) % 2 === 0);
    lit(B.panto, sim.pantograph); lit(B.lights, sim.headlights);

    this.lastDraw += dt;
    if (this.lastDraw < 0.1) return;
    this.lastDraw = 0;
    this.drawMain(sim, safety, info);
    this.drawSide(sim, info);
    this.drawKlub(sim, safety);
  }

  drawMain(sim, safety, info) {
    const { g, c, t } = this.main; const W = c.width, H = c.height;
    g.fillStyle = '#0a0f14'; g.fillRect(0, 0, W, H);
    const v = sim.speedKmh;
    // дуговая шкала скорости
    const cx = 200, cy = 210, R = 160, vmax = this.spec.maxSpeed > 130 ? 160 : 140;
    const ang = (x) => Math.PI * 0.75 + (x / vmax) * Math.PI * 1.5;
    g.lineWidth = 14; g.strokeStyle = '#1e2a33'; g.beginPath(); g.arc(cx, cy, R, ang(0), ang(vmax)); g.stroke();
    g.strokeStyle = '#d23a2a'; g.beginPath(); g.arc(cx, cy, R, ang(Math.min(vmax, safety.vAllowed)), ang(vmax)); g.stroke();
    g.strokeStyle = '#3fb7ff'; g.beginPath(); g.arc(cx, cy, R, ang(0), ang(Math.min(v, vmax))); g.stroke();
    g.fillStyle = '#9fb3c2'; g.font = `20px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let x = 0; x <= vmax; x += 20) { const a = ang(x); g.fillText(String(x), cx + Math.cos(a) * (R - 32), cy + Math.sin(a) * (R - 32)); }
    g.fillStyle = '#fff'; g.font = `bold 84px ${MONO}`; g.fillText(String(Math.round(v)), cx, cy - 6);
    g.font = `22px ${FONT}`; g.fillStyle = '#9fb3c2'; g.fillText('км/ч', cx, cy + 46);
    g.fillStyle = '#ffd04a'; g.font = `bold 30px ${MONO}`; g.fillText(`${Math.round(safety.vAllowed)}`, cx, cy + 92);
    // правая колонка
    g.textAlign = 'left'; g.font = `22px ${FONT}`;
    const x0 = 400;
    const row = (lab, val, y, col = '#e8f2f8') => { g.fillStyle = '#7f95a3'; g.fillText(lab, x0, y); g.fillStyle = col; g.font = `bold 26px ${MONO}`; g.fillText(val, x0, y + 28); g.font = `22px ${FONT}`; };
    const trac = sim.tractionForce / 1000, brk = sim.brakeForce / 1000;
    row('Тяга / торм., кН', `${Math.round(trac)} / ${Math.round(brk)}`, 30);
    row('Ограничение', `${safety.vLimit ?? '—'} км/ч`, 95);
    row('Цель', safety.targetKind ? `${Math.round(safety.vTarget)} через ${Math.round(safety.targetDist)} м` : '—', 160, '#ffd04a');
    row('Следующая', info.nextName || '—', 225);
    row('До станции', info.nextDist != null ? `${(info.nextDist / 1000).toFixed(2)} км` : '—', 290);
    g.fillStyle = '#7f95a3'; g.fillText(fmtTime(info.time, true), 14, 26);
    if (sim.interlockReason) { g.fillStyle = '#ff7a3a'; g.font = `20px ${FONT}`; g.fillText(sim.interlockReason, 14, H - 18); }
    t.needsUpdate = true;
  }

  drawSide(sim, info) {
    const { g, c, t } = this.side; const W = c.width, H = c.height;
    g.fillStyle = '#0b1210'; g.fillRect(0, 0, W, H);
    g.font = `22px ${FONT}`; g.textBaseline = 'middle';
    const bar = (lab, val, max, y, col) => {
      g.fillStyle = '#86a89a'; g.textAlign = 'left'; g.fillText(lab, 14, y);
      g.fillStyle = '#1f2b27'; g.fillRect(190, y - 12, 230, 24);
      g.fillStyle = col; g.fillRect(190, y - 12, 230 * Math.max(0, Math.min(1, val / max)), 24);
      g.fillStyle = '#fff'; g.textAlign = 'right'; g.fillText(val.toFixed(1), W - 14, y);
    };
    bar('ТЦ, бар', sim.brakeCyl, 4.5, 30, '#ff6b4a');
    bar('ТМ, бар', sim.brakePipe, 6, 70, '#4ad0ff');
    bar('ГР, бар', sim.mainRes, 10, 110, '#a0e070');
    bar('Тяга, %', sim.tractionEffort * 100, 100, 150, '#ffd04a');
    g.textAlign = 'left'; g.fillStyle = '#86a89a';
    const ctrl = this.spec.controller === 'combined'
      ? (sim.lever > 0 ? `Х ${Math.round(sim.lever * 100)}%` : sim.lever < 0 ? `Т ${Math.round(-sim.lever * 100)}%` : '0')
      : `КМ ${ED4M_KM[sim.km].name} · Кран ${KRAN395[sim.kran].name}`;
    g.fillText(`Контроллер: ${ctrl}`, 14, 195);
    g.fillText(`Реверсор: ${sim.reverser > 0 ? 'Вперёд' : sim.reverser < 0 ? 'Назад' : '0'}`, 14, 228);
    const doorTxt = sim.doorsClosed ? 'закрыты' : `${sim.doorsTarget.left ? 'Л ' : ''}${sim.doorsTarget.right ? 'П ' : ''}открыты`;
    g.fillStyle = sim.doorsClosed ? '#7fe08a' : '#ffb04a'; g.fillText(`Двери: ${doorTxt}`, 14, 261);
    g.fillStyle = sim.pantograph ? '#7fe08a' : '#ff6b4a';
    g.fillText(`Токоприёмник: ${sim.pantograph ? 'поднят · 3.0 кВ' : 'опущен'}`, 14, 294);
    t.needsUpdate = true;
  }

  drawKlub(sim, safety) {
    const { g, c, t } = this.klub; const W = c.width, H = c.height;
    g.fillStyle = '#121212'; g.fillRect(0, 0, W, H);
    const lamps = [['З', '#22e26a'], ['Ж', '#ffcc22'], ['КЖ', '#ff7722'], ['К', '#ff2a1a'], ['Б', '#eef']];
    lamps.forEach(([n, col], i) => {
      const on = safety.als === n;
      g.fillStyle = on ? col : '#2a2a2a';
      g.beginPath(); g.arc(40 + i * 62, 50, 24, 0, Math.PI * 2); g.fill();
      g.fillStyle = on ? '#000' : '#666'; g.font = `bold 20px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(n, 40 + i * 62, 51);
    });
    g.fillStyle = '#7cf'; g.font = `bold 46px ${MONO}`; g.textAlign = 'left';
    g.fillText(String(Math.round(sim.speedKmh)).padStart(3, ' '), 340, 52);
    g.fillStyle = '#ffd04a'; g.font = `bold 30px ${MONO}`;
    g.fillText(`Vдоп ${Math.round(safety.vAllowed)}`, 20, 120);
    if (safety.nextSig) { g.fillStyle = '#ccc'; g.fillText(`${safety.nextSig.name}: ${Math.round((safety.nextSig.s - sim.s) * sim.dir)} м`, 20, 170); }
    if (safety.vigActive) { g.fillStyle = Math.floor(performance.now() / 250) % 2 ? '#ff3' : '#a80'; g.font = `bold 34px ${FONT}`; g.fillText('БДИТЕЛЬНОСТЬ!', 20, 220); }
    else if (safety.warn) { g.fillStyle = '#f43'; g.font = `bold 34px ${FONT}`; g.fillText('ПРЕВЫШЕНИЕ', 20, 220); }
    t.needsUpdate = true;
  }
}
