/* graph.js — turns raw OSM ways/nodes into a compact, serialisable routing graph.
 *
 * The graph is stored in typed arrays rather than objects: a city-sized pack is
 * ~100k nodes / ~120k edges, and plain objects would cost tens of megabytes of
 * heap and make IndexedDB round-trips slow. Coordinates are int32 at 1e-7°
 * (~1 cm), which is exact enough for navigation and half the size of float64.
 */

import { cellKey, flatDistance, CELL } from '../lib/geo.js';

export const COORD_SCALE = 1e7;

/* ---------- edge flags ---------- */
export const F = {
  CAR_FWD:   1 << 0,
  CAR_BWD:   1 << 1,
  BIKE_FWD:  1 << 2,
  BIKE_BWD:  1 << 3,
  FOOT:      1 << 4,
  TOLL:      1 << 5,
  UNPAVED:   1 << 6,
  FERRY:     1 << 7,
  MOTORWAY:  1 << 8,
  TRAIL:     1 << 9,   // path / footway / track — walkable, not a road
  STEPS:     1 << 10,
  TUNNEL:    1 << 11,
  BRIDGE:    1 << 12,
  CALM:      1 << 13,  // living_street, residential, pedestrian
  SCENIC:    1 << 14,  // tagged scenic, tree-lined, inside a park or along water
  PRIVATE:   1 << 15,
  ROUNDABOUT:1 << 16,
  LINK:      1 << 17,
};

/** Default free-flow speeds (km/h) by highway class. */
const SPEEDS = {
  motorway: 110, motorway_link: 70,
  trunk: 90, trunk_link: 60,
  primary: 70, primary_link: 50,
  secondary: 60, secondary_link: 45,
  tertiary: 55, tertiary_link: 40,
  unclassified: 45, residential: 35, living_street: 15,
  service: 20, road: 35, track: 20,
  pedestrian: 8, footway: 5, path: 5, steps: 2, cycleway: 18, bridleway: 8,
};

const CAR_CLASSES = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential',
  'living_street', 'service', 'road']);
const FOOT_CLASSES = new Set(['footway', 'path', 'steps', 'pedestrian', 'track', 'bridleway', 'living_street',
  'residential', 'unclassified', 'service', 'tertiary', 'secondary', 'primary', 'road', 'cycleway']);
const BIKE_BLOCKED = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'steps']);
const UNPAVED_SURFACES = new Set(['unpaved', 'gravel', 'fine_gravel', 'ground', 'dirt', 'earth', 'sand',
  'mud', 'grass', 'compacted', 'pebblestone', 'woodchips']);

/** Parse `maxspeed`, including "RU:urban"-style implicit values. */
export function parseMaxspeed(value) {
  if (!value) return null;
  const v = String(value).toLowerCase().trim();
  if (v === 'none') return 130;
  if (v.includes('walk')) return 7;
  const implicit = { 'ru:urban': 60, 'ru:rural': 90, 'ru:motorway': 110, 'ru:living_street': 20,
                     'by:urban': 60, 'by:rural': 90, 'kz:urban': 60, 'ua:urban': 50 };
  if (implicit[v]) return implicit[v];
  const mph = v.match(/^(\d+)\s*mph$/);
  if (mph) return Math.round(Number(mph[1]) * 1.609);
  const num = v.match(/^(\d+)/);
  return num ? Number(num[1]) : null;
}

