#!/usr/bin/env node
/* build-single.mjs — bundle the whole app into one self-contained .html.
 *
 * The point is portability: one file you can mail to yourself, drop on any
 * static host, or open from the Files app. Everything is inlined — MapLibre,
 * the stylesheet, every module, the icons and the manifest — so the file has
 * no siblings to lose.
 *
 * Usage: node build-single.mjs [outfile]
 */

import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = import.meta.dirname;
const out = resolve(process.argv[2] ?? `${ROOT}/dist/compass.html`);

const read = (p) => readFile(resolve(ROOT, p), 'utf8');
const readB64 = async (p) => (await readFile(resolve(ROOT, p))).toString('base64');

/* 1. Roll the ES module graph into one classic script. A single file has no
      server, and `type="module"` from file:// is blocked by CORS — so the
      bundle has to be an IIFE. */
const bundled = await build({
  entryPoints: [resolve(ROOT, 'js/app.js')],
  bundle: true, format: 'iife', platform: 'browser', target: 'safari15',
  write: false, minify: false, legalComments: 'none',
  define: { 'import.meta.url': 'document.baseURI' },
});
const appJs = bundled.outputFiles[0].text;

const [maplibreJs, maplibreCss, appCss, manifest] = await Promise.all([
  read('vendor/maplibre-gl.js'),
  read('vendor/maplibre-gl.css'),
  read('css/app.css'),
  read('manifest.webmanifest'),
]);

const icons = {
  180: await readB64('assets/icon-180.png'),
  192: await readB64('assets/icon-192.png'),
  512: await readB64('assets/icon-512.png'),
  maskable: await readB64('assets/icon-maskable-512.png'),
};

/* 2. Icons and the manifest become data URIs so nothing is fetched by path. */
const manifestObject = JSON.parse(manifest);
manifestObject.start_url = '.';
manifestObject.scope = './';
manifestObject.icons = [
  { src: `data:image/png;base64,${icons[192]}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: `data:image/png;base64,${icons[512]}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: `data:image/png;base64,${icons.maskable}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];
delete manifestObject.shortcuts;
const manifestURI = `data:application/manifest+json;base64,${Buffer.from(JSON.stringify(manifestObject)).toString('base64')}`;

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no">
<title>Компас — навигатор</title>
<meta name="description" content="Офлайн и онлайн навигатор: маршруты без сети, радар камер, погода в пути и живописные пешие тропы.">
<meta name="theme-color" content="#f2f2f7">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Компас">
<meta name="mobile-web-app-capable" content="yes">
<link rel="manifest" href="${manifestURI}">
<link rel="apple-touch-icon" href="data:image/png;base64,${icons[180]}">
<link rel="icon" href="data:image/png;base64,${icons[192]}">
<style>
${maplibreCss}
</style>
<style>
${appCss}
</style>
</head>
<body>
  <div id="app">
    <div id="map"></div>
    <noscript style="position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center">
      Для работы навигатора нужен JavaScript.
    </noscript>
  </div>
  <div id="insecure-note" hidden style="position:fixed;left:12px;right:12px;bottom:12px;z-index:99;
    padding:12px 16px;border-radius:16px;background:rgba(255,159,10,.96);color:#1c1c1e;
    font:14px/1.35 -apple-system,system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.3)">
    Файл открыт локально, поэтому Safari не даёт доступ к GPS. Карта, поиск и маршруты работают;
    чтобы вести по маршруту, откройте эту же страницу по <b>https</b>.
  </div>
<script>
${maplibreJs}
</script>
<script>
${appJs}
</script>
<script>
  /* iOS hands out geolocation only on a secure origin. Say so plainly instead
     of leaving the user to wonder why the blue dot never appears. */
  if (!window.isSecureContext) document.getElementById('insecure-note').hidden = false;
</script>
</body>
</html>
`;

await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
const kb = (html.length / 1024).toFixed(0);
console.log(`${out}  ${kb} KB`);
