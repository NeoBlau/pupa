/* regions.js — orchestrates an offline pack: tiles + road graph + cameras + trails + places. */

import { idb } from '../lib/idb.js';
import { uid } from '../lib/util.js';
import { bboxPad, bboxOf, bboxAreaKm2, cellKey } from '../lib/geo.js';
import { buildGraph, serializeGraph, deserializeGraph, graphStats } from '../routing/graph.js';
import { fetchRoadNetwork, fetchCameras, fetchTrails, fetchScenicPOIs, fetchPlaces } from './osm.js';
import { planTiles, downloadTiles, deleteTiles, stylesToCache, DETAIL } from './tiles.js';
import { buildTrails } from '../features/trails-build.js';

/** Hard ceiling — beyond this Overpass times out and the browser runs out of heap. */
export const MAX_AREA_KM2 = { city: 3500, region: 60000, route: 25000 };

export async function listRegions() {
  const rows = await idb.getAll('regions');
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getRegionGraph(regionId) {
  const row = await idb.get('graph', regionId);
  return row ? deserializeGraph(row.data) : null;
}

/** Regions whose bbox contains a point, most detailed first. */
export async function regionsAt(coords) {
  const all = await listRegions();
  return all.filter((r) => coords[0] >= r.bbox[0] && coords[0] <= r.bbox[2]
                        && coords[1] >= r.bbox[1] && coords[1] <= r.bbox[3])
            .sort((a, b) => bboxAreaKm2(a.bbox) - bboxAreaKm2(b.bbox));
}

/**
 * Download a full offline pack.
 * @param {object} opts
 * @param {number[]} opts.bbox
 * @param {string} opts.name
 * @param {'city'|'region'|'route'} opts.detail
 * @param {(p:object)=>void} opts.onProgress
 * @param {AbortSignal} opts.signal
 */
export async function downloadRegion({ bbox, name, detail = 'city', styles, include = {},
                                       onProgress = () => {}, signal, id } = {}) {
  const area = bboxAreaKm2(bbox);
  if (area > (MAX_AREA_KM2[detail] ?? 3500)) {
    throw Object.assign(new Error('area too large'), { code: 'AREA_TOO_LARGE', area });
  }

  const regionId = id ?? uid();
  const want = { tiles: true, roads: true, cameras: true, trails: detail !== 'region', places: true, ...include };
  const cacheStyles = stylesToCache(styles ?? []);
  const report = (phase, done, total, note) => onProgress({ regionId, phase, done, total, note });

  const record = {
    id: regionId, name, bbox, detail, styles: cacheStyles,
    createdAt: Date.now(), updatedAt: Date.now(),
    status: 'downloading', counts: {}, bytes: 0,
  };
  await idb.put('regions', record);

  try {
    /* 1. Road graph first: it is what makes offline routing possible at all. */
    if (want.roads) {
      report('roads', 0, 1);
      const osm = await fetchRoadNetwork(bboxPad(bbox, 2000), {
        walkable: detail !== 'region', signal,
        onProgress: ({ done, total }) => report('roads', done, total),
      });
      const graph = buildGraph(osm);
      const stats = graphStats(graph);
      await idb.put('graph', { regionId, data: serializeGraph(graph), stats, updatedAt: Date.now() });
      record.counts.nodes = stats.nodes;
      record.counts.edges = stats.edges;
      record.bytes += stats.bytes;
      report('roads', 1, 1, `${stats.edges} edges`);
    }

    /* 2. Cameras — small, fast, and the feature people notice first. */
    if (want.cameras) {
      const cams = await fetchCameras(bbox, { signal, onProgress: ({ done, total }) => report('cameras', done, total) });
      await idb.deleteByIndex('cameras', 'regionId', regionId);
      await idb.putAll('cameras', cams.map((c) => ({ ...c, regionId })));
      record.counts.cameras = cams.length;
    }

    /* 3. Trails + the viewpoints that decide how scenic they are. */
    if (want.trails) {
      const [raw, pois] = await Promise.all([
        fetchTrails(bbox, { signal, onProgress: ({ done, total }) => report('trails', done, total) }),
        fetchScenicPOIs(bbox, { signal, onProgress: ({ done, total }) => report('scenic', done, total) }),
      ]);
      const trails = buildTrails(raw, pois);
      await idb.deleteByIndex('trails', 'regionId', regionId);
      await idb.putAll('trails', trails.map((t) => ({ ...t, regionId })));
      await idb.deleteByIndex('pois', 'regionId', regionId);
      await idb.putAll('pois', pois.map((p) => ({ ...p, regionId, tokens: p.name ? p.name.toLowerCase().split(/\s+/) : [] })));
      record.counts.trails = trails.length;
      record.counts.scenicPois = pois.length;
    }

    /* 4. Named places so offline search returns something useful. */
    if (want.places) {
      const places = await fetchPlaces(bbox, { signal, onProgress: ({ done, total }) => report('places', done, total) });
      await idb.putAll('pois', places.map((p) => ({ ...p, regionId })));
      record.counts.places = places.length;
    }

    /* 5. Tiles last: the longest phase, and the one safest to resume later. */
    if (want.tiles) {
      const plan = planTiles(bbox, detail, cacheStyles);
      const res = await downloadTiles(plan.urls, {
        signal, onProgress: ({ done, total }) => report('tiles', done, total),
      });
      record.counts.tiles = res.stored;
      record.bytes += res.bytes;
      record.tilesFailed = res.failed;
    }

    record.status = 'ready';
    record.updatedAt = Date.now();
    await idb.put('regions', record);
    report('done', 1, 1);
    return record;
  } catch (err) {
    record.status = err.name === 'AbortError' ? 'cancelled' : 'failed';
    record.error = err.message;
    await idb.put('regions', record);
    throw err;
  }
}

/** Corridor pack around a planned route — the cheapest useful offline unit. */
export function corridorBBox(coordinates, widthMetres = 6000) {
  return bboxPad(bboxOf(coordinates), widthMetres);
}

export async function deleteRegion(regionId) {
  const region = await idb.get('regions', regionId);
  if (!region) return false;
  await Promise.all([
    idb.delete('graph', regionId),
    idb.deleteByIndex('cameras', 'regionId', regionId),
    idb.deleteByIndex('trails', 'regionId', regionId),
    idb.deleteByIndex('pois', 'regionId', regionId),
  ]);
  await deleteTiles(region.bbox, region.detail, region.styles);
  await idb.delete('regions', regionId);
  return true;
}

/** User-added cameras live outside any region so they survive deletions. */
export async function addUserCamera(coords, kind = 'speed', maxspeed = null, direction = null) {
  const cam = {
    id: `user:${uid()}`, coords, cell: cellKey(coords[0], coords[1]),
    kind, maxspeed, direction, source: 'user', regionId: '__user__', createdAt: Date.now(),
  };
  await idb.put('cameras', cam);
  return cam;
}

export { DETAIL };
