// Настройки игры с сохранением в localStorage.
const KEY = 'mcd-sim-settings-v1';

export const DEFAULT_SETTINGS = {
  graphics: {
    quality: 'high', // low | medium | high | ultra
    shadows: true,
    bloom: true,
    viewDistance: 1800,
    pixelRatio: 1,
    fov: 60,
  },
  audio: { master: 0.8, announcements: 1.0, train: 0.9, ambient: 0.6 },
  controls: {
    mouseSensitivity: 1.0,
    gamepadLookSensitivity: 1.0,
    invertY: false,
    triggerDeadzone: 0.08,
    stickDeadzone: 0.15,
    leverSpeed: 1.0, // скорость перемещения контроллера
    analogTriggers: false, // true: курки напрямую задают тягу/торможение
    bindings: null, // переопределения (см. input.js)
  },
  gameplay: {
    vigilance: true, // проверка бдительности (РБ)
    hud: 'full', // full | minimal | off
    autoDoorsSide: false,
    units: 'kmh',
  },
};

function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return structuredClone(base);
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over)) {
    if (base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])) out[k] = deepMerge(base[k], over[k]);
    else out[k] = over[k];
  }
  return out;
}

export function loadSettings() {
  try {
    return deepMerge(DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(KEY) || 'null'));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* приватный режим */ }
}

export const settings = loadSettings();
