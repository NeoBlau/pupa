/* trails-build.js — turns raw OSM hiking data into ranked, walkable trail objects.
 *
 * "Scenic" is not an OSM tag you can just read off, so it is scored: what you can
 * see from the trail (viewpoints, peaks, waterfalls, water), how the path itself
 * is built (unpaved, winding, named, waymarked), and how far it stays away from
 * roads. The score drives both the map colour and the sort order.
 */

import { lineLength, bboxOf, cellKey, flatDistance, sinuosity, simplify, bboxCenter } from '../lib/geo.js';

const SAC_RANK = {
  hiking: 1, mountain_hiking: 2, demanding_mountain_hiking: 3,
  alpine_hiking: 4, demanding_alpine_hiking: 5, difficult_alpine_hiking: 6,
};

const SCENIC_WEIGHT = { viewpoint: 16, peak: 14, water: 9, cave: 8, shelter: 3, rest: 2 };

/** Join relation member ways into continuous lines, following shared endpoints. */
export function stitch(members, tolerance = 40) {
  const pieces = members.filter((m) => m.length >= 2).map((m) => m.slice());
  const lines = [];
  while (pieces.length) {
    let line = pieces.shift();
    let extended = true;
    while (extended) {
      extended = false;
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        const head = line[0], tail = line[line.length - 1];
        if (flatDistance(tail, p[0]) < tolerance)        { line = line.concat(p.slice(1)); }
        else if (flatDistance(tail, p[p.length - 1]) < tolerance) { line = line.concat(p.slice().reverse().slice(1)); }
        else if (flatDistance(head, p[p.length - 1]) < tolerance) { line = p.slice(0, -1).concat(line); }
        else if (flatDistance(head, p[0]) < tolerance)   { line = p.slice().reverse().slice(0, -1).concat(line); }
        else continue;
        pieces.splice(i, 1); extended = true; break;
      }
    }
    lines.push(line);
  }
  return lines.sort((a, b) => lineLength(b) - lineLength(a));
}

/** Count scenic POIs close enough to the trail to actually be experienced. */
function scenicNearby(coords, pois, radius = 350) {
  const sampled = coords.filter((_, i) => i % Math.max(1, Math.floor(coords.length / 120)) === 0);
  const hits = [];
  for (const poi of pois) {
    for (const c of sampled) {
      if (flatDistance(c, poi.coords) <= radius) { hits.push(poi); break; }
    }
  }
  return hits;
}

/**
 * Score 0–100. The curve is deliberately generous at the low end so that an
 * ordinary forest path still reads as greener than a roadside footway.
 */
export function scenicScore(coords, tags, nearbyPois) {
  let score = 12;

  const counts = {};
  for (const p of nearbyPois) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
  for (const [kind, n] of Object.entries(counts)) {
    score += (SCENIC_WEIGHT[kind] ?? 2) * Math.min(3, n) * (n > 3 ? 1.15 : 1);
  }

  const km = lineLength(coords) / 1000;
  if (km > 2) score += 6;
  if (km > 8) score += 6;

  // a winding path through terrain beats a straight utility track
  const turnPerKm = sinuosity(coords) / Math.max(0.3, km);
  if (turnPerKm > 120) score += 10;
  else if (turnPerKm > 50) score += 5;

  if (tags.sac_scale) score += 8;
  if (tags.route === 'hiking' || tags.network) score += 10;
  if (tags.name) score += 4;
  if (tags.osmc_symbol || tags.marked_trail || tags['trail_visibility']) score += 4;
  if (tags.surface && ['ground', 'dirt', 'earth', 'grass', 'rock'].includes(tags.surface)) score += 5;
  if (tags.highway === 'footway' && tags.surface === 'asphalt') score -= 12;
  if (tags.highway === 'track') score -= 4;
  if (tags.informal === 'yes') score -= 3;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function difficultyOf(tags, coords) {
  const sac = SAC_RANK[tags.sac_scale] ?? 0;
  if (sac) return sac;
  const km = lineLength(coords) / 1000;
  if (tags.highway === 'footway' || tags.highway === 'track') return 1;
  return km > 12 ? 2 : 1;
}

const isLoop = (coords) => coords.length > 3 && flatDistance(coords[0], coords[coords.length - 1]) < 150;

/**
 * @param {{ways:Array, relations:Array}} raw
 * @param {Array} pois scenic POIs from the same bbox
 */
export function buildTrails(raw, pois = []) {
  const out = [];

  for (const rel of raw.relations ?? []) {
    for (const line of stitch(rel.members)) {
      if (lineLength(line) < 500) continue;
      out.push(makeTrail(`rel:${rel.id}:${out.length}`, line, rel.tags, pois, 'route'));
    }
  }

  /* Individual ways only earn an entry when a relation has not already covered them. */
  for (const way of raw.ways ?? []) {
    if (way.coords.length < 2) continue;
    const len = lineLength(way.coords);
    if (len < 400) continue;
    if (out.some((t) => overlaps(t.coords, way.coords))) continue;
    out.push(makeTrail(`way:${way.id}`, way.coords, way.tags, pois, 'path'));
  }

  return out.sort((a, b) => b.scenic - a.scenic);
}

function makeTrail(id, coords, tags, pois, kind) {
  const geometry = simplify(coords, 6);
  const nearby = scenicNearby(geometry, pois);
  const bbox = bboxOf(geometry);
  const centre = bboxCenter(bbox);
  return {
    id,
    kind,
    name: tags.name ?? tags['name:ru'] ?? tags.ref ?? '',
    ref: tags.ref ?? '',
    network: tags.network ?? '',
    coords: geometry,
    bbox,
    cell: cellKey(centre[0], centre[1]),
    length: Math.round(lineLength(geometry)),
    scenic: scenicScore(geometry, tags, nearby),
    difficulty: difficultyOf(tags, geometry),
    loop: isLoop(geometry),
    surface: tags.surface ?? '',
    sac: tags.sac_scale ?? '',
    viewpoints: nearby.filter((p) => p.kind === 'viewpoint' || p.kind === 'peak').length,
    water: nearby.some((p) => p.kind === 'water'),
    shelters: nearby.filter((p) => p.kind === 'shelter').length,
    poiIds: nearby.map((p) => p.id),
    ascent: null,   // filled in by the elevation pass when a network is available
    descent: null,
    elevation: null,
    source: 'osm',
  };
}

/** Cheap containment test: are most of b's sampled points already on a? */
function overlaps(a, b, tolerance = 45) {
  const sample = b.filter((_, i) => i % Math.max(1, Math.floor(b.length / 8)) === 0);
  let hits = 0;
  for (const p of sample) {
    for (const q of a) { if (flatDistance(p, q) < tolerance) { hits++; break; } }
  }
  return hits / sample.length > 0.7;
}
