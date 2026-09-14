/* settings.js — persisted preferences with change notifications. */

import { Emitter } from '../lib/util.js';
import { detectLang, setLang } from '../i18n/strings.js';

const KEY = 'nav.settings.v1';

const DEFAULTS = {
  lang: 'ru',
  units: 'metric',            // metric | imperial
  theme: 'auto',              // auto | light | dark
  mapStyle: 'day',            // day | night | satellite | topo
  autoNight: true,
  headUp: true,               // rotate map with heading during navigation
  voice: 'full',              // off | alerts | full
  voiceRate: 1.05,
  cameraAlerts: true,
  cameraAlertTypes: { speed: true, redLight: true, average: true, bus: true, parking: false, mobile: true },
  speedWarn: true,
  speedWarnBy: 10,            // km/h over the limit before we complain
  keepAwake: true,
  hudMode: false,
  showTraffic: true,
  showCameras: true,
  showTrails: false,
  showWeatherLayer: false,
  avoid: { tolls: false, unpaved: false, ferries: false, highways: false },
  routePreference: 'fastest', // fastest | shortest | scenic
  profile: 'car',             // car | bike | foot | hike
  tilesKey: '',               // optional MapTiler key for vector basemaps
  trafficKey: '',             // TomTom key — the only way to get real live traffic
  trafficProvider: 'tomtom',
  homePoint: null,
  workPoint: null,
  onboarded: false,
};

class Settings extends Emitter {
  #state;

  constructor() {
    super();
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { /* corrupted */ }
    this.#state = { ...structuredClone(DEFAULTS), ...stored };
    // nested objects need a merge, not a replace, so new keys appear after upgrades
    for (const k of ['avoid', 'cameraAlertTypes']) {
      this.#state[k] = { ...DEFAULTS[k], ...(stored[k] ?? {}) };
    }
    if (!stored.lang) this.#state.lang = detectLang();
    setLang(this.#state.lang);
  }

  get all() { return this.#state; }
  get(key) { return this.#state[key]; }

  set(key, value) {
    if (JSON.stringify(this.#state[key]) === JSON.stringify(value)) return;
    this.#state[key] = value;
    if (key === 'lang') { setLang(value); localStorage.setItem('nav.lang', value); }
    this.#persist();
    this.emit('change', { key, value });
    this.emit(`change:${key}`, value);
  }

  patch(partial) { for (const [k, v] of Object.entries(partial)) this.set(k, v); }

  toggle(key) { this.set(key, !this.#state[key]); return this.#state[key]; }

  /** Nested setter: setIn('avoid', 'tolls', true) */
  setIn(key, sub, value) { this.set(key, { ...this.#state[key], [sub]: value }); }

  reset() {
    this.#state = structuredClone(DEFAULTS);
    this.#state.lang = detectLang();
    this.#persist();
    this.emit('change', { key: '*', value: this.#state });
  }

  #persist() {
    try { localStorage.setItem(KEY, JSON.stringify(this.#state)); }
    catch (err) { console.warn('settings persist failed', err); }
  }

  /** Resolved light/dark taking auto + sunset into account. */
  effectiveTheme(isNight = false) {
    if (this.#state.theme === 'light') return 'light';
    if (this.#state.theme === 'dark') return 'dark';
    if (this.#state.autoNight && isNight) return 'dark';
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
}

export const settings = new Settings();
export { DEFAULTS };
