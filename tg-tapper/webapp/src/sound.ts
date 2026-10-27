// All sounds are synthesized with WebAudio, so there are no audio files to ship.
// To use real recordings later, play an <audio> / AudioBuffer here instead.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let enabled = true;
const loops = new Map<string, { gain: GainNode; stop: () => void }>();

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  if (!on) for (const k of [...loops.keys()]) loop(k, false);
}

function env(g: GainNode, t: number, a: number, peak: number, d: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, vol = 0.3, delay = 0) {
  const c = ac();
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  env(g, t, 0.005, vol, dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function burst(filter: BiquadFilterType, freq: number, dur: number, vol = 0.3, q = 1) {
  const c = ac();
  const t = c.currentTime;
  const s = c.createBufferSource();
  s.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  env(g, t, 0.005, vol, dur);
  s.connect(f).connect(g).connect(master!);
  s.start(t, Math.random());
  s.stop(t + dur + 0.05);
}

export function sfx(name: string) {
  if (!enabled) return;
  switch (name) {
    case 'drop':
      return tone('sine', 900, 280, 0.09, 0.25);
    case 'squish':
      return burst('lowpass', 700, 0.12, 0.35);
    case 'needle':
      tone('triangle', 2400, 1800, 0.05, 0.12);
      return tone('sine', 520, 500, 0.25, 0.08, 0.03);
    case 'pop':
      return tone('sine', 420, 90, 0.08, 0.3);
    case 'zap':
      tone('square', 1900, 900, 0.03, 0.06);
      return burst('highpass', 4000, 0.04, 0.15);
    case 'ouch':
      return tone('sine', 180, 60, 0.18, 0.4);
    case 'giggle':
      for (let i = 0; i < 5; i++) tone('sine', 700 + Math.random() * 300, 520, 0.07, 0.12, i * 0.085);
      return;
    case 'step':
      tone('sine', 880, 880, 0.12, 0.15);
      return tone('sine', 1320, 1320, 0.18, 0.15, 0.08);
    case 'heal':
      for (let i = 0; i < 4; i++) tone('sine', 520 * 1.25 ** i, 520 * 1.25 ** i, 0.5, 0.08, i * 0.18);
      return;
    case 'success':
      [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.25, 0.18, i * 0.09));
      return;
    case 'coin':
      tone('square', 988, 988, 0.06, 0.06);
      return tone('square', 1319, 1319, 0.12, 0.06, 0.06);
    case 'tap':
      return tone('sine', 660, 540, 0.05, 0.08);
  }
}

const LOOPS: Record<string, { filter: BiquadFilterType; freq: number; vol: number; q?: number; osc?: number; lfo?: number }> = {
  water: { filter: 'bandpass', freq: 1800, vol: 0.22, q: 0.6 },
  lather: { filter: 'lowpass', freq: 1400, vol: 0.18, lfo: 9 },
  rub: { filter: 'lowpass', freq: 420, vol: 0.22, lfo: 3 },
  fizz: { filter: 'highpass', freq: 5000, vol: 0.12, lfo: 23 },
  buzz: { filter: 'lowpass', freq: 900, vol: 0.12, osc: 110 },
};

export function loop(name: string, on: boolean) {
  if (name === '*') {
    for (const k of [...loops.keys()]) loop(k, false);
    return;
  }
  const cur = loops.get(name);
  if (!on) {
    if (cur) {
      const t = ctx!.currentTime;
      cur.gain.gain.setTargetAtTime(0, t, 0.05);
      setTimeout(cur.stop, 300);
      loops.delete(name);
    }
    return;
  }
  if (cur || !enabled) return;
  const def = LOOPS[name];
  if (!def) return;
  const c = ac();
  const g = c.createGain();
  g.gain.value = 0;
  g.gain.setTargetAtTime(def.vol, c.currentTime, 0.05);
  const f = c.createBiquadFilter();
  f.type = def.filter;
  f.frequency.value = def.freq;
  f.Q.value = def.q ?? 1;
  let src: AudioScheduledSourceNode;
  if (def.osc) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = def.osc;
    src = o;
  } else {
    const s = c.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    src = s;
  }
  const nodes: AudioScheduledSourceNode[] = [src];
  if (def.lfo) {
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.frequency.value = def.lfo;
    lg.gain.value = def.vol * 0.6;
    lfo.connect(lg).connect(g.gain);
    lfo.start();
    nodes.push(lfo);
  }
  src.connect(f).connect(g).connect(master!);
  src.start();
  loops.set(name, { gain: g, stop: () => nodes.forEach((n) => n.stop()) });
}
