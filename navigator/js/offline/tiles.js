/* tiles.js — prefetching and accounting of raster map tiles in Cache Storage.
   The service worker reads the same cache, so anything stored here is available
   to MapLibre with no network at all. */

import { tilesForBBox, bboxAreaKm2 } from '../lib/geo.js';
import { pool } from '../lib/util.js';
import { BASEMAPS } from '../map/basemaps.js';

export const TILE_CACHE = 'compass-tiles-v1';

/** Average bytes per 256px retina raster tile, measured across the default styles. */
const AVG_TILE_BYTES = 26 * 1024;

/** Zoom ranges by detail level; z<10 is shared background context. */
export const DETAIL = {
  city:   { min: 10, max: 16, label: 'offline.detail.city' },
  region: { min: 8,  max: 14, label: 'offline.detail.region' },
  route:  { min: 9,  max: 15, label: 'offline.detail.route' },
};

/** Resolve a tile template to a concrete URL. */
function tileURL(template, { z, x, y }) {
  return template.replace('{z}', z).replace('{x}', x).replace('{y}', y)
    .replace(/\{s\}/, 'a');
}

/** Which basemaps a pack should cover — the day/night pair plus anything asked for. */
export function stylesToCache(extra = []) {
  return [...new Set(['day', 'night', ...extra])];
}

export function planTiles(bbox, detail = 'city', styles = stylesToCache()) {
  const { min, max } = DETAIL[detail] ?? DETAIL.city;
  const list = tilesForBBox(bbox, min, max);
  const urls = [];
  for (const styleId of styles) {
    const bm = BASEMAPS[styleId];
    if (!bm) continue;
    for (const tile of list) {
      if (tile.z > bm.maxzoom) continue;
      urls.push(tileURL(bm.tiles[0], tile));
    }
  }
  return { tiles: list.length, urls, bytes: urls.length * AVG_TILE_BYTES, areaKm2: bboxAreaKm2(bbox) };
}

/** Rough size estimate without materialising every URL — used by the slider UI. */
export function estimatePack(bbox, detail = 'city', styleCount = 2) {
  const { min, max } = DETAIL[detail] ?? DETAIL.city;
  let tiles = 0;
  for (let z = min; z <= max; z++) tiles += tilesForBBox(bbox, z, z).length;
  return { tiles: tiles * styleCount, bytes: tiles * styleCount * AVG_TILE_BYTES, areaKm2: bboxAreaKm2(bbox) };
}

/**
 * Fetch and store tiles.
 * @returns {Promise<{stored:number, failed:number, bytes:number}>}
 */
export async function downloadTiles(urls, { signal, onProgress, concurrency = 6 } = {}) {
  const cache = await caches.open(TILE_CACHE);
  let stored = 0, failed = 0, bytes = 0;

  const jobs = urls.map((url) => async () => {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (await cache.match(url)) { stored++; return; }
    try {
      const res = await fetch(url, { mode: 'cors', signal, cache: 'default' });
      if (!res.ok) { failed++; return; }
      const clone = res.clone();
      await cache.put(url, res);
      stored++;
      bytes += Number(clone.headers.get('content-length')) || AVG_TILE_BYTES;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      failed++;
    }
  });

  await pool(jobs, concurrency, (done, total) => onProgress?.({ phase: 'tiles', done, total }));
  return { stored, failed, bytes };
}

/** Remove tiles that belong only to this bbox (best effort — caches are URL-keyed). */
export async function deleteTiles(bbox, detail = 'city', styles = stylesToCache()) {
  const cache = await caches.open(TILE_CACHE);
  const { urls } = planTiles(bbox, detail, styles);
  let removed = 0;
  for (const url of urls) if (await cache.delete(url)) removed++;
  return removed;
}

export async function clearTileCache() {
  return caches.delete(TILE_CACHE);
}

export async function tileCacheStats() {
  try {
    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys();
    return { count: keys.length, bytes: keys.length * AVG_TILE_BYTES };
  } catch { return { count: 0, bytes: 0 }; }
}

/** How much of a bbox is already cached — drives the "update" vs "download" label. */
export async function coverage(bbox, detail = 'city', styles = stylesToCache()) {
  const cache = await caches.open(TILE_CACHE);
  const { urls } = planTiles(bbox, detail, styles);
  if (!urls.length) return 1;
  const sample = urls.filter((_, i) => i % Math.max(1, Math.floor(urls.length / 120)) === 0);
  let hit = 0;
  for (const url of sample) if (await cache.match(url)) hit++;
  return hit / sample.length;
}
