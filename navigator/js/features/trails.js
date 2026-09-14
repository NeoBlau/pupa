/* trails.js — querying downloaded trails and enriching them with elevation. */

import { idb } from '../lib/idb.js';
import { flatDistance, cellsAround, cumulative, pointAlong, lineLength } from '../lib/geo.js';
import { fetchElevations } from '../routing/online.js';
import { fetchTrails, fetchScenicPOIs } from '../offline/osm.js';
import { buildTrails } from './trails-build.js';
import { bboxPad } from '../lib/geo.js';

/** Trails already stored near a point, best scenery first. */
export async function trailsNear(coords, radius = 20000, { minScenic = 0, limit = 40 } = {}) {
  const rows = await idb.byIndexAny('trails', 'cell', cellsAround(coords[0], coords[1], radius));
  return rows
    .map((t) => ({ ...t, distance: distanceToTrail(coords, t) }))
    .filter((t) => t.distance <= radius && t.scenic >= minScenic)
    .sort((a, b) => (b.scenic - a.scenic) || (a.distance - b.distance))
    .slice(0, limit);
}

function distanceToTrail(coords, trail) {
  let best = Infinity;
  const stride = Math.max(1, Math.floor(trail.coords.length / 40));
  for (let i = 0; i < trail.coords.length; i += stride) {
    const d = flatDistance(coords, trail.coords[i]);
    if (d < best) best = d;
  }
  return best;
}

/** Fetch trails around a point live, then store them so they work offline later. */
export async function discoverTrails(coords, radiusMetres = 15000, { signal, onProgress } = {}) {
  const bbox = bboxPad([coords[0], coords[1], coords[0], coords[1]], radiusMetres);
  const [raw, pois] = await Promise.all([
    fetchTrails(bbox, { signal, onProgress }),
    fetchScenicPOIs(bbox, { signal, onProgress }),
  ]);
  const trails = buildTrails(raw, pois);
  await idb.putAll('trails', trails.map((t) => ({ ...t, regionId: '__discovered__' })));
  await idb.putAll('pois', pois.map((p) => ({
    ...p, regionId: '__discovered__',
    tokens: p.name ? p.name.toLowerCase().split(/\s+/).filter((w) => w.length >= 2) : [],
  })));
  return trails;
}

/**
 * Attach an elevation profile. Needs a network once; the result is stored, so
 * the profile stays available on the trail itself afterwards.
 */
export async function withElevation(trail, { signal, samples = 90 } = {}) {
  if (trail.elevation?.length) return trail;
  if (!navigator.onLine) return trail;

  const cum = cumulative(trail.coords);
  const total = cum[cum.length - 1];
  const points = Array.from({ length: samples }, (_, i) =>
    pointAlong(trail.coords, (total * i) / (samples - 1), cum));

  const elevations = await fetchElevations(points, { signal });
  const clean = elevations.map((e) => (Number.isFinite(e) ? e : null));

  let ascent = 0, descent = 0, previous = null;
  for (const e of clean) {
    if (e == null) continue;
    if (previous != null) {
      const delta = e - previous;
      // ignore sub-3 m wobble, which is SRTM noise rather than real climbing
      if (delta > 3) ascent += delta;
      else if (delta < -3) descent += -delta;
    }
    previous = e;
  }

  const enriched = {
    ...trail,
    elevation: clean,
    elevationDistances: Array.from({ length: samples }, (_, i) => (total * i) / (samples - 1)),
    ascent: Math.round(ascent), descent: Math.round(descent),
    minEle: Math.round(Math.min(...clean.filter(Number.isFinite))),
    maxEle: Math.round(Math.max(...clean.filter(Number.isFinite))),
  };
  await idb.put('trails', enriched);
  return enriched;
}

/** Naismith's rule, the classic walking-time estimate: pace plus climb. */
export function hikingDuration(lengthMetres, ascentMetres = 0, difficulty = 1) {
  const paceKmh = [5, 4.5, 4, 3.4, 2.9, 2.4, 2][Math.min(6, Math.max(1, difficulty)) - 1] ?? 4;
  const flat = (lengthMetres / 1000) / paceKmh * 3600;
  const climb = (ascentMetres / 600) * 3600;      // ~10 min per 100 m of ascent
  return flat + climb;
}

export function difficultyKey(difficulty) {
  return `trails.sac${Math.min(6, Math.max(1, difficulty || 1))}`;
}

/** Scenic POIs that sit on a given trail. */
export async function trailPOIs(trail) {
  if (!trail.poiIds?.length) return [];
  const out = [];
  for (const id of trail.poiIds) {
    const row = await idb.get('pois', id);
    if (row) out.push(row);
  }
  return out;
}

export const trailLength = (trail) => trail.length ?? lineLength(trail.coords);
