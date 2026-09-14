/* geo.js — geodesy, polyline maths, tile maths. Coordinates are [lon, lat] (GeoJSON order). */

export const R_EARTH = 6371008.8;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** Metres per degree of longitude at a given latitude. */
export const lonScale = (lat) => Math.cos(lat * DEG) * 111320;
export const LAT_SCALE = 110574;

/** Great-circle distance in metres. */
export function haversine(a, b) {
  const dLat = (b[1] - a[1]) * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const lat1 = a[1] * DEG, lat2 = b[1] * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Fast planar distance in metres. Accurate to <0.5% for spans under ~50 km,
 * which is all the navigation hot path ever needs.
 */
export function flatDistance(a, b) {
  const mx = (a[0] - b[0]) * lonScale((a[1] + b[1]) / 2);
  const my = (a[1] - b[1]) * LAT_SCALE;
  return Math.hypot(mx, my);
}

/** Initial bearing a→b, degrees clockwise from north, 0..360. */
export function bearing(a, b) {
  const lat1 = a[1] * DEG, lat2 = b[1] * DEG, dLon = (b[0] - a[0]) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * RAD + 360) % 360;
}

/** Signed smallest angle between two bearings, −180..180. */
export function bearingDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}

/** Point at `dist` metres along `brng` from `origin`. */
export function destination(origin, dist, brng) {
  const d = dist / R_EARTH, t = brng * DEG;
  const lat1 = origin[1] * DEG, lon1 = origin[0] * DEG;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(t));
  const lon2 = lon1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(lat1),
                                 Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [((lon2 * RAD + 540) % 360) - 180, lat2 * RAD];
}

/** Closest point on segment [a,b] to p. Returns {point, t, distance}. */
export function nearestOnSegment(p, a, b) {
  const cosLat = Math.cos(((a[1] + b[1]) / 2) * DEG);
  const ax = a[0] * cosLat, ay = a[1];
  const bx = b[0] * cosLat, by = b[1];
  const px = p[0] * cosLat, py = p[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { point, t, distance: flatDistance(p, point) };
}

/**
 * Snap p onto a polyline.
 * Returns {point, index, t, distance, along} where `along` is metres from the line start.
 */
export function nearestOnLine(p, line, fromIndex = 0, toIndex = line.length - 1) {
  let best = { point: line[fromIndex], index: fromIndex, t: 0, distance: Infinity, along: 0 };
  let travelled = 0;
  for (let i = fromIndex; i < toIndex; i++) {
    const seg = nearestOnSegment(p, line[i], line[i + 1]);
    const segLen = flatDistance(line[i], line[i + 1]);
    if (seg.distance < best.distance) {
      best = { ...seg, index: i, along: travelled + segLen * seg.t };
    }
    travelled += segLen;
  }
  return best;
}

/** Cumulative distance table for a polyline (metres). */
export function cumulative(line) {
  const out = new Float64Array(line.length);
  for (let i = 1; i < line.length; i++) out[i] = out[i - 1] + flatDistance(line[i - 1], line[i]);
  return out;
}

export const lineLength = (line) => {
  let sum = 0;
  for (let i = 1; i < line.length; i++) sum += flatDistance(line[i - 1], line[i]);
  return sum;
};

/** Point at a given distance along a polyline. */
export function pointAlong(line, dist, cum = cumulative(line)) {
  if (dist <= 0) return line[0];
  const total = cum[cum.length - 1];
  if (dist >= total) return line[line.length - 1];
  let i = 1;
  while (i < cum.length && cum[i] < dist) i++;
  const t = (dist - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
  return [
    line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
    line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t,
  ];
}

/** Slice a polyline between two along-distances. */
export function sliceLine(line, startDist, endDist) {
  const cum = cumulative(line);
  const out = [pointAlong(line, startDist, cum)];
  for (let i = 0; i < line.length; i++) {
    if (cum[i] > startDist && cum[i] < endDist) out.push(line[i]);
  }
  out.push(pointAlong(line, endDist, cum));
  return out;
}

/** Douglas–Peucker simplification; tolerance in metres. */
export function simplify(line, tolerance = 5) {
  if (line.length < 3) return line.slice();
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let maxDist = -1, idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = nearestOnSegment(line[i], line[lo], line[hi]).distance;
      if (d > maxDist) { maxDist = d; idx = i; }
    }
    if (maxDist > tolerance && idx > 0) { keep[idx] = 1; stack.push([lo, idx], [idx, hi]); }
  }
  return line.filter((_, i) => keep[i]);
}

/* ---------- bounding boxes: [west, south, east, north] ---------- */

export function bboxOf(points) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < w) w = lon; if (lon > e) e = lon;
    if (lat < s) s = lat; if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

export const bboxContains = (bbox, [lon, lat]) =>
  lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];

export const bboxIntersects = (a, b) =>
  a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

export function bboxPad(bbox, metres) {
  const dLat = metres / LAT_SCALE;
  const dLon = metres / Math.max(1, lonScale((bbox[1] + bbox[3]) / 2));
  return [bbox[0] - dLon, bbox[1] - dLat, bbox[2] + dLon, bbox[3] + dLat];
}

export function bboxAreaKm2(bbox) {
  const h = (bbox[3] - bbox[1]) * LAT_SCALE;
  const w = (bbox[2] - bbox[0]) * lonScale((bbox[1] + bbox[3]) / 2);
  return (h * w) / 1e6;
}

export const bboxCenter = (bbox) => [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

/* ---------- slippy tiles ---------- */

export const lon2tile = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
export const lat2tile = (lat, z) => {
  const r = lat * DEG;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/** Every {z,x,y} covering bbox across a zoom range. */
export function tilesForBBox(bbox, minZoom, maxZoom) {
  const tiles = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const x0 = lon2tile(bbox[0], z), x1 = lon2tile(bbox[2], z);
    const y0 = lat2tile(bbox[3], z), y1 = lat2tile(bbox[1], z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push({ z, x, y });
  }
  return tiles;
}

/* ---------- spatial hashing ---------- */

/** ~1.1 km cells at the equator; good enough for camera / POI lookup. */
export const CELL = 0.01;
export const cellKey = (lon, lat) => `${Math.floor(lon / CELL)}:${Math.floor(lat / CELL)}`;

/** Cell keys covering a radius (metres) around a point. */
export function cellsAround(lon, lat, radius) {
  const dLat = radius / LAT_SCALE;
  const dLon = radius / Math.max(1, lonScale(lat));
  const keys = [];
  for (let x = Math.floor((lon - dLon) / CELL); x <= Math.floor((lon + dLon) / CELL); x++)
    for (let y = Math.floor((lat - dLat) / CELL); y <= Math.floor((lat + dLat) / CELL); y++)
      keys.push(`${x}:${y}`);
  return keys;
}

/* ---------- encoded polylines (OSRM / Google format) ---------- */

export function decodePolyline(str, precision = 5) {
  const factor = 10 ** precision;
  const coords = [];
  let index = 0, lat = 0, lon = 0;
  while (index < str.length) {
    let result = 0, shift = 0, byte;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    result = 0; shift = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lon += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push([lon / factor, lat / factor]);
  }
  return coords;
}

/** Total turn (absolute degrees) accumulated along a line — a curviness measure. */
export function sinuosity(line) {
  if (line.length < 3) return 0;
  let turn = 0;
  for (let i = 1; i < line.length - 1; i++) {
    turn += Math.abs(bearingDelta(bearing(line[i - 1], line[i]), bearing(line[i], line[i + 1])));
  }
  return turn;
}
