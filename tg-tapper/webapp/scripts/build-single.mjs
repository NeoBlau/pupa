// Packs the built game (dist/) into ONE self-contained HTML file that opens straight from disk
// (double-click, file://) with no server: JS, CSS and every asset (mesh, textures, HDRI) inlined.
// Progress is then stored in the browser (localStorage). Usage: npm run build:single
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const OUT = new URL('../sole-spa.html', import.meta.url).pathname;

const MIME = {
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream',
  '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.md': 'text/plain',
};

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let html = readFileSync(join(DIST, 'index.html'), 'utf8');
const safe = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1');

// Inline the bundle and stylesheet.
let appFile = '';
html = html.replace(/<script type="module" crossorigin src="\.\/(assets\/[^"]+)"><\/script>/, (_, f) => ((appFile = f), '<!--APP-->'));
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+)">/, (_, f) => `<style>${safe(readFileSync(join(DIST, f), 'utf8'))}</style>`);
// The Telegram SDK is only useful inside Telegram; offline it would just fail to load.
html = html.replace(/\s*<script src="https:\/\/telegram\.org\/js\/telegram-web-app\.js"><\/script>/, '');
html = html.replace('<title>Mini App</title>', '<title>Sole Spa</title>');

// Every other file becomes an embedded asset.
const assets = {};
for (const p of walk(DIST)) {
  const rel = relative(DIST, p).split('\\').join('/');
  if (rel === 'index.html' || rel.startsWith('assets/')) continue;
  assets[rel] = [MIME[extname(p).toLowerCase()] ?? 'application/octet-stream', readFileSync(p).toString('base64')];
}

// Shim (classic script, runs before the app): serves embedded assets to fetch(), <img> and three.js loaders.
const shim = `<script>
(() => {
  const A = ${JSON.stringify(assets)};
  const urls = {};
  const base = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  const key = (u) => {
    if (typeof u !== 'string') return null;
    let k = u;
    if (k.startsWith(base)) k = k.slice(base.length);
    k = k.replace(/^\\.\\//, '').replace(/[?#].*$/, '');
    return A[k] ? k : null;
  };
  const blobOf = (k) => {
    const [type, b64] = A[k];
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type });
  };
  const url = (u) => {
    const k = key(u);
    if (!k) return u;
    return (urls[k] ||= URL.createObjectURL(blobOf(k)));
  };
  window.__assetURL = url;
  const f = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const u = typeof input === 'string' ? input : input && input.url;
    const k = key(u);
    return k ? f(url(k), init) : f(input, init);
  };
  const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', { get() { return d.get.call(this); }, set(v) { d.set.call(this, url(v)); }, configurable: true });
  const sa = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (n, v) { return sa.call(this, n, n === 'src' || n === 'href' ? url(v) : v); };
})();
</script>`;

const app = `<script type="module">${safe(readFileSync(join(DIST, appFile), 'utf8'))}</script>`;
// Shim + app go at the end of <body> (the app needs #root); a function replacer keeps "$" in the code literal.
html = html.replace('<!--APP-->', '').replace('</body>', () => `${shim}\n${app}\n</body>`);
writeFileSync(OUT, html);
console.log(`wrote ${OUT} (${(statSync(OUT).size / 1048576).toFixed(1)} MB, ${Object.keys(assets).length} assets)`);
