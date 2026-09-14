/* service.js — one entry point for routing.
 *
 * Online gives better road knowledge; offline always answers. The rule is
 * simple: try online when there is a network and the answer is worth waiting
 * for, fall back to the local graph, and never leave the user with nothing when
 * a downloaded region covers the trip.
 */

import { route as routeOffline, summarise, PROFILES } from './router.js';
import { routeOnline } from './online.js';
import { stepsFromGraphRoute } from './maneuvers.js';
import { getRegionGraph, regionsAt } from '../offline/regions.js';
import { t } from '../i18n/strings.js';

const ONLINE_BUDGET_MS = 9000;

/** Cache the deserialised graph — rebuilding it for every reroute is wasteful. */
let graphCache = { regionId: null, graph: null };

export async function graphFor(coords) {
  const regions = await regionsAt(coords);
  const region = regions.find((r) => r.status === 'ready');
  if (!region) return null;
  if (graphCache.regionId === region.id) return graphCache.graph;
  const graph = await getRegionGraph(region.id);
  graphCache = { regionId: region.id, graph };
  return graph;
}

export function invalidateGraphCache() { graphCache = { regionId: null, graph: null }; }

/**
 * Plan a route.
 * @param {number[][]} points origin, optional stops, destination
 * @param {{profile:string, avoid:object, preference:string, preferOffline:boolean}} opts
 * @returns {Promise<{routes:Array, source:string, warning?:string}>}
 */
export async function planRoute(points, opts = {}) {
  const { profile = 'car', preferOffline = false, signal } = opts;
  if (points.length < 2) throw new Error('need at least an origin and a destination');

  const canOnline = navigator.onLine && !preferOffline;
  let onlineError = null;

  if (canOnline) {
    try {
      const routes = await withTimeout(
        routeOnline(points, { profile, alternatives: points.length === 2, signal }),
        ONLINE_BUDGET_MS);
      const labelled = labelAlternatives(routes);
      return { routes: labelled, source: 'online' };
    } catch (err) { onlineError = err; }
  }

  const graph = await graphFor(points[0]);
  if (!graph) {
    if (onlineError) throw onlineError;
    throw Object.assign(new Error(t('route.noOfflineData')), { code: 'NO_OFFLINE_DATA' });
  }

  /* Offline legs are chained so waypoints work the same way as online. */
  const legs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const leg = routeOffline(graph, points[i], points[i + 1], opts);
    if (!leg) throw Object.assign(new Error(t('route.failed')), { code: 'NO_ROUTE' });
    legs.push(leg);
  }

  const merged = mergeLegs(legs);
  merged.steps = stepsFromGraphRoute(graph, merged);
  merged.attributes = summarise(graph, merged);
  merged.summaryText = merged.attributes.major.join(' · ');
  merged.label = t('route.fastest');

  return {
    routes: [merged],
    source: 'offline',
    warning: onlineError && navigator.onLine ? 'online-failed' : undefined,
  };
}

/** Offline alternatives: re-run the search with different preferences. */
export async function planAlternativesOffline(points, opts = {}) {
  const graph = await graphFor(points[0]);
  if (!graph) return [];
  const variants = [
    { preference: 'fastest', label: t('route.fastest') },
    { preference: 'shortest', label: t('route.shortest') },
    { preference: 'scenic', label: t('route.scenic') },
  ];
  const out = [];
  for (const v of variants) {
    const legs = [];
    let ok = true;
    for (let i = 0; i < points.length - 1; i++) {
      const leg = routeOffline(graph, points[i], points[i + 1], { ...opts, preference: v.preference });
      if (!leg) { ok = false; break; }
      legs.push(leg);
    }
    if (!ok) continue;
    const merged = mergeLegs(legs);
    // discard a variant that is effectively the same road
    if (out.some((o) => Math.abs(o.distance - merged.distance) < 50)) continue;
    merged.steps = stepsFromGraphRoute(graph, merged);
    merged.attributes = summarise(graph, merged);
    merged.summaryText = merged.attributes.major.join(' · ');
    merged.label = v.label;
    merged.preference = v.preference;
    out.push(merged);
  }
  return out;
}

function mergeLegs(legs) {
  const coordinates = [];
  const edges = [], reversed = [];
  let distance = 0, duration = 0;
  for (const leg of legs) {
    const start = coordinates.length ? 1 : 0;
    coordinates.push(...leg.coordinates.slice(start));
    edges.push(...leg.edges);
    reversed.push(...leg.reversed);
    distance += leg.distance;
    duration += leg.duration;
  }
  return { coordinates, edges, reversed, distance, duration, source: 'offline' };
}

/** Name the alternatives the way a person would compare them. */
function labelAlternatives(routes) {
  if (!routes.length) return routes;
  const fastest = routes.reduce((a, b) => (a.duration <= b.duration ? a : b));
  const shortest = routes.reduce((a, b) => (a.distance <= b.distance ? a : b));
  return routes.map((r) => {
    const label = r === fastest ? t('route.fastest')
      : r === shortest ? t('route.shortest')
      : `+${Math.max(1, Math.round((r.duration - fastest.duration) / 60))} ${t('common.min')}`;
    return { ...r, label, attributes: r.attributes ?? null };
  });
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('routing timed out')), ms)),
  ]);
}

/** Colour the line by how the road actually flows, where OSRM gave us speeds. */
export function flowSegments(route) {
  if (!route.speeds || !route.coordinates?.length) return null;
  const features = [];
  let run = null;
  for (let i = 0; i < route.speeds.length && i + 1 < route.coordinates.length; i++) {
    const kmh = route.speeds[i] * 3.6;
    const flow = kmh < 10 ? 'jam' : kmh < 25 ? 'slow' : 'free';
    if (!run || run.flow !== flow) {
      if (run) features.push(run.feature);
      run = { flow, feature: { type: 'Feature', properties: { flow }, geometry: { type: 'LineString', coordinates: [route.coordinates[i]] } } };
    }
    run.feature.geometry.coordinates.push(route.coordinates[i + 1]);
  }
  if (run) features.push(run.feature);
  return { type: 'FeatureCollection', features: features.filter((f) => f.properties.flow !== 'free') };
}

export { PROFILES };
