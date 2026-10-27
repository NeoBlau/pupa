// Generates placeholder cover/gallery cards in public/models/<id>/. Replace them with real photos.
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
  for (let i = 1; i <= 3; i++) {
    writeFileSync(new URL(`cover${i}.svg`, dir), card(name, i - 1, m.bg, m.skin, 600, 600, `cover ${i} — your photo here`));
    writeFileSync(new URL(`g${i}.svg`, dir), card(name, i - 1, m.bg, m.skin, 600, 800, `gallery ${i}`));
  }
}
console.log('placeholders written');
