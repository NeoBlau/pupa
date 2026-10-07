// Ввод: клавиатура, мышь, геймпад (стандартная раскладка Xbox/PlayStation).
// Все действия переназначаемы; переопределения хранятся в settings.controls.bindings.
import { settings, saveSettings } from './settings.js';

// Индексы кнопок стандартного геймпада (W3C Gamepad "standard" mapping)
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};
export const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back/View', 'Start/Menu', 'L3', 'R3', 'Крестовина ↑', 'Крестовина ↓', 'Крестовина ←', 'Крестовина →', 'Home'];

// group: cab — в кабине, walk — пешком, global — всегда
export const ACTIONS = {
  throttleUp:    { label: 'Контроллер: тяга + / торможение −', group: 'cab', kb: ['KeyW'], pad: [PAD.RT] },
  throttleDown:  { label: 'Контроллер: тяга − / торможение +', group: 'cab', kb: ['KeyS'], pad: [PAD.LT] },
  brakeMore:     { label: 'Кран машиниста: торможение +', group: 'cab', kb: ['KeyD'], pad: [] },
  brakeLess:     { label: 'Кран машиниста: отпуск', group: 'cab', kb: ['KeyA'], pad: [] },
  emergency:     { label: 'Экстренное торможение', group: 'cab', kb: ['Backspace'], pad: [PAD.B] },
  reverserFwd:   { label: 'Реверсор: вперёд', group: 'cab', kb: ['KeyR'], pad: [] },
  reverserBack:  { label: 'Реверсор: назад', group: 'cab', kb: ['KeyF'], pad: [] },
  reverserCycle: { label: 'Реверсор: переключить', group: 'cab', kb: [], pad: [PAD.X] },
  doorsLeft:     { label: 'Открыть двери слева', group: 'cab', kb: ['KeyZ'], pad: [PAD.LEFT] },
  doorsRight:    { label: 'Открыть двери справа', group: 'cab', kb: ['KeyX'], pad: [PAD.RIGHT] },
  doorsClose:    { label: 'Закрыть двери', group: 'cab', kb: ['KeyC'], pad: [PAD.DOWN] },
  horn:          { label: 'Тифон (звуковой сигнал)', group: 'cab', kb: ['Space'], pad: [PAD.LB] },
  whistle:       { label: 'Свисток', group: 'cab', kb: ['KeyN'], pad: [PAD.UP] },
  vigilance:     { label: 'Бдительность (РБ)', group: 'cab', kb: ['KeyQ'], pad: [PAD.A] },
  headlights:    { label: 'Прожектор', group: 'cab', kb: ['KeyL'], pad: [PAD.RB] },
  cabLight:      { label: 'Освещение кабины', group: 'cab', kb: ['KeyK'], pad: [] },
  wipers:        { label: 'Стеклоочистители', group: 'cab', kb: ['KeyV'], pad: [] },
  pantograph:    { label: 'Токоприёмник поднять/опустить', group: 'cab', kb: ['KeyP'], pad: [] },
  changeEnds:    { label: 'Сменить кабину (оборот)', group: 'cab', kb: ['KeyY'], pad: [] },
  moveForward:   { label: 'Идти вперёд', group: 'walk', kb: ['KeyW'], pad: [] },
  moveBack:      { label: 'Идти назад', group: 'walk', kb: ['KeyS'], pad: [] },
  moveLeft:      { label: 'Шаг влево', group: 'walk', kb: ['KeyA'], pad: [] },
  moveRight:     { label: 'Шаг вправо', group: 'walk', kb: ['KeyD'], pad: [] },
  run:           { label: 'Бег', group: 'walk', kb: ['ShiftLeft'], pad: [PAD.L3] },
  interact:      { label: 'Действие: сесть/встать, войти/выйти', group: 'global', kb: ['KeyE'], pad: [PAD.A] },
  camCab:        { label: 'Камера: кабина', group: 'global', kb: ['Digit1'], pad: [] },
  camExterior:   { label: 'Камера: снаружи', group: 'global', kb: ['Digit2'], pad: [] },
  camTrackside:  { label: 'Камера: у пути', group: 'global', kb: ['Digit3'], pad: [] },
  camWalk:       { label: 'Камера: пешком', group: 'global', kb: ['Digit4'], pad: [] },
  cameraNext:    { label: 'Следующая камера', group: 'global', kb: ['KeyO'], pad: [PAD.Y] },
  lookReset:     { label: 'Сбросить взгляд', group: 'global', kb: ['KeyU'], pad: [PAD.R3] },
  schedule:      { label: 'Расписание / схема линии', group: 'global', kb: ['Tab'], pad: [PAD.BACK] },
  hud:           { label: 'Показать/скрыть HUD', group: 'global', kb: ['KeyH'], pad: [] },
  pause:         { label: 'Пауза / меню', group: 'global', kb: ['Escape'], pad: [PAD.START] },
  timeFast:      { label: 'Ускорение времени (свободный режим)', group: 'global', kb: ['Equal'], pad: [] },
  timeNormal:    { label: 'Обычное время', group: 'global', kb: ['Minus'], pad: [] },
};

export function keyLabel(code) {
  if (!code) return '—';
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Backspace', '⌫ Backspace').replace('Space', 'Пробел')
    .replace('ShiftLeft', 'Shift').replace('Escape', 'Esc').replace('Equal', '=').replace('Minus', '−');
}

