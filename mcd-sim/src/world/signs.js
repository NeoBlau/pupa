// Текстуры табличек и указателей, рисуемые на canvas (названия станций, табло, номера сигналов, знаки скорости).
import * as THREE from 'three';

const cache = new Map();
const FONT = '"Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif';

function canvasTex(key, w, h, draw, { emissive = false } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.userData.emissive = emissive;
  cache.set(key, t);
  return t;
}

export function lineBadge(g, x, y, size, line) {
  g.fillStyle = line.color;
  const r = size * 0.22;
  g.beginPath(); g.roundRect(x, y, size, size, r); g.fill();
  g.fillStyle = '#fff'; g.font = `bold ${size * 0.55}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(line.id, x + size / 2, y + size / 2 + size * 0.03);
}

export function translit(n) {
  const T = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  let o = '';
  for (const ch of n) { const l = ch.toLowerCase(); const r = T[l]; o += r == null ? ch : ch === l ? r : r.charAt(0).toUpperCase() + r.slice(1); }
  return o;
}

// Табличка с названием станции в стиле навигации МЦД (приблизительно)
export function stationNameTex(station, line) {
  return canvasTex(`st:${line.id}:${station.id}`, 1024, 256, (g, w, h) => {
    g.fillStyle = '#f4f5f7'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1c2a4a'; g.fillRect(0, h - 14, w, 14);
    lineBadge(g, 28, 40, 150, line);
    g.fillStyle = '#16181d'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    let size = 104;
    g.font = `600 ${size}px ${FONT}`;
    while (g.measureText(station.name).width > w - 230 && size > 50) { size -= 4; g.font = `600 ${size}px ${FONT}`; }
    g.fillText(station.name, 205, 140);
    g.fillStyle = '#5a6070'; g.font = `400 48px ${FONT}`;
    g.fillText(translit(station.name), 207, 205);
  });
}

export function signalPlateTex(name) {
  return canvasTex(`sig:${name}`, 128, 96, (g, w, h) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#111'; g.font = `bold 58px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, w / 2, h / 2 + 3);
  });
}

export function speedBoardTex(v) {
  return canvasTex(`spd:${v}`, 128, 128, (g, w, h) => {
    g.fillStyle = '#f5f5f0'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#111'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#111'; g.font = `bold ${v >= 100 ? 58 : 72}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(v), w / 2, h / 2 + 4);
  });
}

export function kmPostTex(km) {
  return canvasTex(`km:${km}`, 64, 128, (g, w, h) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#111'; g.font = `bold 44px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(km), w / 2, h / 2);
  });
}

export function stopMarkerTex(cars) {
  return canvasTex(`stop:${cars}`, 128, 160, (g, w, h) => {
    g.fillStyle = '#f5f5f5'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c4161c'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = '#111'; g.font = `bold 64px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(cars), w / 2, 62);
    g.font = `bold 26px ${FONT}`; g.fillText('ВАГ.', w / 2, 120);
  });
}

export function textBoardTex(key, lines, { bg = '#203057', fg = '#fff', w = 512, h = 128, size = 54 } = {}) {
  return canvasTex(`tb:${key}`, w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = `600 ${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((t, i) => g.fillText(t, w / 2, (h / (lines.length + 1)) * (i + 1)));
  });
}

// Динамическое табло отправления поездов (LED)
export class DepartureBoard {
  constructor(line, station) {
    this.c = document.createElement('canvas'); this.c.width = 768; this.c.height = 192;
    this.tex = new THREE.CanvasTexture(this.c); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.line = line; this.station = station; this.lastKey = '';
  }
  update(rows) {
    const key = JSON.stringify(rows);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const g = this.c.getContext('2d'), w = this.c.width, h = this.c.height;
    g.fillStyle = '#050505'; g.fillRect(0, 0, w, h);
    g.font = `bold 40px "Courier New", monospace`; g.textBaseline = 'middle';
    rows.slice(0, 3).forEach((r, i) => {
      const y = 36 + i * 60;
      g.fillStyle = '#ffb21e'; g.textAlign = 'left'; g.fillText(r.time, 14, y);
      g.fillText(r.dest.toUpperCase().slice(0, 18), 160, y);
      g.textAlign = 'right'; g.fillStyle = r.note === 'ПРИБЫВАЕТ' ? '#55ff66' : '#ffb21e'; g.fillText(r.note || '', w - 14, y);
    });
    this.tex.needsUpdate = true;
  }
}
