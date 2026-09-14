/* sheet.js — the draggable bottom sheet, its panel stack, and toasts. */

import { el, Emitter, clamp, haptic } from '../lib/util.js';

const DETENTS = ['peek', 'half', 'full'];
const DETENT_FRACTION = { peek: 0, half: 0.45, full: 1 };   // 0 = collapsed, 1 = fully open

export class Sheet extends Emitter {
  #root; #body; #grip;
  #detent = 'peek';
  #drag = null;
  #stack = [];

  mount(parent) {
    this.#grip = el('div', { class: 'sheet-grip', role: 'button', 'aria-label': 'Потянуть' });
    this.#body = el('div', { class: 'sheet-body' });
    this.#root = el('div', { class: 'sheet', 'data-detent': 'peek' }, this.#grip, this.#body);
    parent.append(this.#root);
    this.#wireDrag();
    return this;
  }

  get element() { return this.#root; }
  get body() { return this.#body; }
  get detent() { return this.#detent; }

  setDetent(detent, { silent = false } = {}) {
    if (!DETENTS.includes(detent) && detent !== 'hidden') return;
    this.#detent = detent;
    this.#root.dataset.detent = detent;
    this.#root.style.transform = '';
    if (!silent) this.emit('detent', detent);
  }

  /* ---------- panel stack ---------- */

  /** @param {{id:string, render:(body:HTMLElement)=>void, detent?:string, onLeave?:Function}} panel */
  push(panel) {
    const current = this.#stack.at(-1);
    current?.onLeave?.();
    this.#stack.push(panel);
    this.#render();
    if (panel.detent) this.setDetent(panel.detent);
    return panel;
  }

  /** Replace the whole stack — used when switching top-level modes. */
  reset(panel) {
    for (const p of this.#stack) p.onLeave?.();
    this.#stack = [];
    return this.push(panel);
  }

  pop() {
    const leaving = this.#stack.pop();
    leaving?.onLeave?.();
    this.#render();
    const top = this.#stack.at(-1);
    if (top?.detent) this.setDetent(top.detent);
    return top;
  }

  get current() { return this.#stack.at(-1) ?? null; }
  get depth() { return this.#stack.length; }

  /** Re-run the active panel's renderer — how panels update themselves. */
  refresh() {
    if (this.#stack.length) this.#render();
  }

  #render() {
    const panel = this.#stack.at(-1);
    this.#body.replaceChildren();
    this.#body.scrollTop = 0;
    panel?.render(this.#body);
  }

  /* ---------- drag ---------- */

  #wireDrag() {
    const height = () => this.#root.getBoundingClientRect().height;

    const start = (clientY, target) => {
      // dragging from inside a scrolled list should scroll, not move the sheet
      const scrollable = target.closest('.sheet-body');
      if (scrollable && scrollable.scrollTop > 0 && this.#detent === 'full') return;
      this.#drag = { startY: clientY, lastY: clientY, startedAt: performance.now(), base: this.#offsetFor(this.#detent) };
      this.#root.classList.add('dragging');
    };

    const move = (clientY) => {
      if (!this.#drag) return;
      const delta = clientY - this.#drag.startY;
      const h = height();
      const next = clamp(this.#drag.base + delta, 0, h - 60);
      this.#drag.lastY = clientY;
      this.#root.style.transform = `translateY(${next}px)`;
    };

    const end = (clientY) => {
      if (!this.#drag) return;
      const h = height();
      const delta = clientY - this.#drag.startY;
      const elapsed = performance.now() - this.#drag.startedAt;
      const velocity = delta / Math.max(1, elapsed);        // px per ms
      const offset = clamp(this.#drag.base + delta, 0, h);

      let target;
      if (Math.abs(velocity) > 0.6) {
        // a flick moves one detent in the direction of travel
        const index = DETENTS.indexOf(this.#detent);
        target = DETENTS[clamp(index + (velocity > 0 ? -1 : 1), 0, DETENTS.length - 1)];
      } else {
        target = DETENTS.reduce((best, d) =>
          Math.abs(this.#offsetFor(d) - offset) < Math.abs(this.#offsetFor(best) - offset) ? d : best, 'peek');
      }

      this.#root.classList.remove('dragging');
      this.#drag = null;
      if (target !== this.#detent) haptic(8);
      this.setDetent(target);
    };

    this.#grip.addEventListener('pointerdown', (e) => {
      this.#grip.setPointerCapture(e.pointerId);
      start(e.clientY, e.target);
    });
    this.#grip.addEventListener('pointermove', (e) => move(e.clientY));
    this.#grip.addEventListener('pointerup', (e) => end(e.clientY));
    this.#grip.addEventListener('pointercancel', (e) => end(e.clientY));
    this.#grip.addEventListener('click', () => {
      if (this.#drag) return;
      this.setDetent(this.#detent === 'full' ? 'peek' : 'full');
    });
  }

  /** Pixel offset from fully-open for a detent. */
  #offsetFor(detent) {
    const h = this.#root.getBoundingClientRect().height;
    const peek = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-peek')) || 148;
    if (detent === 'peek') return h - peek;
    if (detent === 'half') return h * 0.45;
    return 0;
  }
}

/* ---------- toasts ---------- */

let toastHost = null;

export function toast(message, { type = 'info', duration = 2600, icon } = {}) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host' });
    document.querySelector('#app').append(toastHost);
  }
  const node = el('div', { class: `toast ${type}` },
    icon ? el('span', { html: icon, style: { width: '18px', height: '18px', display: 'grid' } }) : null,
    el('span', { text: message }));
  toastHost.append(node);
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 260);
  }, duration);
  return node;
}

/* ---------- small shared builders ---------- */

export const sectionTitle = (text) => el('div', { class: 'section-title', text });

export const kv = (label, value) =>
  el('div', { class: 'kv' },
    el('span', { class: 'kv-label', text: label }),
    el('span', { class: 'kv-value', html: value }));

export function switchRow(label, checked, onChange, sublabel) {
  const sw = el('button', { class: 'switch', role: 'switch', 'aria-checked': String(checked) });
  sw.addEventListener('click', () => {
    const next = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(next));
    haptic(6);
    onChange(next);
  });
  return el('div', { class: 'kv' },
    el('div', {},
      el('div', { class: 'kv-label', style: { color: 'var(--text)' }, text: label }),
      sublabel ? el('div', { class: 'row-sub', text: sublabel }) : null),
    sw);
}

export function segmented(options, value, onChange) {
  const host = el('div', { class: 'segmented', role: 'tablist' });
  for (const opt of options) {
    const btn = el('button', {
      role: 'tab',
      'aria-selected': String(opt.value === value),
      onClick: () => {
        for (const b of host.children) b.setAttribute('aria-selected', 'false');
        btn.setAttribute('aria-selected', 'true');
        haptic(6);
        onChange(opt.value);
      },
    }, opt.icon ? el('span', { html: opt.icon, style: { display: 'grid' } }) : null, opt.label);
    host.append(btn);
  }
  return host;
}

export function listCard(...rows) {
  return el('div', { class: 'list-card' }, ...rows.filter(Boolean));
}

export const spinnerRow = (text) =>
  el('div', { class: 'row' }, el('div', { class: 'spinner' }), el('div', { class: 'row-main' },
    el('div', { class: 'row-title', text })));

export const emptyState = (text) => el('div', { class: 'empty', text });