class Input {
  constructor() {
    this.keys = new Set();
    this.prevKeys = new Set();
    this.pressedKeys = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0, buttons: 0, locked: false };
    this.pad = null;
    this.padButtons = [];
    this.prevPadButtons = [];
    this.padAxes = [0, 0, 0, 0];
    this.lastDevice = 'kb';
    this.captureCb = null;
    this.enabled = true;
    this.rebuildBindings();

    addEventListener('keydown', (e) => {
      if (this.captureCb) { e.preventDefault(); const cb = this.captureCb; this.captureCb = null; cb({ kb: e.code }); return; }
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (['Tab', 'Space', 'Backspace'].includes(e.code) || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) this.pressedKeys.add(e.code);
      this.keys.add(e.code);
      this.lastDevice = 'kb';
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (this.mouse.locked || this.mouse.buttons & 2 || this.mouse.buttons & 1) {
        this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
      }
    });
    addEventListener('mousedown', (e) => { this.mouse.buttons |= 1 << e.button; });
    addEventListener('mouseup', (e) => { this.mouse.buttons &= ~(1 << e.button); });
    addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('contextmenu', (e) => { if (e.target.id === 'view') e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => { this.mouse.locked = !!document.pointerLockElement; });
  }

  rebuildBindings() {
    const over = settings.controls.bindings || {};
    this.bind = {};
    for (const [k, a] of Object.entries(ACTIONS)) {
      this.bind[k] = { kb: [...(over[k]?.kb ?? a.kb)], pad: [...(over[k]?.pad ?? a.pad)] };
    }
  }

  setBinding(action, device, value) {
    const b = settings.controls.bindings || (settings.controls.bindings = {});
    b[action] = b[action] || { kb: [...this.bind[action].kb], pad: [...this.bind[action].pad] };
    b[action][device] = value == null ? [] : [value];
    saveSettings(settings);
    this.rebuildBindings();
  }

  resetBindings() {
    settings.controls.bindings = null;
    saveSettings(settings);
    this.rebuildBindings();
  }

  capture(cb) { this.captureCb = cb; this.padCapture = cb; }

  update() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad = null;
    for (const p of pads) if (p && p.connected) { this.pad = p; break; }
    this.prevPadButtons = this.padButtons;
    if (this.pad) {
      this.padButtons = this.pad.buttons.map((b) => b.value);
      const dz = settings.controls.stickDeadzone;
      this.padAxes = this.pad.axes.slice(0, 4).map((v) => (Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz)));
      if (this.padButtons.some((v) => v > 0.5) || this.padAxes.some((v) => v !== 0)) this.lastDevice = 'pad';
      if (this.padCapture) {
        const i = this.padButtons.findIndex((v, j) => v > 0.6 && !(this.prevPadButtons[j] > 0.6));
        if (i >= 0) { const cb = this.padCapture; this.padCapture = null; this.captureCb = null; cb({ pad: i }); }
      }
    } else {
      this.padButtons = [];
      this.padAxes = [0, 0, 0, 0];
    }
  }

  // вызывать в конце кадра
  endFrame() {
    this.pressedKeys.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
  }

  padValue(i) {
    const v = this.padButtons[i] || 0;
    const dz = settings.controls.triggerDeadzone;
    return v < dz ? 0 : (v - dz) / (1 - dz);
  }

  // аналоговое значение 0..1 действия
  value(action) {
    if (!this.enabled) return 0;
    const b = this.bind[action];
    let v = 0;
    for (const k of b.kb) if (this.keys.has(k)) v = 1;
    for (const i of b.pad) v = Math.max(v, this.padValue(i));
    return v;
  }

  down(action) { return this.value(action) > 0.5; }

  pressed(action) {
    if (!this.enabled) return false;
    const b = this.bind[action];
    for (const k of b.kb) if (this.pressedKeys.has(k)) return true;
    for (const i of b.pad) if ((this.padButtons[i] || 0) > 0.6 && !((this.prevPadButtons[i] || 0) > 0.6)) return true;
    return false;
  }

  // Оси: перемещение и обзор
  moveAxes() {
    let x = this.padAxes[0] || 0, y = -(this.padAxes[1] || 0);
    if (this.down('moveForward')) y += 1;
    if (this.down('moveBack')) y -= 1;
    if (this.down('moveRight')) x += 1;
    if (this.down('moveLeft')) x -= 1;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  lookDelta(dt) {
    const s = settings.controls;
    const inv = s.invertY ? -1 : 1;
    const mx = this.mouse.dx * 0.0022 * s.mouseSensitivity;
    const my = this.mouse.dy * 0.0022 * s.mouseSensitivity * inv;
    const gx = (this.padAxes[2] || 0) * 2.4 * dt * s.gamepadLookSensitivity;
    const gy = (this.padAxes[3] || 0) * 2.0 * dt * s.gamepadLookSensitivity * inv;
    return { x: mx + gx, y: my + gy };
  }

  bindingLabel(action) {
    const b = this.bind[action];
    if (this.lastDevice === 'pad' && b.pad.length) return PAD_NAMES[b.pad[0]];
    return b.kb.length ? keyLabel(b.kb[0]) : (b.pad.length ? PAD_NAMES[b.pad[0]] : '—');
  }
}

export const input = new Input();
