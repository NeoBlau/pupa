// Generates placeholder art in public/models/<id>/. Replace these files with real photos.
// Run: node scripts/gen-placeholders.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const MODELS = {
  anna: { skin: '#f2c4a8', bg: ['#2a0f3d', '#0b0712'] },
  kate: { skin: '#f6d0b8', bg: ['#1d1f4a', '#09091a'] },
  kim: { skin: '#efc9a3', bg: ['#3a0f2a', '#0f0710'] },
  tiffany: { skin: '#8e5b3c', bg: ['#2b1238', '#0b0610'] },
  mia: { skin: '#e7b894', bg: ['#0f2b3a', '#060c12'] },
  lola: { skin: '#c98f6b', bg: ['#3a1a0f', '#100805'] },
};

// One sole seen from below, toes up. Shared by room.svg and mask.svg so they always align.
const SOLE = 'M520 1460 C 700 1462 768 1330 752 1160 C 742 1020 770 880 800 720 C 812 640 800 560 760 520 C 640 470 420 450 262 470 C 214 520 206 610 228 700 C 262 820 330 900 352 1040 C 368 1140 322 1230 330 1320 C 342 1420 410 1458 520 1460 Z';
const TOES = [
  [330, 345, 98, 128],
  [482, 300, 64, 88],
  [592, 330, 56, 78],
  [684, 385, 50, 66],
  [764, 455, 44, 56],
];
const shapes = (fill) =>
  `<path d="${SOLE}" fill="${fill}"/>` + TOES.map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}"/>`).join('');

function room(skin, [bg1, bg2]) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1600" viewBox="0 0 1000 1600">
<defs>
  <radialGradient id="bg" cx="50%" cy="35%" r="80%"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></radialGradient>
  <radialGradient id="skin" cx="45%" cy="45%" r="70%"><stop offset="0" stop-color="${skin}" stop-opacity="1"/><stop offset="0.75" stop-color="${skin}"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></radialGradient>
  <radialGradient id="pad" cx="50%" cy="40%" r="55%"><stop offset="0" stop-color="#fff" stop-opacity="0.28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <radialGradient id="pink" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ff7d7d" stop-opacity="0.22"/><stop offset="1" stop-color="#ff7d7d" stop-opacity="0"/></radialGradient>
  <filter id="blur"><feGaussianBlur stdDeviation="40"/></filter>
  <filter id="soft"><feGaussianBlur stdDeviation="3"/></filter>
  <clipPath id="clip">${shapes('#000')}</clipPath>
</defs>
<rect width="1000" height="1600" fill="url(#bg)"/>
<g filter="url(#blur)" opacity="0.55">
  <ellipse cx="520" cy="300" rx="200" ry="260" fill="${skin}" opacity="0.35"/>
  <ellipse cx="820" cy="1300" rx="160" ry="420" fill="${skin}" opacity="0.4"/>
  <ellipse cx="200" cy="1100" rx="140" ry="380" fill="#000"/>
</g>
<g filter="url(#soft)" opacity="0.6" transform="translate(14 22)">${shapes('#000')}</g>
<g>${shapes('url(#skin)')}</g>
<g clip-path="url(#clip)">
  <ellipse cx="510" cy="620" rx="270" ry="150" fill="url(#pink)"/>
  <ellipse cx="520" cy="1300" rx="200" ry="170" fill="url(#pink)"/>
  <ellipse cx="500" cy="600" rx="240" ry="120" fill="url(#pad)"/>
  <ellipse cx="530" cy="1290" rx="170" ry="140" fill="url(#pad)"/>
  ${TOES.map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y - ry * 0.15}" rx="${rx * 0.7}" ry="${ry * 0.6}" fill="url(#pad)"/>`).join('')}
  <path d="M300 760 C 380 860 420 980 410 1120" stroke="#000" stroke-opacity="0.1" stroke-width="40" fill="none" filter="url(#soft)"/>
  ${Array.from({ length: 14 }, (_, i) => `<path d="M${330 + i * 22} ${820 + (i % 3) * 30} q 20 ${60 + (i % 4) * 12} ${4 - (i % 3) * 6} ${120 + (i % 5) * 18}" stroke="#5a2a1a" stroke-opacity="0.08" stroke-width="2" fill="none"/>`).join('')}
  <path d="M250 500 C 420 470 640 480 770 530" stroke="#5a2a1a" stroke-opacity="0.12" stroke-width="5" fill="none"/>
</g>
</svg>`;
}

const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1600" viewBox="0 0 1000 1600">${shapes('#fff')}</svg>`;

function card(name, i, [bg1, bg2], skin, w, h, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><radialGradient id="g" cx="${30 + i * 20}%" cy="30%" r="90%"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></radialGradient>
<filter id="b"><feGaussianBlur stdDeviation="${18 + i * 6}"/></filter></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<g filter="url(#b)"><ellipse cx="${w * (0.4 + i * 0.1)}" cy="${h * 0.55}" rx="${w * 0.28}" ry="${h * 0.32}" fill="${skin}" opacity="0.75"/><circle cx="${w * 0.75}" cy="${h * 0.25}" r="${w * 0.15}" fill="#ec4899" opacity="0.35"/></g>
<text x="50%" y="${h * 0.86}" text-anchor="middle" font-family="sans-serif" font-size="${w * 0.08}" font-weight="800" fill="#fff" opacity="0.9">${name}</text>
<text x="50%" y="${h * 0.93}" text-anchor="middle" font-family="sans-serif" font-size="${w * 0.04}" fill="#fff" opacity="0.55">${label}</text>
</svg>`;
}

for (const [id, m] of Object.entries(MODELS)) {
  const dir = new URL(`../public/models/${id}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  const name = id[0].toUpperCase() + id.slice(1);
  writeFileSync(new URL('room.svg', dir), room(m.skin, m.bg));
  writeFileSync(new URL('mask.svg', dir), mask);
  for (let i = 1; i <= 3; i++) {
    writeFileSync(new URL(`cover${i}.svg`, dir), card(name, i - 1, m.bg, m.skin, 600, 600, `cover ${i} — your photo here`));
    writeFileSync(new URL(`g${i}.svg`, dir), card(name, i - 1, m.bg, m.skin, 600, 800, `gallery ${i}`));
  }
}
console.log('placeholders written');
