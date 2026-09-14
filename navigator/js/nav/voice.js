/* voice.js — spoken guidance.
 *
 * Announcements are scheduled by time-to-manoeuvre, not by distance, so the
 * prompt lands at the same moment whether you are crawling through town or
 * doing 110 on the M-11. Camera warnings jump the queue: they are the only
 * thing worth interrupting a turn instruction for.
 */

import { plural, t } from '../i18n/strings.js';
import { phraseFor } from '../routing/maneuvers.js';
import { CAMERA_LABEL_KEY } from '../features/cameras.js';

/** When to speak, in seconds before the manoeuvre, with a distance floor. */
const CUES = [
  { id: 'far',   seconds: 75, minDistance: 700, prefix: true },
  { id: 'mid',   seconds: 30, minDistance: 220, prefix: true },
  { id: 'near',  seconds: 11, minDistance: 60,  prefix: true },
  { id: 'now',   seconds: 4,  minDistance: 0,   prefix: false },
];

export class Voice {
  #queue = [];
  #speaking = false;
  #spoken = new Set();
  #lang = 'ru';
  #mode = 'full';      // off | alerts | full
  #rate = 1.05;
  #voice = null;
  #supported = typeof speechSynthesis !== 'undefined';

  configure({ lang, mode, rate } = {}) {
    if (lang) { this.#lang = lang; this.#voice = null; }
    if (mode) this.#mode = mode;
    if (rate) this.#rate = rate;
  }

  get enabled() { return this.#supported && this.#mode !== 'off'; }

  /** Pick the best installed voice for the language, preferring a local one. */
  #pickVoice() {
    if (this.#voice || !this.#supported) return this.#voice;
    const wanted = this.#lang === 'ru' ? 'ru' : 'en';
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return null;
    const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(wanted));
    this.#voice = matching.find((v) => v.localService) ?? matching[0] ?? null;
    return this.#voice;
  }

  /**
   * @param {string} text
   * @param {{priority?: 'normal'|'high', key?: string}} opts
   */
  say(text, { priority = 'normal', key } = {}) {
    if (!this.enabled || !text) return;
    if (this.#mode === 'alerts' && priority !== 'high') return;
    if (key && this.#spoken.has(key)) return;
    if (key) this.#spoken.add(key);

    const item = { text, priority };
    if (priority === 'high') {
      // drop pending normal items rather than queueing a warning behind them
      this.#queue = this.#queue.filter((q) => q.priority === 'high');
      this.#queue.unshift(item);
      if (this.#speaking) speechSynthesis.cancel();
    } else {
      this.#queue.push(item);
    }
    this.#drain();
  }

  #drain() {
    if (!this.#supported || this.#speaking || !this.#queue.length) return;
    const item = this.#queue.shift();
    const utter = new SpeechSynthesisUtterance(item.text);
    utter.lang = this.#lang === 'ru' ? 'ru-RU' : 'en-GB';
    const voice = this.#pickVoice();
    if (voice) utter.voice = voice;
    utter.rate = this.#rate;
    utter.pitch = 1;
    this.#speaking = true;
    const done = () => { this.#speaking = false; this.#drain(); };
    utter.onend = done;
    utter.onerror = done;
    try { speechSynthesis.speak(utter); } catch { done(); }
  }

  cancel() {
    this.#queue = [];
    if (this.#supported) { try { speechSynthesis.cancel(); } catch { /* ignore */ } }
    this.#speaking = false;
  }

  resetRoute() { this.#spoken.clear(); this.cancel(); }

  /** Called on every progress tick; decides whether a manoeuvre cue is due. */
  announceManeuver(progress) {
    if (!this.enabled || this.#mode === 'alerts') return;
    const step = progress.nextStep;
    if (!step) return;
    const distance = progress.distanceToManeuver;
    const speed = Math.max(progress.speed ?? 0, 4);   // never assume standing still
    const eta = distance / speed;

    for (const cue of CUES) {
      if (eta > cue.seconds || distance < cue.minDistance) continue;
      const key = `${step.index}:${cue.id}`;
      if (this.#spoken.has(key)) return;
      const phrase = phraseFor(step, this.#lang);
      const text = cue.prefix
        ? `${t('nav.then') && ''}${distancePhrase(distance, this.#lang)} ${lowerFirst(phrase, this.#lang)}`
        : phrase;
      this.say(appendThen(text, progress, this.#lang), { key });
      return;
    }
  }

  /** Camera warnings — short, and only at the two stages that matter. */
  announceCamera(alert) {
    if (!this.enabled || !alert?.fresh) return;
    const { camera, distance, stage } = alert;
    if (stage === 'far') return;                       // the HUD shows it; no need to speak yet
    const kind = t(CAMERA_LABEL_KEY[camera.kind] ?? 'camera.speed');
    const limit = camera.maxspeed
      ? (this.#lang === 'ru' ? `, ограничение ${camera.maxspeed}` : `, limit ${camera.maxspeed}`)
      : '';
    const text = stage === 'at'
      ? `${kind}${limit}`
      : `${distancePhrase(distance, this.#lang)} — ${lowerFirst(kind, this.#lang)}${limit}`;
    this.say(text, { priority: 'high', key: `cam:${camera.id}:${stage}` });
  }

  announceSpeeding(overBy) {
    const text = this.#lang === 'ru'
      ? `Превышение на ${overBy} километров в час`
      : `Speeding by ${overBy} kilometres per hour`;
    this.say(text, { priority: 'high', key: `speed:${Math.floor(Date.now() / 60000)}` });
  }

  announceZone(zone, kind) {
    if (kind === 'start') {
      const text = this.#lang === 'ru'
        ? `Зона контроля средней скорости${zone.limit ? `, ${zone.limit}` : ''}`
        : `Average speed zone${zone.limit ? `, ${zone.limit}` : ''}`;
      this.say(text, { priority: 'high', key: `zone:${zone.entryCamera.id}` });
    } else if (kind === 'over') {
      const text = this.#lang === 'ru'
        ? `Средняя скорость превышена: ${Math.round(zone.average)}`
        : `Average speed over the limit: ${Math.round(zone.average)}`;
      this.say(text, { priority: 'high', key: `zoneover:${Math.floor(Date.now() / 60000)}` });
    }
  }

  announce(key) { this.say(t(key), { priority: 'high' }); }
}

/** "через 300 метров" / "через 1,5 километра" / "in 300 metres". */
export function distancePhrase(metres, lang = 'ru') {
  if (lang !== 'ru') {
    if (metres >= 1000) {
      const km = metres / 1000;
      const whole = Math.abs(km - Math.round(km)) < 0.1;
      const value = whole ? String(Math.round(km)) : km.toFixed(1);
      return `In ${value} ${value === '1' ? 'kilometre' : 'kilometres'}`;
    }
    return `In ${Math.max(50, Math.round(metres / 50) * 50)} metres`;
  }
  if (metres >= 1000) {
    const km = metres / 1000;
    if (Math.abs(km - Math.round(km)) < 0.1) {
      const whole = Math.round(km);
      return `Через ${whole} ${plural(whole, ['километр', 'километра', 'километров'])}`;
    }
    return `Через ${km.toFixed(1).replace('.', ',')} километра`;
  }
  const rounded = Math.max(50, Math.round(metres / 50) * 50);
  return `Через ${rounded} ${plural(rounded, ['метр', 'метра', 'метров'])}`;
}

/**
 * Chain a closely-following manoeuvre onto the current one: at a junction pair
 * 60 m apart, "turn right, then immediately left" is the only useful phrasing.
 */
function appendThen(text, progress, lang) {
  const after = progress.stepAfterNext;
  if (!after || !progress.nextStep?.immediateNext || after.type === 'arrive') return text;
  const then = lang === 'ru' ? 'затем' : 'then';
  return `${text}, ${then} ${lowerFirst(phraseFor(after, lang), lang)}`;
}

const lowerFirst = (s, lang) =>
  lang === 'ru' || lang === 'en' ? s.charAt(0).toLowerCase() + s.slice(1) : s;

export const voice = new Voice();
