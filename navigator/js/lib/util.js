/* util.js — DOM, events, formatting, small helpers. No dependencies. */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Minimal typed event bus. */
export class Emitter {
  #map = new Map();
  on(type, fn)   { (this.#map.get(type) ?? this.#map.set(type, new Set()).get(type)).add(fn); return () => this.off(type, fn); }
  once(type, fn) { const off = this.on(type, (...a) => { off(); fn(...a); }); return off; }
  off(type, fn)  { this.#map.get(type)?.delete(fn); }
  emit(type, payload) {
    for (const fn of this.#map.get(type) ?? []) {
      try { fn(payload); } catch (err) { console.error(`[emitter:${type}]`, err); }
    }
    for (const fn of this.#map.get('*') ?? []) {
      try { fn(type, payload); } catch (err) { console.error('[emitter:*]', err); }
    }
  }
}

export const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
export const lerp  = (a, b, t) => a + (b - a) * t;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function throttle(fn, ms) {
  let last = 0, timer = null, pending = null;
  return (...args) => {
    pending = args;
    const now = performance.now();
    const wait = ms - (now - last);
    if (wait <= 0) { last = now; fn(...pending); }
    else if (!timer) timer = setTimeout(() => { timer = null; last = performance.now(); fn(...pending); }, wait);
  };
}

export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/** Run `jobs` (array of thunks returning promises) with bounded concurrency. */
export async function pool(jobs, limit, onProgress) {
  let index = 0, done = 0;
  const results = new Array(jobs.length);
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (index < jobs.length) {
      const i = index++;
      try { results[i] = await jobs[i](); }
      catch (err) { results[i] = { error: err }; }
      onProgress?.(++done, jobs.length);
    }
  });
  await Promise.all(workers);
  return results;
}

/** fetch with timeout + retries with exponential backoff. */
export async function fetchJSON(url, { timeout = 15000, retries = 2, ...init } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(400 * 2 ** attempt);
    } finally { clearTimeout(timer); }
  }
  throw lastErr;
}

/* ---------- formatting ---------- */

export function formatDistance(m, lang = 'ru') {
  if (!isFinite(m)) return '—';
  if (m < 1000) {
    const step = m < 100 ? 10 : 50;
    return `${Math.round(m / step) * step} ${lang === 'ru' ? 'м' : 'm'}`;
  }
  const km = m / 1000;
  const txt = km < 10 ? km.toFixed(1) : String(Math.round(km));
  return `${lang === 'ru' ? txt.replace('.', ',') : txt} ${lang === 'ru' ? 'км' : 'km'}`;
}

export function formatDuration(sec, lang = 'ru') {
  if (!isFinite(sec)) return '—';
  const total = Math.max(0, Math.round(sec / 60));
  const h = Math.floor(total / 60), m = total % 60;
  const H = lang === 'ru' ? 'ч' : 'h', M = lang === 'ru' ? 'мин' : 'min';
  if (h === 0) return `${m} ${M}`;
  if (h >= 24) { const d = Math.floor(h / 24); return `${d} ${lang === 'ru' ? 'д' : 'd'} ${h % 24} ${H}`; }
  return m ? `${h} ${H} ${m} ${M}` : `${h} ${H}`;
}

export function formatClock(date, lang = 'ru') {
  return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB',
    { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function formatBytes(bytes, lang = 'ru') {
  const units = lang === 'ru' ? ['Б', 'КБ', 'МБ', 'ГБ'] : ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Haptic feedback where the platform supports it. */
export function haptic(pattern = 10) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
