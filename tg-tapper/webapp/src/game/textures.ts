// Procedural textures drawn with Canvas2D, so the prototype runs without art assets.
// Any of these can be swapped for a PNG later: Assets.load('tools/needle.png').
import { Texture } from 'pixi.js';

type Draw = (c: CanvasRenderingContext2D, w: number, h: number) => void;

function make(w: number, h: number, draw: Draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  draw(c, w, h);
  return Texture.from(cv);
}

const rad = (c: CanvasRenderingContext2D, x: number, y: number, r: number, stops: [number, string][]) => {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
};

const lin = (c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) => {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
};

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

/** Glossy liquid dome: blood, pus, water. */
function dome(base: string, dark: string, alpha = 1): Draw {
  return (c, w) => {
    const r = w / 2 - 2;
    c.globalAlpha = alpha;
    c.fillStyle = rad(c, w * 0.42, w * 0.4, r * 1.1, [
      [0, base],
      [0.75, base],
      [1, dark],
    ]);
    c.beginPath();
    c.arc(w / 2, w / 2, r, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    // specular highlight
    c.fillStyle = rad(c, w * 0.36, w * 0.32, r * 0.35, [
      [0, 'rgba(255,255,255,0.95)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    c.beginPath();
    c.arc(w * 0.36, w * 0.32, r * 0.35, 0, Math.PI * 2);
    c.fill();
    // rim light
    c.strokeStyle = 'rgba(255,255,255,0.25)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(w / 2, w / 2, r - 3, Math.PI * 0.15, Math.PI * 0.75);
    c.stroke();
  };
}

export function createTextures() {
  return {
    soft: make(128, 128, (c, w) => {
      c.fillStyle = rad(c, w / 2, w / 2, w / 2, [
        [0, 'rgba(255,255,255,1)'],
        [0.5, 'rgba(255,255,255,0.6)'],
        [1, 'rgba(255,255,255,0)'],
      ]);
      c.fillRect(0, 0, w, w);
    }),
    hard: make(64, 64, (c, w) => {
      c.fillStyle = rad(c, w / 2, w / 2, w / 2, [
        [0, '#fff'],
        [0.8, '#fff'],
        [1, 'rgba(255,255,255,0)'],
      ]);
      c.fillRect(0, 0, w, w);
    }),
    foam: make(128, 128, (c, w) => {
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * w * 0.32;
        const x = w / 2 + Math.cos(a) * d;
        const y = w / 2 + Math.sin(a) * d;
        const r = 6 + Math.random() * 14;
        c.fillStyle = rad(c, x - r * 0.3, y - r * 0.3, r, [
          [0, 'rgba(255,255,255,0.98)'],
          [0.85, 'rgba(240,244,255,0.92)'],
          [1, 'rgba(180,190,215,0.9)'],
        ]);
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      }
    }),
    bubble: make(64, 64, (c, w) => {
      const r = w / 2 - 3;
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.lineWidth = 2;
      c.fillStyle = rad(c, w / 2, w / 2, r, [
        [0, 'rgba(255,255,255,0.02)'],
        [0.8, 'rgba(180,220,255,0.15)'],
        [1, 'rgba(255,190,240,0.4)'],
      ]);
      c.beginPath();
      c.arc(w / 2, w / 2, r, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.beginPath();
      c.ellipse(w * 0.36, w * 0.32, 6, 4, -0.6, 0, Math.PI * 2);
      c.fill();
    }),
    water: make(64, 64, dome('rgba(225,240,255,0.35)', 'rgba(120,150,190,0.55)')),
    blood: make(64, 64, dome('#a3121c', '#4a0207')),
    pus: make(64, 64, dome('#efd77c', '#b08a2c')),
    sparkle: make(64, 64, (c, w) => {
      c.fillStyle = '#fff';
      c.translate(w / 2, w / 2);
      for (let i = 0; i < 2; i++) {
        c.rotate(Math.PI / 2 * i);
        c.beginPath();
        c.moveTo(0, -w / 2);
        c.quadraticCurveTo(2, -2, w / 2, 0);
        c.quadraticCurveTo(2, 2, 0, w / 2);
        c.quadraticCurveTo(-2, 2, -w / 2, 0);
        c.quadraticCurveTo(-2, -2, 0, -w / 2);
        c.fill();
      }
    }),
    heart: make(64, 64, (c) => {
      c.fillStyle = '#ff5c8a';
      c.beginPath();
      c.moveTo(32, 56);
      c.bezierCurveTo(4, 36, 6, 8, 32, 20);
      c.bezierCurveTo(58, 8, 60, 36, 32, 56);
      c.fill();
    }),
    ring: make(128, 128, (c, w) => {
      c.strokeStyle = '#fff';
      c.lineWidth = 6;
      c.beginPath();
      c.arc(w / 2, w / 2, w / 2 - 6, 0, Math.PI * 2);
      c.stroke();
    }),
    speck: make(32, 32, (c) => {
      c.fillStyle = 'rgba(70,52,38,0.9)';
      c.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const r = 7 + Math.random() * 7;
        c.lineTo(16 + Math.cos(a) * r, 16 + Math.sin(a) * r);
      }
      c.fill();
    }),
    // Acupuncture needle: steel shaft + copper spiral handle. Tip at bottom center.
    needle: make(24, 240, (c, w, h) => {
      c.fillStyle = lin(c, 0, 0, w, 0, [
        [0, '#7a8088'],
        [0.5, '#f4f7fa'],
        [1, '#80868e'],
      ]);
      c.beginPath();
      c.moveTo(w / 2 - 1.6, 80);
      c.lineTo(w / 2 + 1.6, 80);
      c.lineTo(w / 2 + 0.3, h);
      c.lineTo(w / 2 - 0.3, h);
      c.fill();
      c.fillStyle = lin(c, 0, 0, w, 0, [
        [0, '#7b4a1c'],
        [0.5, '#e9a65a'],
        [1, '#6e4016'],
      ]);
      roundRect(c, 3, 8, w - 6, 74, 4);
      c.fill();
      c.strokeStyle = 'rgba(60,30,8,0.55)';
      c.lineWidth = 1;
      for (let y = 12; y < 80; y += 3.5) {
        c.beginPath();
        c.moveTo(3, y);
        c.lineTo(w - 3, y + 1.5);
        c.stroke();
      }
      c.fillStyle = '#c7cdd4';
      c.beginPath();
      c.arc(w / 2, 6, 5, 0, Math.PI * 2);
      c.fill();
    }),
    cotton: make(110, 96, (c) => {
      for (let i = 0; i < 18; i++) {
        const x = 20 + Math.random() * 70;
        const y = 22 + Math.random() * 52;
        const r = 14 + Math.random() * 12;
        c.fillStyle = rad(c, x - 4, y - 5, r, [
          [0, '#ffffff'],
          [0.7, '#f3f3f6'],
          [1, 'rgba(210,210,225,0)'],
        ]);
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      }
    }),
    gauze: make(120, 110, (c, w, h) => {
      c.fillStyle = '#f7f7f2';
      roundRect(c, 6, 6, w - 12, h - 12, 8);
      c.fill();
      c.strokeStyle = 'rgba(180,180,170,0.6)';
      c.lineWidth = 1;
      for (let i = 10; i < w; i += 6) {
        c.beginPath();
        c.moveTo(i, 8);
        c.lineTo(i, h - 8);
        c.stroke();
        c.beginPath();
        c.moveTo(8, i);
        c.lineTo(w - 8, i);
        c.stroke();
      }
    }),
    towel: make(150, 110, (c, w, h) => {
      c.fillStyle = '#f2e6ef';
      roundRect(c, 4, 10, w - 8, h - 20, 18);
      c.fill();
      c.fillStyle = 'rgba(200,150,190,0.5)';
      c.fillRect(4, h - 34, w - 8, 8);
      c.fillStyle = 'rgba(255,255,255,0.6)';
      for (let i = 0; i < 300; i++) c.fillRect(8 + Math.random() * (w - 16), 14 + Math.random() * (h - 28), 2, 2);
    }),
    feather: make(90, 260, (c, w, h) => {
      c.translate(w / 2, h);
      c.strokeStyle = '#d9cfc2';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(0, 0);
      c.quadraticCurveTo(8, -h * 0.5, 0, -h + 6);
      c.stroke();
      for (let i = 0; i < 46; i++) {
        const t = 0.18 + (i / 46) * 0.8;
        const y = -h * t;
        const len = Math.sin(t * Math.PI) * 38 + 6;
        c.strokeStyle = `rgba(${235 - i},${110 + i},${180 + i},0.8)`;
        c.lineWidth = 2;
        for (const s of [-1, 1]) {
          c.beginPath();
          c.moveTo(4 * t, y);
          c.quadraticCurveTo(s * len * 0.6, y - 10, s * len, y - 22);
          c.stroke();
        }
      }
    }),
    // Squeeze bottle with nozzle; nozzle tip at top center.
    bottle: make(80, 170, (c, w, h) => {
      c.fillStyle = '#f0f0f0';
      c.beginPath();
      c.moveTo(w / 2 - 4, 0);
      c.lineTo(w / 2 + 4, 0);
      c.lineTo(w / 2 + 10, 30);
      c.lineTo(w / 2 - 10, 30);
      c.fill();
      c.fillStyle = '#222';
      c.fillRect(w / 2 - 16, 30, 32, 16);
      c.fillStyle = lin(c, 0, 0, w, 0, [
        [0, 'rgba(230,170,60,0.85)'],
        [0.4, 'rgba(255,220,130,0.95)'],
        [1, 'rgba(190,120,30,0.9)'],
      ]);
      roundRect(c, 6, 46, w - 12, h - 50, 14);
      c.fill();
      c.fillStyle = '#fff';
      roundRect(c, 14, 80, w - 28, 50, 6);
      c.fill();
      c.fillStyle = '#c47a2a';
      c.font = 'bold 15px sans-serif';
      c.textAlign = 'center';
      c.fillText('OIL', w / 2, 110);
    }),
    shampoo: make(80, 170, (c, w, h) => {
      c.fillStyle = '#e0e0e0';
      c.fillRect(w / 2 - 5, 0, 10, 24);
      c.fillStyle = '#b54aa0';
      roundRect(c, w / 2 - 20, 20, 40, 22, 6);
      c.fill();
      c.fillStyle = lin(c, 0, 0, w, 0, [
        [0, '#8a5bd6'],
        [0.4, '#c49cf5'],
        [1, '#6a3bb6'],
      ]);
      roundRect(c, 6, 40, w - 12, h - 44, 20);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.font = 'bold 12px sans-serif';
      c.textAlign = 'center';
      c.fillText('SHAMPOO', w / 2, 100);
    }),
    peroxide: make(80, 170, (c, w, h) => {
      c.fillStyle = '#ddd';
      c.fillRect(w / 2 - 4, 0, 8, 26);
      c.fillStyle = '#fff';
      roundRect(c, w / 2 - 16, 22, 32, 20, 4);
      c.fill();
      c.fillStyle = lin(c, 0, 0, w, 0, [
        [0, '#5a3a1a'],
        [0.4, '#8a5a2a'],
        [1, '#4a2a10'],
      ]);
      roundRect(c, 8, 40, w - 16, h - 44, 10);
      c.fill();
      c.fillStyle = '#fff';
      roundRect(c, 14, 76, w - 28, 54, 4);
      c.fill();
      c.fillStyle = '#2a64c8';
      c.font = 'bold 11px sans-serif';
      c.textAlign = 'center';
      c.fillText('H₂O₂', w / 2, 98);
      c.fillText('3%', w / 2, 116);
    }),
    saline: make(80, 170, (c, w, h) => {
      c.fillStyle = '#ccc';
      c.fillRect(w / 2 - 3, 0, 6, 28);
      c.fillStyle = lin(c, 0, 0, w, 0, [
        [0, 'rgba(190,220,250,0.7)'],
        [0.5, 'rgba(240,250,255,0.9)'],
        [1, 'rgba(160,200,240,0.7)'],
      ]);
      roundRect(c, 10, 26, w - 20, h - 30, 12);
      c.fill();
      c.fillStyle = '#1d6fd1';
      c.font = 'bold 11px sans-serif';
      c.textAlign = 'center';
      c.fillText('NaCl', w / 2, 92);
      c.fillText('0.9%', w / 2, 108);
    }),
    tube: make(70, 170, (c, w, h) => {
      c.fillStyle = '#ececec';
      c.fillRect(w / 2 - 6, 0, 12, 22);
      c.fillStyle = lin(c, 0, 0, w, 0, [
        [0, '#2a8a5a'],
        [0.5, '#5fd39a'],
        [1, '#1f6a44'],
      ]);
      c.beginPath();
      c.moveTo(w / 2 - 12, 22);
      c.lineTo(w / 2 + 12, 22);
      c.lineTo(w - 6, h - 14);
      c.lineTo(6, h - 14);
      c.fill();
      c.fillStyle = '#ddd';
      c.fillRect(6, h - 14, w - 12, 10);
    }),
    shower: make(150, 150, (c) => {
      c.fillStyle = lin(c, 0, 0, 150, 0, [
        [0, '#9aa3ad'],
        [0.5, '#f1f4f7'],
        [1, '#8a939d'],
      ]);
      c.save();
      c.translate(75, 60);
      c.rotate(-0.5);
      roundRect(c, -12, 10, 24, 90, 10);
      c.fill();
      c.restore();
      c.beginPath();
      c.ellipse(60, 40, 48, 30, 0.4, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#5b6570';
      for (let i = 0; i < 18; i++) {
        c.beginPath();
        c.arc(40 + (i % 6) * 8, 30 + Math.floor(i / 6) * 10, 1.8, 0, Math.PI * 2);
        c.fill();
      }
    }),
    // Coil tattoo machine; needle tip at bottom center.
    machine: make(100, 200, (c, w, h) => {
      c.fillStyle = '#3a3a44';
      roundRect(c, w / 2 - 10, 60, 20, h - 74, 8);
      c.fill();
      c.fillStyle = lin(c, 0, 0, w, 0, [
        [0, '#5a5a66'],
        [0.5, '#c8c8d4'],
        [1, '#4a4a56'],
      ]);
      roundRect(c, 10, 10, w - 20, 60, 10);
      c.fill();
      c.fillStyle = '#c03a6a';
      c.beginPath();
      c.arc(30, 40, 14, 0, Math.PI * 2);
      c.arc(70, 40, 14, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#ddd';
      c.fillRect(w / 2 - 1, h - 16, 2, 16);
    }),
    laser: make(90, 200, (c, w, h) => {
      c.fillStyle = lin(c, 0, 0, w, 0, [
        [0, '#2b2f3a'],
        [0.5, '#8c93a6'],
        [1, '#22262f'],
      ]);
      roundRect(c, w / 2 - 22, 0, 44, h - 40, 16);
      c.fill();
      c.fillStyle = '#111';
      c.beginPath();
      c.moveTo(w / 2 - 22, h - 44);
      c.lineTo(w / 2 + 22, h - 44);
      c.lineTo(w / 2 + 8, h - 6);
      c.lineTo(w / 2 - 8, h - 6);
      c.fill();
      c.fillStyle = '#2ee8ff';
      c.fillRect(w / 2 - 12, 30, 24, 6);
    }),
    swab: make(40, 200, (c, w, h) => {
      c.fillStyle = '#f1e6c9';
      c.fillRect(w / 2 - 2, 30, 4, h - 30);
      c.fillStyle = rad(c, w / 2, 20, 18, [
        [0, '#ffffff'],
        [1, '#e4e4ea'],
      ]);
      c.beginPath();
      c.ellipse(w / 2, 22, 12, 22, 0, 0, Math.PI * 2);
      c.fill();
    }),
    ice: make(130, 110, (c, w, h) => {
      c.fillStyle = lin(c, 0, 0, w, h, [
        [0, '#bfe9ff'],
        [1, '#5fb6e8'],
      ]);
      roundRect(c, 6, 6, w - 12, h - 12, 22);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.7)';
      c.font = 'bold 34px sans-serif';
      c.textAlign = 'center';
      c.fillText('❄', w / 2, h / 2 + 12);
    }),
    paper: make(130, 100, (c, w, h) => {
      c.fillStyle = 'rgba(245,240,255,0.95)';
      roundRect(c, 4, 4, w - 8, h - 8, 4);
      c.fill();
      c.strokeStyle = 'rgba(120,60,200,0.6)';
      c.setLineDash([4, 4]);
      c.strokeRect(14, 14, w - 28, h - 28);
    }),
    // Clear cling film, tiled with wrinkle highlights.
    film: make(256, 256, (c, w, h) => {
      c.fillStyle = 'rgba(220,235,255,0.16)';
      c.fillRect(0, 0, w, h);
      for (let i = 0; i < 14; i++) {
        c.strokeStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.35})`;
        c.lineWidth = 1 + Math.random() * 3;
        c.beginPath();
        const y = Math.random() * h;
        c.moveTo(0, y);
        c.bezierCurveTo(w * 0.3, y + (Math.random() - 0.5) * 60, w * 0.7, y + (Math.random() - 0.5) * 60, w, y + (Math.random() - 0.5) * 30);
        c.stroke();
      }
    }),
    bandage: make(200, 200, (c, w, h) => {
      c.fillStyle = '#e9c9a5';
      roundRect(c, 0, 50, w, h - 100, 40);
      c.fill();
      c.fillStyle = 'rgba(160,120,90,0.35)';
      for (let i = 0; i < 120; i++) c.fillRect(Math.random() * w, 55 + Math.random() * (h - 110), 2, 2);
      c.fillStyle = '#fbfbf7';
      roundRect(c, w * 0.28, 60, w * 0.44, h - 120, 8);
      c.fill();
    }),
    cut: make(128, 64, (c, w, h) => {
      // Inflamed laceration: dark slit with raw edges.
      c.fillStyle = rad(c, w / 2, h / 2, w / 2, [
        [0, 'rgba(190,40,50,0.9)'],
        [0.6, 'rgba(200,70,70,0.45)'],
        [1, 'rgba(200,80,80,0)'],
      ]);
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#5a0a12';
      c.lineWidth = 6;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(18, h / 2 + 4);
      c.bezierCurveTo(44, h / 2 - 6, 80, h / 2 + 8, w - 18, h / 2 - 3);
      c.stroke();
      c.strokeStyle = 'rgba(255,170,160,0.6)';
      c.lineWidth = 2;
      c.stroke();
    }),
  };
}

export type Textures = ReturnType<typeof createTextures>;
export type TexName = keyof Textures;