/** Derive flags + speed + a display name from a way's tags. */
export function classifyWay(tags) {
  const hw = tags.highway;
  const isFerry = tags.route === 'ferry';
  if (!hw && !isFerry) return null;

  let flags = 0;
  let speed = isFerry ? 20 : (SPEEDS[hw] ?? 30);

  const access = tags.access;
  const blockedForAll = access === 'no' || access === 'private';
  if (blockedForAll) flags |= F.PRIVATE;

  /* --- car --- */
  const carOk = (isFerry || CAR_CLASSES.has(hw))
    && tags.motor_vehicle !== 'no' && tags.motorcar !== 'no'
    && !(blockedForAll && tags.motor_vehicle !== 'yes');
  const oneway = tags.oneway;
  const onewayFwd = oneway === 'yes' || oneway === '1' || oneway === 'true' || tags.junction === 'roundabout';
  const onewayBwd = oneway === '-1' || oneway === 'reverse';
  if (carOk) {
    if (!onewayBwd) flags |= F.CAR_FWD;
    if (!onewayFwd) flags |= F.CAR_BWD;
  }

  /* --- bicycle --- */
  const bikeOk = !BIKE_BLOCKED.has(hw) && tags.bicycle !== 'no' && !blockedForAll;
  if (bikeOk) {
    const bikeOneway = tags['oneway:bicycle'] ?? (tags.cycleway ? 'no' : oneway);
    const bFwd = !(bikeOneway === '-1' || bikeOneway === 'reverse');
    const bBwd = !(bikeOneway === 'yes' || bikeOneway === '1' || bikeOneway === 'true');
    if (bFwd) flags |= F.BIKE_FWD;
    if (bBwd) flags |= F.BIKE_BWD;
  }

  /* --- foot (always bidirectional; oneway rarely applies to pedestrians) --- */
  const footOk = (FOOT_CLASSES.has(hw) || isFerry) && tags.foot !== 'no'
    && hw !== 'motorway' && hw !== 'motorway_link' && hw !== 'trunk'
    && !(blockedForAll && tags.foot !== 'yes');
  if (footOk) flags |= F.FOOT;

  /* --- attributes --- */
  if (tags.toll === 'yes') flags |= F.TOLL;
  if (isFerry) flags |= F.FERRY;
  if (hw === 'motorway' || hw === 'motorway_link') flags |= F.MOTORWAY;
  if (hw === 'steps') flags |= F.STEPS;
  if (tags.tunnel && tags.tunnel !== 'no') flags |= F.TUNNEL;
  if (tags.bridge && tags.bridge !== 'no') flags |= F.BRIDGE;
  if (hw === 'living_street' || hw === 'residential' || hw === 'pedestrian') flags |= F.CALM;
  if (['path', 'footway', 'track', 'bridleway', 'steps'].includes(hw)) flags |= F.TRAIL;

  const surface = tags.surface;
  if (surface && UNPAVED_SURFACES.has(surface)) flags |= F.UNPAVED;
  else if (!surface && (hw === 'track' || hw === 'path')) flags |= F.UNPAVED;

  if (tags.junction === 'roundabout' || tags.junction === 'circular') flags |= F.ROUNDABOUT;
  if (hw?.endsWith('_link')) flags |= F.LINK;
  if (tags.scenic === 'yes' || tags.tourism === 'yes' || tags.tree_lined === 'yes'
      || tags['route'] === 'scenic' || tags.leisure === 'park') flags |= F.SCENIC;

  const tagged = parseMaxspeed(tags.maxspeed);
  if (tagged) speed = tagged;
  if (flags & F.UNPAVED) speed = Math.min(speed, hw === 'track' ? 25 : 40);
  if (tags.smoothness === 'bad' || tags.smoothness === 'very_bad') speed = Math.min(speed, 20);

  return {
    flags,
    speed: Math.max(3, Math.min(255, Math.round(speed))),
    maxspeed: tagged,
    name: tags.name || tags.ref || tags['name:ru'] || '',
    ref: tags.ref || '',
    sac: tags.sac_scale || '',
    highway: hw || 'ferry',
    junction: tags.junction || '',
    lanes: Number(tags.lanes) || 0,
  };
}

/**
 * Build the packed graph.
 * @param {{nodes: Map<number,[number,number]>, ways: Array<{id:number, nodes:number[], tags:object}>}} osm
 */
