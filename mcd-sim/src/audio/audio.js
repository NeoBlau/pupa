// Звук: синтез тяговых двигателей, качения, стыков, тормозов, компрессора, дверей, тифона, сигналов КЛУБ,
// окружения (ветер, дождь, птицы, город) + объявления (Piper TTS, файлы mp3; запасной вариант — speechSynthesis).
import { settings } from '../core/settings.js';

const BASE = import.meta.env.BASE_URL + 'assets/audio/';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.annQueue = [];
    this.annPlaying = false;
    this.buffers = new Map();
    this.manifest = null;
    this.clickAcc = 0;
    this.prevBrake = 0;
    this.horn = null;
    this.inside = true;
  }

  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.connect(c.destination);
    this.cabFilter = c.createBiquadFilter(); this.cabFilter.type = 'lowpass'; this.cabFilter.frequency.value = 2200;
    this.trainBus = c.createGain(); this.trainBus.connect(this.cabFilter); this.cabFilter.connect(this.master);
    this.ambBus = c.createGain(); this.ambBus.connect(this.master);
    this.annBus = c.createGain(); this.annBus.connect(this.master);
    this.uiBus = c.createGain(); this.uiBus.connect(this.master);
    this.applyVolumes();
    // шум
    const len = c.sampleRate * 2;
    const nb = c.createBuffer(1, len, c.sampleRate);
    const d = nb.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    this.noiseBuf = nb;
    const noise = (gain, type, freq, q = 0.7, bus = this.trainBus) => {
      const src = c.createBufferSource(); src.buffer = nb; src.loop = true; src.playbackRate.value = 0.7 + Math.random() * 0.6;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(bus); src.start();
      return { src, f, g };
    };
    // двигатели: два генератора + полосовой фильтр
    const osc = (type, f0, gain) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f0; const g = c.createGain(); g.gain.value = gain; o.connect(g); o.start(); return { o, g }; };
    this.motor1 = osc('sawtooth', 200, 0); this.motor2 = osc('square', 300, 0); this.motor3 = osc('sine', 100, 0);
    this.motorF = c.createBiquadFilter(); this.motorF.type = 'bandpass'; this.motorF.Q.value = 2.5; this.motorF.frequency.value = 800;
    for (const m of [this.motor1, this.motor2, this.motor3]) m.g.connect(this.motorF);
    this.motorG = c.createGain(); this.motorG.gain.value = 0; this.motorF.connect(this.motorG); this.motorG.connect(this.trainBus);
    this.roll = noise(0, 'lowpass', 400, 0.8);
    this.rumble = noise(0, 'lowpass', 90, 1.0);
    this.brakeHiss = noise(0, 'highpass', 2500, 0.5);
    this.squeal = osc('sine', 2900, 0); this.squeal.g.connect(this.trainBus);
    this.compressor = noise(0, 'bandpass', 160, 1.2);
    this.comprLfo = c.createOscillator(); this.comprLfo.frequency.value = 9; const lfoG = c.createGain(); lfoG.gain.value = 0; this.comprLfo.connect(lfoG); lfoG.connect(this.compressor.g.gain); this.comprLfo.start(); this.comprLfoG = lfoG;
    this.wind = noise(0, 'bandpass', 500, 0.4, this.ambBus);
    this.rain = noise(0, 'highpass', 1200, 0.3, this.ambBus);
    this.city = noise(0, 'lowpass', 220, 0.5, this.ambBus);
    // мануфест объявлений
    try { const r = await fetch(BASE + 'manifest.json'); if (r.ok) this.manifest = await r.json(); } catch { /* нет файлов */ }
    this.ready = true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const a = settings.audio;
    this.master.gain.value = a.master;
    this.trainBus.gain.value = a.train;
    this.ambBus.gain.value = a.ambient;
    this.annBus.gain.value = a.announcements;
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }
  suspend() { if (this.ctx) this.ctx.suspend(); }

  setInside(inside) {
    this.inside = inside;
    if (!this.ctx) return;
    this.cabFilter.frequency.setTargetAtTime(inside ? 2200 : 16000, this.ctx.currentTime, 0.2);
  }

  // короткий щелчок/удар
  thump(gain = 0.5, freq = 180, dur = 0.05, when = 0, bus = this.trainBus) {
    const c = this.ctx; const t = c.currentTime + when;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(bus); src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  tone(freq, dur, { type = 'sine', gain = 0.2, when = 0, bus = this.uiBus, attack = 0.01 } = {}) {
    const c = this.ctx; const t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.setValueAtTime(gain, t + dur - 0.03); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }

  hiss(gain, dur, when = 0, freq = 3000) {
    const c = this.ctx; const t = c.currentTime + when;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.trainBus); src.start(t); src.stop(t + dur + 0.1);
  }

  // ── события ──
  event(e, spec) {
    if (!this.ready) return;
    switch (e) {
      case 'doorsOpen':
        if (spec?.sound.doorChime !== 'none') { this.tone(1046, 0.18, { gain: 0.12 }); this.tone(1318, 0.25, { gain: 0.12, when: 0.2 }); }
        this.hiss(0.25, 0.9, 0.2, 1500); this.thump(0.25, 400, 0.12, 2.6);
        break;
      case 'doorsClose':
        if (spec?.sound.doorChime === 'desiro') for (let i = 0; i < 6; i++) this.tone(i % 2 ? 1568 : 1318, 0.16, { gain: 0.11, when: i * 0.28 });
        else if (spec?.sound.doorChime === 'ivolga') for (let i = 0; i < 5; i++) this.tone(988, 0.2, { gain: 0.12, when: i * 0.35 });
        this.hiss(0.22, 1.0, 0.3, 1500); this.thump(0.5, 300, 0.15, 3.0);
        break;
      case 'contactor': this.thump(0.35, 900, 0.04); this.thump(0.2, 2000, 0.03, 0.05); break;
      case 'kran': this.hiss(0.15, 0.4, 0, 2500); break;
      case 'reverser': this.thump(0.3, 600, 0.05); break;
      case 'emergency': this.hiss(0.8, 3.5, 0, 800); break;
      case 'brakeRelease': this.hiss(0.35, 1.5, 0, 2000); break;
      case 'klubWarn': for (let i = 0; i < 3; i++) this.tone(1200, 0.12, { type: 'square', gain: 0.06, when: i * 0.2 }); break;
      case 'vigilance': for (let i = 0; i < 6; i++) this.tone(800, 0.25, { type: 'square', gain: 0.05, when: i * 0.5 }); break;
      case 'penalty': for (let i = 0; i < 4; i++) this.tone(600, 0.3, { type: 'sawtooth', gain: 0.08, when: i * 0.35 }); break;
      case 'spad': for (let i = 0; i < 8; i++) this.tone(i % 2 ? 900 : 700, 0.25, { type: 'square', gain: 0.09, when: i * 0.25 }); break;
      case 'click': this.tone(2000, 0.03, { gain: 0.05 }); break;
      default: break;
    }
  }

  hornOn(kind = 'horn') {
    if (!this.ready || this.horn) return;
    const c = this.ctx; const g = c.createGain(); g.gain.value = 0;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = kind === 'horn' ? 2200 : 5000;
    const freqs = kind === 'horn' ? [311, 370, 466] : [1480, 1760];
    const os = freqs.map((fr) => { const o = c.createOscillator(); o.type = kind === 'horn' ? 'sawtooth' : 'sine'; o.frequency.value = fr; o.connect(f); o.start(); return o; });
    f.connect(g); g.connect(this.master);
    g.gain.linearRampToValueAtTime(kind === 'horn' ? 0.12 : 0.08, c.currentTime + 0.06);
    this.horn = { g, os };
  }
  hornOff() {
    if (!this.horn) return;
    const { g, os } = this.horn; const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 0.12);
    os.forEach((o) => o.stop(t + 0.2));
    this.horn = null;
  }

  // ── непрерывные звуки ──
  update(dt, sim, env, { view = 'cab', aiNear = 0, city = 0, walking = false } = {}) {
    if (!this.ready || !sim) return;
    const c = this.ctx, t = c.currentTime, k = 0.08;
    const v = sim.speedKmh, spec = sim.spec;
    const vn = v / spec.maxSpeed;
    const load = Math.max(sim.tractionEffort, sim.edBrake * 0.8);
    const distF = view === 'walk' || view === 'trackside' ? 0.5 : 1;
    if (spec.sound.motor === 'dc') {
      const f = spec.sound.motorBase + spec.sound.motorSpan * vn;
      this.motor1.o.frequency.setTargetAtTime(f, t, k); this.motor2.o.frequency.setTargetAtTime(f * 1.5, t, k); this.motor3.o.frequency.setTargetAtTime(f * 0.5, t, k);
      this.motor1.g.gain.value = 0.5; this.motor2.g.gain.value = 0.12; this.motor3.g.gain.value = 0.6;
      this.motorF.frequency.setTargetAtTime(300 + f * 1.4, t, k);
      this.motorG.gain.setTargetAtTime(distF * (0.05 + 0.18 * load) * Math.min(1, v / 5 + load), t, k);
    } else {
      // асинхронный привод: «поющий» инвертор — на низких скоростях несущая частота ступенями
      let f;
      if (v < 25) f = 520 + Math.floor(v / 6) * 140 + (v % 6) * 70;
      else f = spec.sound.motorBase + spec.sound.motorSpan * vn;
      this.motor1.o.frequency.setTargetAtTime(f, t, k); this.motor2.o.frequency.setTargetAtTime(f * 2.01, t, k); this.motor3.o.frequency.setTargetAtTime(f * 0.5, t, k);
      this.motor1.g.gain.value = 0.35; this.motor2.g.gain.value = 0.08; this.motor3.g.gain.value = 0.3;
      this.motorF.frequency.setTargetAtTime(Math.min(4000, f * 1.2), t, k);
      this.motorG.gain.setTargetAtTime(distF * 0.11 * load * (v > 0.5 || load > 0.05 ? 1 : 0), t, k);
    }
    this.roll.g.gain.setTargetAtTime(Math.min(0.5, v / 110) * 0.55, t, k);
    this.roll.f.frequency.setTargetAtTime(250 + v * 9, t, k);
    this.rumble.g.gain.setTargetAtTime(Math.min(0.6, v / 80) * 0.5, t, k);
    // тормоза
    const db = sim.brakeCyl - this.prevBrake; this.prevBrake = sim.brakeCyl;
    if (db > 0.02) this.hiss(Math.min(0.3, db * 2), 0.5, 0, 2500);
    if (db < -0.03) this.hiss(Math.min(0.25, -db * 1.5), 0.6, 0, 3000);
    const squeal = sim.brakeCyl > 1.5 && v > 0.5 && v < 12 ? (sim.brakeCyl / 4) * (1 - v / 12) * 0.05 : 0;
    this.squeal.g.gain.setTargetAtTime(squeal, t, 0.1);
    this.squeal.o.frequency.setTargetAtTime(2600 + v * 30, t, 0.2);
    this.brakeHiss.g.gain.setTargetAtTime(sim.emergency ? 0.15 : 0, t, 0.2);
    // компрессор
    const comp = sim.compressorOn && sim.pantograph ? (spec.sound.compressor === 'piston' ? 0.22 : 0.08) : 0;
    this.compressor.g.gain.setTargetAtTime(comp, t, 0.3);
    this.comprLfoG.gain.setTargetAtTime(spec.sound.compressor === 'piston' ? comp * 0.9 : 0, t, 0.3);
    // стыки (звеньевой путь у станций и стрелок; на бесстыковом — редко)
    this.clickAcc += (v / 3.6) * dt;
    const jointStep = 25;
    if (this.clickAcc > jointStep) {
      this.clickAcc -= jointStep;
      const vv = Math.max(1, v / 3.6);
      const g0 = Math.min(0.5, v / 120) * 0.6;
      const L = spec.carLength;
      for (const [w, gm] of [[0, 1], [2.5 / vv, 0.9], [(L - 6.4) / vv, 0.75], [(L - 3.9) / vv, 0.7]]) if (w < 1.5) this.thump(g0 * gm, 220, 0.06, w);
    }
    // окружение
    const w = env.weather;
    this.wind.g.gain.setTargetAtTime((walking ? 0.03 : 0) + Math.min(0.25, v / 400) * (view === 'cab' ? 0.4 : 1), t, 0.3);
    this.rain.g.gain.setTargetAtTime(w.rain ? (view === 'cab' ? 0.09 : 0.16) : 0, t, 0.5);
    this.city.g.gain.setTargetAtTime(city * 0.08, t, 1);
    // птицы днём летом пешком
    if (walking && env.season !== 'winter' && env.night < 0.3 && !w.rain && Math.random() < dt * 0.25) {
      const f0 = 2400 + Math.random() * 1800;
      for (let i = 0; i < 3 + Math.random() * 4; i++) this.tone(f0 + Math.random() * 600, 0.07, { gain: 0.025, when: i * 0.1, bus: this.ambBus });
    }
    // встречный поезд
    if (aiNear > 0) this.rumble.g.gain.setTargetAtTime(Math.min(0.8, 0.5 + aiNear * 0.6), t, 0.1);
  }

  // ── объявления ──
  async loadClip(voice, key) {
    const id = voice + '/' + key;
    if (this.buffers.has(id)) return this.buffers.get(id);
    const p = (async () => {
      try {
        const r = await fetch(BASE + id + '.mp3');
        if (!r.ok) return null;
        return await this.ctx.decodeAudioData(await r.arrayBuffer());
      } catch { return null; }
    })();
    this.buffers.set(id, p);
    return p;
  }

  announce(keys, voice = 'm') {
    if (!this.ready) return;
    this.annQueue.push({ keys: keys.filter(Boolean), voice });
    if (!this.annPlaying) this.playNext();
  }

  async playNext() {
    const item = this.annQueue.shift();
    if (!item) { this.annPlaying = false; return; }
    this.annPlaying = true;
    // гонг
    this.tone(784, 0.35, { gain: 0.08, bus: this.annBus }); this.tone(659, 0.5, { gain: 0.08, bus: this.annBus, when: 0.35 });
    let when = this.ctx.currentTime + 1.0;
    let any = false;
    for (const k of item.keys) {
      const buf = this.manifest ? await this.loadClip(item.voice, k) : null;
      if (buf) {
        const src = this.ctx.createBufferSource(); src.buffer = buf; src.connect(this.annBus); src.start(when);
        when += buf.duration + 0.15; any = true;
      } else if (this.manifest?.[k] || typeof k === 'string') {
        this.speak(this.manifest?.[k] || '');
      }
    }
    const wait = any ? (when - this.ctx.currentTime) * 1000 + 300 : 3000;
    setTimeout(() => this.playNext(), wait);
  }

  speak(text) {
    if (!text || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text); u.lang = 'ru-RU';
    const v = speechSynthesis.getVoices().find((x) => x.lang.startsWith('ru')); if (v) u.voice = v;
    speechSynthesis.speak(u);
  }
}

export const audio = new AudioEngine();
