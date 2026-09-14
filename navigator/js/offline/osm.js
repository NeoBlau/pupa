/* osm.js — Overpass downloads: road graph, speed cameras, trails, searchable POIs.
 *
 * Overpass mirrors rate-limit aggressively, so every query rotates hosts, retries
 * with backoff, and large areas are split into tiles that stay under the timeout.
 */

import { pool, sleep } from '../lib/util.js';
import { bboxAreaKm2, cellKey } from '../lib/geo.js';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

let mirrorCursor = 0;

/** POST a query, rotating mirrors on failure or rate-limit. */
export async function overpass(query, { signal, retries = MIRRORS.length * 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    const url = MIRRORS[mirrorCursor++ % MIRRORS.length];
    try {
      const res = await fetch(url, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
      });
      if (res.status === 429 || res.status === 504) throw new Error(`overpass busy (${res.status})`);
      if (!res.ok) throw new Error(`overpass HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastErr = err;
      await sleep(Math.min(8000, 700 * 2 ** Math.floor(attempt / MIRRORS.length)));
    }
  }
  throw lastErr ?? new Error('Overpass unreachable');
}

/** Overpass wants south,west,north,east — our bboxes are west,south,east,north. */
const bboxParam = (b) => `${b[1].toFixed(5)},${b[0].toFixed(5)},${b[3].toFixed(5)},${b[2].toFixed(5)}`;

/** Split a bbox so no tile exceeds `maxDeg` on a side; keeps each query small. */
export function splitBBox(bbox, maxDeg = 0.25) {
  const [w, s, e, n] = bbox;
  const cols = Math.max(1, Math.ceil((e - w) / maxDeg));
  const rows = Math.max(1, Math.ceil((n - s) / maxDeg));
  const out = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      out.push([
        w + ((e - w) * i) / cols, s + ((n - s) * j) / rows,
        w + ((e - w) * (i + 1)) / cols, s + ((n - s) * (j + 1)) / rows,
      ]);
    }
  }
  return out;
}

/* ---------- road graph ---------- */

const ROAD_FILTER_CAR = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const ROAD_FILTER_ALL = `${ROAD_FILTER_CAR}|footway|path|steps|pedestrian|track|cycleway|bridleway`;

function roadQuery(bbox, { walkable = true, timeout = 180 }) {
  const filter = walkable ? ROAD_FILTER_ALL : ROAD_FILTER_CAR;
  return `[out:json][timeout:${timeout}];
(
  way["highway"~"^(${filter})$"](${bboxParam(bbox)});
  way["route"="ferry"](${bboxParam(bbox)});
);
out body;
>;
out skel qt;`;
}

/**
 * Download the road network for a bbox.
 * @returns {{nodes: Map<number,[number,number]>, ways: Array}}
 */
export async function fetchRoadNetwork(bbox, { walkable = true, signal, onProgress } = {}) {
  const tiles = splitBBox(bbox, bboxAreaKm2(bbox) > 4000 ? 0.2 : 0.35);
  const nodes = new Map();
  const ways = [];
  const seenWays = new Set();

  const jobs = tiles.map((tile) => async () => {
    const data = await overpass(roadQuery(tile, { walkable }), { signal });
    for (const el of data.elements ?? []) {
      if (el.type === 'node') { if (!nodes.has(el.id)) nodes.set(el.id, [el.lon, el.lat]); }
      else if (el.type === 'way' && !seenWays.has(el.id)) {
        seenWays.add(el.id);
        ways.push({ id: el.id, nodes: el.nodes, tags: el.tags ?? {} });
      }
    }
  });

  await pool(jobs, 2, (done, total) => onProgress?.({ phase: 'roads', done, total }));
  return { nodes, ways };
}

/* ---------- speed cameras ---------- */

const CAMERA_QUERY = (bbox) => `[out:json][timeout:120];
(
  node["highway"="speed_camera"](${bboxParam(bbox)});
  node["enforcement"](${bboxParam(bbox)});
  way["highway"="speed_camera"](${bboxParam(bbox)});
  node["man_made"="surveillance"]["surveillance:type"="ALPR"](${bboxParam(bbox)});
  relation["type"="enforcement"](${bboxParam(bbox)});
);
out center tags;`;

/** Map OSM enforcement tagging onto the alert categories the radar uses. */
export function cameraKind(tags = {}) {
  const enf = tags.enforcement ?? '';
  if (enf.includes('average_speed') || tags['enforcement:average_speed'] === 'yes') return 'average';
  if (enf.includes('traffic_signals') || enf.includes('stop')) return 'redLight';
  if (enf.includes('bus_lane') || enf.includes('psv')) return 'bus';
  if (enf.includes('parking') || enf.includes('mindistance')) return 'parking';
  if (tags.highway === 'speed_camera' || enf.includes('maxspeed')) return 'speed';
  if (tags['surveillance:type'] === 'ALPR') return 'speed';
  return 'speed';
}

export async function fetchCameras(bbox, { signal, onProgress } = {}) {
  const tiles = splitBBox(bbox, 0.6);
  const out = new Map();
  const jobs = tiles.map((tile) => async () => {
    const data = await overpass(CAMERA_QUERY(tile), { signal });
    for (const el of data.elements ?? []) {
      const lon = el.lon ?? el.center?.lon;
      const lat = el.lat ?? el.center?.lat;
      if (lon == null || lat == null) continue;
      const tags = el.tags ?? {};
      const id = `osm:${el.type[0]}${el.id}`;
      if (out.has(id)) continue;
      const maxspeed = parseInt(tags.maxspeed ?? tags['enforcement:maxspeed'] ?? '', 10);
      out.set(id, {
        id, coords: [lon, lat], cell: cellKey(lon, lat),
        kind: cameraKind(tags),
        maxspeed: Number.isFinite(maxspeed) ? maxspeed : null,
        direction: parseDirection(tags.direction),
        lensDirection: parseDirection(tags['camera:direction'] ?? tags['surveillance:direction']),
        name: tags.name ?? '',
        source: 'osm',
      });
    }
  });
  await pool(jobs, 2, (done, total) => onProgress?.({ phase: 'cameras', done, total }));
  return [...out.values()];
}

/** A direction tag may be a compass bearing or a cardinal name such as "NNE". */
function parseDirection(raw) {
  if (raw == null) return null;
  const num = Number(raw);
  if (Number.isFinite(num)) return ((num % 360) + 360) % 360;
  const compass = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
    S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
  return compass[String(raw).toUpperCase()] ?? null;
}

/* ---------- hiking trails and the things that make them worth walking ---------- */

const TRAIL_QUERY = (bbox) => `[out:json][timeout:180];
(
  relation["route"="hiking"](${bboxParam(bbox)});
  relation["route"="foot"](${bboxParam(bbox)});
  way["highway"~"^(path|footway|track|bridleway|steps)$"]["sac_scale"](${bboxParam(bbox)});
  way["highway"~"^(path|footway|track)$"]["name"](${bboxParam(bbox)});
);
out geom tags;`;

const SCENIC_POI_QUERY = (bbox) => `[out:json][timeout:120];
(
  node["tourism"="viewpoint"](${bboxParam(bbox)});
  node["natural"="peak"](${bboxParam(bbox)});
  node["natural"="waterfall"](${bboxParam(bbox)});
  node["waterway"="waterfall"](${bboxParam(bbox)});
  node["natural"="spring"](${bboxParam(bbox)});
  node["natural"="cave_entrance"](${bboxParam(bbox)});
  node["tourism"="alpine_hut"](${bboxParam(bbox)});
  node["tourism"="wilderness_hut"](${bboxParam(bbox)});
  node["amenity"="shelter"](${bboxParam(bbox)});
  node["amenity"="drinking_water"](${bboxParam(bbox)});
  node["tourism"="picnic_site"](${bboxParam(bbox)});
);
out tags;`;

const POI_KIND = {
  viewpoint: 'viewpoint', peak: 'peak', waterfall: 'water', spring: 'water',
  drinking_water: 'water', cave_entrance: 'cave', alpine_hut: 'shelter',
  wilderness_hut: 'shelter', shelter: 'shelter', picnic_site: 'rest',
};

export async function fetchTrails(bbox, { signal, onProgress } = {}) {
  const tiles = splitBBox(bbox, 0.5);
  const ways = new Map();
  const relations = new Map();

  const jobs = tiles.map((tile) => async () => {
    const data = await overpass(TRAIL_QUERY(tile), { signal });
    for (const el of data.elements ?? []) {
      const tags = el.tags ?? {};
      if (el.type === 'way' && el.geometry) {
        if (ways.has(el.id)) continue;
        ways.set(el.id, { id: el.id, coords: el.geometry.map((p) => [p.lon, p.lat]), tags });
      } else if (el.type === 'relation') {
        if (relations.has(el.id)) continue;
        const members = (el.members ?? []).filter((m) => m.geometry?.length)
          .map((m) => m.geometry.map((p) => [p.lon, p.lat]));
        relations.set(el.id, { id: el.id, members, tags });
      }
    }
  });
  await pool(jobs, 2, (done, total) => onProgress?.({ phase: 'trails', done, total }));
  return { ways: [...ways.values()], relations: [...relations.values()] };
}

export async function fetchScenicPOIs(bbox, { signal, onProgress } = {}) {
  const tiles = splitBBox(bbox, 0.7);
  const out = new Map();
  const jobs = tiles.map((tile) => async () => {
    const data = await overpass(SCENIC_POI_QUERY(tile), { signal });
    for (const el of data.elements ?? []) {
      if (el.lon == null) continue;
      const tags = el.tags ?? {};
      const key = tags.tourism ?? tags.natural ?? tags.waterway ?? tags.amenity;
      out.set(`osm:n${el.id}`, {
        id: `osm:n${el.id}`, coords: [el.lon, el.lat], cell: cellKey(el.lon, el.lat),
        kind: POI_KIND[key] ?? 'rest',
        name: tags.name ?? tags['name:ru'] ?? '',
        ele: tags.ele ? Number(tags.ele) : null,
        tags,
      });
    }
  });
  await pool(jobs, 2, (done, total) => onProgress?.({ phase: 'scenic', done, total }));
  return [...out.values()];
}

/* ---------- searchable offline places ---------- */

const PLACE_QUERY = (bbox) => `[out:json][timeout:180];
(
  node["place"~"^(city|town|village|suburb|neighbourhood|hamlet)$"](${bboxParam(bbox)});
  node["amenity"~"^(fuel|charging_station|pharmacy|hospital|police|atm|bank|restaurant|cafe|fast_food|parking|toilets|car_wash)$"]["name"](${bboxParam(bbox)});
  node["shop"~"^(supermarket|convenience|mall|bakery)$"]["name"](${bboxParam(bbox)});
  node["tourism"~"^(hotel|hostel|museum|attraction|information)$"]["name"](${bboxParam(bbox)});
  node["railway"="station"]["name"](${bboxParam(bbox)});
  node["aeroway"="aerodrome"]["name"](${bboxParam(bbox)});
);
out tags;`;

/** Tokens used by the offline search index — lower-cased words of length ≥ 2. */
export const tokenize = (text) =>
  (text ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/[\s-]+/).filter((w) => w.length >= 2);

export async function fetchPlaces(bbox, { signal, onProgress } = {}) {
  const tiles = splitBBox(bbox, 0.4);
  const out = new Map();
  const jobs = tiles.map((tile) => async () => {
    const data = await overpass(PLACE_QUERY(tile), { signal });
    for (const el of data.elements ?? []) {
      if (el.lon == null) continue;
      const tags = el.tags ?? {};
      const name = tags['name:ru'] ?? tags.name;
      if (!name) continue;
      const kind = tags.place ?? tags.amenity ?? tags.shop ?? tags.tourism ?? tags.railway ?? tags.aeroway ?? 'place';
      out.set(`osm:n${el.id}`, {
        id: `osm:n${el.id}`, coords: [el.lon, el.lat], cell: cellKey(el.lon, el.lat),
        name, kind,
        subtitle: [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(', '),
        rank: tags.place ? PLACE_RANK[tags.place] ?? 5 : 1,
        tokens: [...new Set([...tokenize(name), ...tokenize(tags.name), ...tokenize(tags['addr:street'])])],
      });
    }
  });
  await pool(jobs, 2, (done, total) => onProgress?.({ phase: 'places', done, total }));
  return [...out.values()];
}

const PLACE_RANK = { city: 100, town: 60, village: 30, suburb: 25, neighbourhood: 15, hamlet: 10 };