export function buildGraph(osm, { onProgress } = {}) {
  const { nodes, ways } = osm;

  /* 1. Count node usage so we can collapse everything between junctions. */
  const usage = new Map();
  const usable = [];
  for (const way of ways) {
    const info = classifyWay(way.tags ?? {});
    if (!info || !(info.flags & (F.CAR_FWD | F.CAR_BWD | F.BIKE_FWD | F.BIKE_BWD | F.FOOT))) continue;
    const refs = way.nodes.filter((id) => nodes.has(id));
    if (refs.length < 2) continue;
    usable.push({ refs, info });
    for (let i = 0; i < refs.length; i++) {
      const id = refs[i];
      // endpoints always split; interior nodes split when shared with another way
      usage.set(id, (usage.get(id) ?? 0) + (i === 0 || i === refs.length - 1 ? 2 : 1));
    }
  }
  onProgress?.('classify', usable.length);

  /* 2. Assign compact indices to junction nodes only. */
  const nodeIndex = new Map();
  const nodeLon = [], nodeLat = [];
  const indexOf = (osmId) => {
    let idx = nodeIndex.get(osmId);
    if (idx === undefined) {
      const [lon, lat] = nodes.get(osmId);
      idx = nodeLon.length;
      nodeLon.push(Math.round(lon * COORD_SCALE));
      nodeLat.push(Math.round(lat * COORD_SCALE));
      nodeIndex.set(osmId, idx);
    }
    return idx;
  };

  /* 3. Collapse each way into junction-to-junction edges, keeping geometry. */
  const edgeFrom = [], edgeTo = [], edgeLen = [], edgeFlags = [], edgeSpeed = [];
  const geomOffset = [0], geomLon = [], geomLat = [];
  const names = [], nameIdx = new Map();
  const edgeName = [];

  const nameId = (name) => {
    if (!name) return -1;
    let id = nameIdx.get(name);
    if (id === undefined) { id = names.length; names.push(name); nameIdx.set(name, id); }
    return id;
  };

  for (const { refs, info } of usable) {
    let startPos = 0;
    for (let i = 1; i < refs.length; i++) {
      const isSplit = i === refs.length - 1 || (usage.get(refs[i]) ?? 0) > 1;
      if (!isSplit) continue;

      const slice = refs.slice(startPos, i + 1);
      let length = 0;
      const coords = slice.map((id) => nodes.get(id));
      for (let k = 1; k < coords.length; k++) length += flatDistance(coords[k - 1], coords[k]);
      if (length < 0.5) { startPos = i; continue; }

      edgeFrom.push(indexOf(slice[0]));
      edgeTo.push(indexOf(slice[slice.length - 1]));
      edgeLen.push(length);
      edgeFlags.push(info.flags);
      edgeSpeed.push(info.speed);
      edgeName.push(nameId(info.name));
      // interior geometry only — endpoints live in the node arrays
      for (let k = 1; k < coords.length - 1; k++) {
        geomLon.push(Math.round(coords[k][0] * COORD_SCALE));
        geomLat.push(Math.round(coords[k][1] * COORD_SCALE));
      }
      geomOffset.push(geomLon.length);
      startPos = i;
    }
  }
  onProgress?.('edges', edgeFrom.length);

  /* 4. CSR adjacency: every edge is reachable from both endpoints; direction is
        decided at query time from the flags, so one entry per (node, edge) pair. */
  const degree = new Int32Array(nodeLon.length + 1);
  for (let e = 0; e < edgeFrom.length; e++) { degree[edgeFrom[e]]++; degree[edgeTo[e]]++; }
  const adjStart = new Int32Array(nodeLon.length + 1);
  for (let i = 0; i < nodeLon.length; i++) adjStart[i + 1] = adjStart[i] + degree[i];
  const cursor = Int32Array.from(adjStart);
  const adjEdge = new Int32Array(adjStart[nodeLon.length]);
  for (let e = 0; e < edgeFrom.length; e++) {
    adjEdge[cursor[edgeFrom[e]]++] = e;
    adjEdge[cursor[edgeTo[e]]++] = e;
  }

  /* 5. Spatial index over edges for snapping. */
  const cells = new Map();
  for (let e = 0; e < edgeFrom.length; e++) {
    const lon = nodeLon[edgeFrom[e]] / COORD_SCALE, lat = nodeLat[edgeFrom[e]] / COORD_SCALE;
    const lon2 = nodeLon[edgeTo[e]] / COORD_SCALE, lat2 = nodeLat[edgeTo[e]] / COORD_SCALE;
    // register both endpoints and the midpoint; long edges also register their interior
    for (const [x, y] of [[lon, lat], [lon2, lat2], [(lon + lon2) / 2, (lat + lat2) / 2]]) {
      const key = cellKey(x, y);
      const bucket = cells.get(key);
      if (bucket) { if (bucket[bucket.length - 1] !== e) bucket.push(e); }
      else cells.set(key, [e]);
    }
  }

  return {
    version: 2,
    nodeLon: Int32Array.from(nodeLon),
    nodeLat: Int32Array.from(nodeLat),
    edgeFrom: Int32Array.from(edgeFrom),
    edgeTo: Int32Array.from(edgeTo),
    edgeLen: Float32Array.from(edgeLen),
    edgeFlags: Uint32Array.from(edgeFlags),
    edgeSpeed: Uint8Array.from(edgeSpeed),
    edgeName: Int32Array.from(edgeName),
    geomOffset: Int32Array.from(geomOffset),
    geomLon: Int32Array.from(geomLon),
    geomLat: Int32Array.from(geomLat),
    adjStart, adjEdge,
    names,
    cells,
  };
}

