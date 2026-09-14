/* sw.js — offline shell plus the tile cache the region downloader fills.
 *
 * Three routing rules, in order of how often they fire:
 *   1. map tiles      → cache first, forever (they are immutable per z/x/y)
 *   2. app shell      → stale-while-revalidate, so an update lands next launch
 *   3. everything else→ network first with a cache fallback for forecasts
 */

const VERSION = 'v1';
const SHELL_CACHE = `compass-shell-${VERSION}`;
const TILE_CACHE = 'compass-tiles-v1';      // shared with js/offline/tiles.js
const API_CACHE = `compass-api-${VERSION}`;

const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css',
  './vendor/maplibre-gl.js', './vendor/maplibre-gl.css',
  './js/app.js',
  './js/lib/util.js', './js/lib/geo.js', './js/lib/idb.js',
  './js/i18n/strings.js',
  './js/core/settings.js', './js/core/store.js',
  './js/data/presets.js',
  './js/map/basemaps.js', './js/map/mapview.js',
  './js/offline/osm.js', './js/offline/tiles.js', './js/offline/regions.js',
  './js/routing/graph.js', './js/routing/router.js', './js/routing/maneuvers.js',
  './js/routing/online.js', './js/routing/service.js',
  './js/nav/engine.js', './js/nav/voice.js',
  './js/features/cameras.js', './js/features/weather.js', './js/features/search.js',
  './js/features/tracks.js', './js/features/trails.js', './js/features/trails-build.js',
  './js/ui/icons.js', './js/ui/sheet.js', './js/ui/navhud.js', './js/ui/searchpanel.js',
  './js/ui/routepanel.js', './js/ui/weatherpanel.js', './js/ui/trailspanel.js',
  './js/ui/offlinepanel.js', './js/ui/settingspanel.js',
];

const TILE_HOSTS = [
  'basemaps.cartocdn.com',
  'server.arcgisonline.com',
  'tile.opentopomap.org',
  's3.amazonaws.com',
  'tilecache.rainviewer.com',
  'fonts.openmaptiles.org',
];

const API_HOSTS = ['api.open-meteo.com', 'photon.komoot.io', 'nominatim.openstreetmap.org'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // a single failing asset must not fail the whole install
    await Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith('compass-') && n !== SHELL_CACHE && n !== TILE_CACHE && n !== API_CACHE)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (TILE_HOSTS.some((host) => url.hostname.endsWith(host))) {
    event.respondWith(tileFirst(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(request.mode === 'navigate' ? shellNavigation(request) : shellAsset(request));
    return;
  }

  if (API_HOSTS.some((host) => url.hostname.endsWith(host))) {
    event.respondWith(networkFirst(request));
  }
});

/** Tiles never change for a given z/x/y, so a hit is always safe to serve. */
async function tileFirst(request) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    // a transparent tile keeps the map coherent instead of showing torn edges
    return new Response(TRANSPARENT_PNG, { headers: { 'Content-Type': 'image/png' } });
  }
}

async function shellAsset(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return hit ?? (await network) ?? new Response('offline', { status: 503 });
}

async function shellNavigation(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put('./index.html', response.clone());
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match('./index.html')) ?? new Response('offline', { status: 503 });
  }
}

async function networkFirst(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
    throw err;
  }
}

const TRANSPARENT_PNG = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
), (c) => c.charCodeAt(0));

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
