/* router.js — A* over the packed graph, with travel profiles and turn costs.
 *
 * Search is node-based but carries the incoming edge in the label, so turn
 * penalties (u-turns, left turns, leaving a named road) are modelled properly
 * without the memory cost of a full edge-expanded graph.
 */

import { flatDistance, bearing, bearingDelta, nearestOnLine, lineLength } from '../lib/geo.js';
import { F, edgeGeometry, edgesNear, nodeCoord, edgeNameOf } from './graph.js';

/* ---------- binary heap keyed by f-score ---------- */
class Heap {
  #keys = [];   // priorities
  #vals = [];   // labels
  get size() { return this.#keys.length; }
  push(key, val) {
    this.#keys.push(key); this.#vals.push(val);
    let i = this.#keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.#keys[p] <= this.#keys[i]) break;
      this.#swap(i, p); i = p;
    }
  }
  pop() {
    const topVal = this.#vals[0], last = this.#keys.length - 1;
    this.#keys[0] = this.#keys[last]; this.#vals[0] = this.#vals[last];
    this.#keys.pop(); this.#vals.pop();
    let i = 0;
    const n = this.#keys.length;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < n && this.#keys[l] < this.#keys[m]) m = l;
      if (r < n && this.#keys[r] < this.#keys[m]) m = r;
      if (m === i) break;
      this.#swap(i, m); i = m;
    }
    return topVal;
  }
  #swap(a, b) {
    [this.#keys[a], this.#keys[b]] = [this.#keys[b], this.#keys[a]];
    [this.#vals[a], this.#vals[b]] = [this.#vals[b], this.#vals[a]];
  }
}

/* ---------- profiles ---------- */

export const PROFILES = {
  car: {
    maskFwd: F.CAR_FWD, maskBwd: F.CAR_BWD,
    topSpeed: 130, uturn: 45, leftTurn: 7, rightTurn: 3, crossing: 4,
    speedFactor: 1,
  },
  bike: {
    maskFwd: F.BIKE_FWD, maskBwd: F.BIKE_BWD,
    topSpeed: 22, uturn: 8, leftTurn: 2, rightTurn: 1, crossing: 2,
    speed: (flags, speed) => {
      if (flags & F.STEPS) return 3;
      if (flags & F.UNPAVED) return 11;
      if (flags & F.TRAIL) return 12;
      return Math.min(22, Math.max(10, speed * 0.35 + 8));
    },
  },
  foot: {
    maskFwd: F.FOOT, maskBwd: F.FOOT,
    topSpeed: 5.2, uturn: 0, leftTurn: 0, rightTurn: 0, crossing: 3,
    speed: (flags) => (flags & F.STEPS ? 1.6 : flags & F.UNPAVED ? 4.2 : 5),
  },
  hike: {
    maskFwd: F.FOOT, maskBwd: F.FOOT,
    topSpeed: 5, uturn: 0, leftTurn: 0, rightTurn: 0, crossing: 4,
    speed: (flags) => (flags & F.STEPS ? 1.4 : flags & F.TRAIL ? 4.2 : 4.6),
  },
};

/**
 * Per-edge cost in seconds, including preference and avoidance weighting.
 * Returns Infinity when the edge must not be used at all.
 */
function edgeCost(g, e, profile, opts, relaxAvoid = false) {
  const flags = g.edgeFlags[e];
  const len = g.edgeLen[e];
  const p = PROFILES[profile];

  if (flags & F.PRIVATE && !(flags & F.FOOT)) return Infinity;

  const kmh = p.speed ? p.speed(flags, g.edgeSpeed[e]) : g.edgeSpeed[e];
  let seconds = len / (Math.max(1, kmh) / 3.6);

  // You are physically standing on the snapped start/end edge: a preference to
  // avoid tolls must not make leaving it impossible.
  const { avoid: rawAvoid = {}, preference = 'fastest' } = opts;
  const avoid = relaxAvoid ? {} : rawAvoid;
  if (avoid.ferries && flags & F.FERRY) return Infinity;
  if (flags & F.FERRY) seconds += 900;                       // boarding + waiting
  if (avoid.tolls && flags & F.TOLL) return Infinity;
  if (avoid.unpaved && flags & F.UNPAVED) return Infinity;
  if (avoid.highways && flags & F.MOTORWAY) seconds *= 6;

  let weight = seconds;
  if (preference === 'shortest') weight = len;
  else if (preference === 'scenic') {
    weight = seconds;
    if (flags & F.SCENIC) weight *= 0.55;
    if (flags & F.TRAIL) weight *= 0.75;
    if (flags & F.CALM) weight *= 0.85;
    if (flags & F.MOTORWAY) weight *= 2.2;
    if (profile === 'car' && g.edgeSpeed[e] >= 90) weight *= 1.4;
  }
  if (profile === 'hike') {
    if (flags & F.TRAIL) weight *= 0.6;
    if (flags & F.SCENIC) weight *= 0.7;
    if (!(flags & F.TRAIL) && !(flags & F.CALM)) weight *= 1.8;  // stay off road shoulders
  }
  if (profile === 'bike' && g.edgeSpeed[e] >= 80) weight *= 2.5;

  return { weight, seconds, len };
}

const passable = (flags, profile, forward) => {
  const p = PROFILES[profile];
  return (flags & (forward ? p.maskFwd : p.maskBwd)) !== 0;
};

/** Snap a coordinate to the nearest usable edge. */
export function snap(g, coord, profile = 'car', maxRadius = 4) {
  const p = PROFILES[profile];
  for (let ring = 1; ring <= maxRadius; ring++) {
    let best = null;
    for (const e of edgesNear(g, coord[0], coord[1], ring)) {
      const flags = g.edgeFlags[e];
      if (!(flags & (p.maskFwd | p.maskBwd))) continue;
      const geom = edgeGeometry(g, e);
      const hit = nearestOnLine(coord, geom);
      if (!best || hit.distance < best.distance) {
        best = { edge: e, geom, ...hit, total: lineLength(geom) };
      }
    }
    if (best && best.distance < 400 * ring) return best;
    if (best && ring === maxRadius) return best;
  }
  return null;
}

const TURN_LEFT = -25, TURN_RIGHT = 25, U_TURN = 150;

/** Weight per metre that no edge can go below, given profile + preference. */
export function heuristicScale(profile, { preference = 'fastest' } = {}) {
  if (preference === 'shortest') return 1;                 // weight is metres, not seconds
  let multiplier = 1;
  if (preference === 'scenic') multiplier *= 0.55 * 0.75 * 0.85;
  if (profile === 'hike') multiplier *= 0.6 * 0.7;
  return (3.6 / PROFILES[profile].topSpeed) * multiplier;
}

/**
 * Shortest path between two coordinates.
 * @returns {{coordinates:number[][], distance:number, duration:number, edges:number[], reversed:boolean[]}|null}
 */
export function route(g, fromCoord, toCoord, opts = {}) {
  const profile = opts.profile ?? 'car';
  const p = PROFILES[profile];
  const maxNodes = opts.maxNodes ?? 400000;

  const from = snap(g, fromCoord, profile);
  const to = snap(g, toCoord, profile);
  if (!from || !to) return null;

  /* Same edge, and travel along it is legal → trivial answer. */
  if (from.edge === to.edge) {
    const forward = to.along >= from.along;
    if (passable(g.edgeFlags[from.edge], profile, forward)) {
      const geom = from.geom;
      const slice = forward
        ? [from.point, ...geom.slice(from.index + 1, to.index + 1), to.point]
        : [from.point, ...geom.slice(to.index + 1, from.index + 1).reverse(), to.point];
      const dist = lineLength(slice);
      const cost = edgeCost(g, from.edge, profile, opts, true);
      return {
        coordinates: slice, distance: dist,
        duration: dist / Math.max(1, cost.len) * cost.seconds,
        edges: [from.edge], reversed: [!forward], source: 'offline',
      };
    }
  }

  const targetA = g.edgeFrom[to.edge], targetB = g.edgeTo[to.edge];
  const toLen = lineLength(to.geom);
  const toCost = edgeCost(g, to.edge, profile, opts, true);
  const tailToA = to.along, tailToB = toLen - to.along;

  /* The heuristic must never exceed the true remaining weight, or A* degrades
     into a greedy search and quietly returns a worse route. `edgeCost` scales
     weight by preference and profile, so the heuristic is scaled to match the
     smallest multiplier any edge could receive. */
  const heuristic = (nodeIdx) => flatDistance(nodeCoord(g, nodeIdx), toCoord) * heuristicScale(profile, opts);

  const gScore = new Map();     // node -> best weight
  const came = new Map();       // node -> {prev, edge, reversed, dist, time}
  const open = new Heap();
  let expanded = 0;

  /* Seed from both ends of the start edge, paying the partial traversal. */
  const startLen = lineLength(from.geom);
  const startCost = edgeCost(g, from.edge, profile, opts, true);
  const seeds = [];
  if (passable(g.edgeFlags[from.edge], profile, true)) {
    const d = startLen - from.along;
    seeds.push({ node: g.edgeTo[from.edge], dist: d, weight: startCost.weight * (d / startLen), rev: false });
  }
  if (passable(g.edgeFlags[from.edge], profile, false)) {
    const d = from.along;
    seeds.push({ node: g.edgeFrom[from.edge], dist: d, weight: startCost.weight * (d / startLen), rev: true });
  }
  if (!seeds.length || !isFinite(startCost.weight)) return null;

  for (const s of seeds) {
    if ((gScore.get(s.node) ?? Infinity) <= s.weight) continue;
    gScore.set(s.node, s.weight);
    came.set(s.node, { prev: -1, edge: from.edge, reversed: s.rev, dist: s.dist,
                       time: startCost.seconds * (s.dist / startLen), partialStart: true });
    open.push(s.weight + heuristic(s.node), { node: s.node, f: s.weight + heuristic(s.node) });
  }

  let bestEnd = null, bestEndWeight = Infinity;

  while (open.size) {
    const { node, f } = open.pop();
    const gNode = gScore.get(node);
    if (gNode === undefined) continue;
    // the heap is ordered by f, so once the cheapest estimate cannot beat the
    // best complete path, nothing left in the queue can either
    if (f >= bestEndWeight) break;
    if (++expanded > maxNodes) break;

    /* Can we finish here by entering the destination edge? */
    for (const [endNode, tail, rev] of [[targetA, tailToA, true], [targetB, tailToB, false]]) {
      if (node !== endNode || !isFinite(toCost.weight)) continue;
      if (!passable(g.edgeFlags[to.edge], profile, !rev)) continue;
      const w = gNode + toCost.weight * (tail / Math.max(1, toLen));
      if (w < bestEndWeight) {
        bestEndWeight = w;
        bestEnd = { node, tail, reversed: rev, time: toCost.seconds * (tail / Math.max(1, toLen)) };
      }
    }

    const info = came.get(node);
    const inBearing = info && info.prev !== -1 ? edgeExitBearing(g, info.edge, info.reversed) : null;

    for (let a = g.adjStart[node]; a < g.adjStart[node + 1]; a++) {
      const e = g.adjEdge[a];
      // an edge stored as from→to is traversed "reversed" when we stand on its `to` end
      const reversed = g.edgeFrom[e] !== node;
      const next = reversed ? g.edgeFrom[e] : g.edgeTo[e];
      if (next === node) continue;                              // self loop
      if (!passable(g.edgeFlags[e], profile, !reversed)) continue;

      const cost = edgeCost(g, e, profile, opts);
      if (!isFinite(cost.weight)) continue;

      let turnPenalty = 0;
      if (inBearing !== null) {
        const outB = edgeEntryBearing(g, e, reversed);
        const delta = bearingDelta(inBearing, outB);
        const abs = Math.abs(delta);
        if (abs > U_TURN) turnPenalty = p.uturn;
        else if (delta < TURN_LEFT) turnPenalty = p.leftTurn + abs / 30;
        else if (delta > TURN_RIGHT) turnPenalty = p.rightTurn + abs / 45;
        if (info.edge !== e && edgeNameOf(g, info.edge) !== edgeNameOf(g, e)) turnPenalty += p.crossing;
      }

      const tentative = gNode + cost.weight + turnPenalty;
      if (tentative >= (gScore.get(next) ?? Infinity)) continue;
      gScore.set(next, tentative);
      came.set(next, { prev: node, edge: e, reversed, dist: cost.len, time: cost.seconds + turnPenalty });
      const fNext = tentative + heuristic(next);
      open.push(fNext, { node: next, f: fNext });
    }
  }

  if (!bestEnd) return null;

  /* Walk the parent chain back to the start. */
  const chain = [];
  let cur = bestEnd.node;
  while (cur !== undefined && cur !== -1) {
    const info = came.get(cur);
    if (!info) break;
    chain.push({ node: cur, ...info });
    if (info.prev === -1) break;
    cur = info.prev;
  }
  chain.reverse();

  const coordinates = [from.point];
  const edges = [], reversedFlags = [];
  let distance = 0, duration = 0;

  chain.forEach((step, i) => {
    let geom = edgeGeometry(g, step.edge, step.reversed);
    if (i === 0 && step.partialStart) {
      // trim the first edge to the snapped start point
      const hit = nearestOnLine(from.point, geom);
      geom = [from.point, ...geom.slice(hit.index + 1)];
    }
    for (const c of geom.slice(1)) coordinates.push(c);
    edges.push(step.edge); reversedFlags.push(step.reversed);
    distance += step.dist; duration += step.time;
  });

  /* Final partial edge into the destination. */
  const endGeom = edgeGeometry(g, to.edge, bestEnd.reversed);
  const endHit = nearestOnLine(to.point, endGeom);
  const tailGeom = [...endGeom.slice(0, endHit.index + 1), to.point];
  for (const c of tailGeom.slice(1)) coordinates.push(c);
  edges.push(to.edge); reversedFlags.push(bestEnd.reversed);
  distance += bestEnd.tail; duration += bestEnd.time;

  return {
    coordinates: dedupe(coordinates),
    distance, duration,
    edges, reversed: reversedFlags,
    expanded, source: 'offline',
  };
}

function edgeExitBearing(g, e, reversed) {
  const geom = edgeGeometry(g, e, reversed);
  return bearing(geom[geom.length - 2], geom[geom.length - 1]);
}
function edgeEntryBearing(g, e, reversed) {
  const geom = edgeGeometry(g, e, reversed);
  return bearing(geom[0], geom[1]);
}

function dedupe(coords) {
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const prev = out[out.length - 1];
    if (Math.abs(prev[0] - coords[i][0]) > 1e-9 || Math.abs(prev[1] - coords[i][1]) > 1e-9) out.push(coords[i]);
  }
  return out;
}

/** Summarise route attributes for the UI (tolls, unpaved, ferries, road names). */
export function summarise(g, result) {
  if (!result?.edges?.length) return { toll: 0, unpaved: 0, ferry: 0, motorway: 0, trail: 0, scenic: 0, major: [] };
  let toll = 0, unpaved = 0, ferry = 0, motorway = 0, trail = 0, scenic = 0;
  const roads = new Map();
  result.edges.forEach((e, i) => {
    const len = g.edgeLen[e], flags = g.edgeFlags[e];
    if (flags & F.TOLL) toll += len;
    if (flags & F.UNPAVED) unpaved += len;
    if (flags & F.FERRY) ferry += len;
    if (flags & F.MOTORWAY) motorway += len;
    if (flags & F.TRAIL) trail += len;
    if (flags & F.SCENIC) scenic += len;
    const name = edgeNameOf(g, e);
    if (name) roads.set(name, (roads.get(name) ?? 0) + len);
  });
  const major = [...roads.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
  return { toll, unpaved, ferry, motorway, trail, scenic, major };
}