/* ---------- accessors ---------- */

export const nodeCoord = (g, i) => [g.nodeLon[i] / COORD_SCALE, g.nodeLat[i] / COORD_SCALE];

/** Full geometry of an edge, oriented from→to (or reversed). */
export function edgeGeometry(g, e, reverse = false) {
  const out = [nodeCoord(g, g.edgeFrom[e])];
  for (let k = g.geomOffset[e]; k < g.geomOffset[e + 1]; k++) {
    out.push([g.geomLon[k] / COORD_SCALE, g.geomLat[k] / COORD_SCALE]);
  }
  out.push(nodeCoord(g, g.edgeTo[e]));
  return reverse ? out.reverse() : out;
}

export const edgeNameOf = (g, e) => (g.edgeName[e] >= 0 ? g.names[g.edgeName[e]] : '');

/** Candidate edges near a point, widening the search ring until something is found. */
export function edgesNear(g, lon, lat, radiusCells = 1) {
  const cx = Math.floor(lon / CELL), cy = Math.floor(lat / CELL);
  const out = new Set();
  for (let x = cx - radiusCells; x <= cx + radiusCells; x++) {
    for (let y = cy - radiusCells; y <= cy + radiusCells; y++) {
      for (const e of g.cells.get(`${x}:${y}`) ?? []) out.add(e);
    }
  }
  return out;
}

/* ---------- (de)serialisation ---------- */

export function serializeGraph(g) {
  return {
    version: g.version,
    nodeLon: g.nodeLon.buffer, nodeLat: g.nodeLat.buffer,
    edgeFrom: g.edgeFrom.buffer, edgeTo: g.edgeTo.buffer,
    edgeLen: g.edgeLen.buffer, edgeFlags: g.edgeFlags.buffer,
    edgeSpeed: g.edgeSpeed.buffer, edgeName: g.edgeName.buffer,
    geomOffset: g.geomOffset.buffer, geomLon: g.geomLon.buffer, geomLat: g.geomLat.buffer,
    adjStart: g.adjStart.buffer, adjEdge: g.adjEdge.buffer,
    names: g.names,
    cellKeys: [...g.cells.keys()],
    cellData: Int32Array.from(flatten(g.cells)).buffer,
    cellLens: Int32Array.from([...g.cells.values()].map((v) => v.length)).buffer,
  };
}

function* flatten(cells) { for (const arr of cells.values()) yield* arr; }

export function deserializeGraph(raw) {
  const cells = new Map();
  const data = new Int32Array(raw.cellData);
  const lens = new Int32Array(raw.cellLens);
  let pos = 0;
  raw.cellKeys.forEach((key, i) => {
    cells.set(key, Array.from(data.subarray(pos, pos + lens[i])));
    pos += lens[i];
  });
  return {
    version: raw.version,
    nodeLon: new Int32Array(raw.nodeLon), nodeLat: new Int32Array(raw.nodeLat),
    edgeFrom: new Int32Array(raw.edgeFrom), edgeTo: new Int32Array(raw.edgeTo),
    edgeLen: new Float32Array(raw.edgeLen), edgeFlags: new Uint32Array(raw.edgeFlags),
    edgeSpeed: new Uint8Array(raw.edgeSpeed), edgeName: new Int32Array(raw.edgeName),
    geomOffset: new Int32Array(raw.geomOffset), geomLon: new Int32Array(raw.geomLon),
    geomLat: new Int32Array(raw.geomLat),
    adjStart: new Int32Array(raw.adjStart), adjEdge: new Int32Array(raw.adjEdge),
    names: raw.names, cells,
  };
}

export function graphStats(g) {
  const bytes = [g.nodeLon, g.nodeLat, g.edgeFrom, g.edgeTo, g.edgeLen, g.edgeFlags, g.edgeSpeed,
    g.edgeName, g.geomOffset, g.geomLon, g.geomLat, g.adjStart, g.adjEdge]
    .reduce((sum, a) => sum + a.byteLength, 0);
  return { nodes: g.nodeLon.length, edges: g.edgeFrom.length, bytes };
}
