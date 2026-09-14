/* online.js — OSRM routing, Photon/Nominatim geocoding. All key-free public APIs. */

import { fetchJSON } from '../lib/util.js';
import { lineLength } from '../lib/geo.js';
import { stepsFromOSRM } from './maneuvers.js';

const OSRM_HOSTS = [
  'https://router.project-osrm.org',
  'https://routing.openstreetmap.de/routed-car',
];
const OSRM_PROFILE = { car: 'driving', bike: 'bike', foot: 'foot', hike: 'foot' };

/** Public OSRM only serves the car profile reliably; the walking hosts differ. */
function hostsFor(profile) {
  if (profile === 'car') return OSRM_HOSTS;
  if (profile === 'bike') return ['https://routing.openstreetmap.de/routed-bike', OSRM_HOSTS[0]];
  return ['https://routing.openstreetmap.de/routed-foot', OSRM_HOSTS[0]];
}

/**
 * Route online.
 * @param {number[][]} coords [[lon,lat], …] origin, waypoints…, destination
 */
export async function routeOnline(coords, { profile = 'car', alternatives = true, signal } = {}) {
  const path = coords.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const params = new URLSearchParams({
    overview: 'full', geometries: 'geojson', steps: 'true',
    alternatives: alternatives ? 'true' : 'false', annotations: 'duration,distance,speed',
  });

  let lastErr;
  for (const host of hostsFor(profile)) {
    const p = host.includes('routed-') ? 'driving' : (OSRM_PROFILE[profile] ?? 'driving');
    try {
      const data = await fetchJSON(`${host}/route/v1/${p}/${path}?${params}`, { retries: 1, timeout: 12000, signal });
      if (data.code !== 'Ok' || !data.routes?.length) throw new Error(data.message ?? data.code);
      return data.routes.slice(0, 3).map((r, i) => adaptOSRM(r, i));
    } catch (err) { lastErr = err; }
  }
  throw lastErr ?? new Error('no OSRM host answered');
}

function adaptOSRM(r, index) {
  const coordinates = r.geometry.coordinates;
  const steps = stepsFromOSRM(r.legs ?? [], coordinates);
  return {
    coordinates,
    distance: r.distance ?? lineLength(coordinates),
    duration: r.duration,
    steps,
    legs: (r.legs ?? []).map((l) => ({ distance: l.distance, duration: l.duration, summary: l.summary })),
    summaryText: (r.legs ?? []).map((l) => l.summary).filter(Boolean).join(' · '),
    /* Per-segment speed lets us colour the line by how the road actually flows. */
    speeds: r.legs?.[0]?.annotation?.speed ?? null,
    source: 'online',
    index,
  };
}

/* ---------- geocoding ---------- */

/** Photon: fast type-ahead, CORS-friendly, understands Cyrillic. */
export async function geocodeSuggest(query, { near, lang = 'ru', limit = 8, signal } = {}) {
  if (!query || query.trim().length < 2) return [];
  const params = new URLSearchParams({ q: query, limit: String(limit), lang: lang === 'ru' ? 'ru' : 'en' });
  if (near) { params.set('lat', near[1].toFixed(4)); params.set('lon', near[0].toFixed(4)); }
  const data = await fetchJSON(`https://photon.komoot.io/api/?${params}`, { retries: 1, timeout: 8000, signal });
  return (data.features ?? []).map((f) => {
    const p = f.properties ?? {};
    const parts = [p.street && [p.street, p.housenumber].filter(Boolean).join(', '), p.city || p.county, p.state, p.country];
    return {
      id: `photon:${p.osm_type}${p.osm_id}`,
      name: p.name || p.street || p.city || query,
      subtitle: parts.filter(Boolean).join(', '),
      coords: f.geometry.coordinates,
      kind: p.osm_value || p.type || 'place',
      source: 'online',
    };
  });
}

/** Nominatim reverse lookup — what is at this point. */
export async function reverseGeocode(coords, { lang = 'ru', signal } = {}) {
  const params = new URLSearchParams({
    lat: coords[1].toFixed(6), lon: coords[0].toFixed(6),
    format: 'jsonv2', zoom: '18', 'accept-language': lang,
  });
  const data = await fetchJSON(`https://nominatim.openstreetmap.org/reverse?${params}`,
    { retries: 1, timeout: 8000, signal });
  const a = data.address ?? {};
  const street = [a.road, a.house_number].filter(Boolean).join(', ');
  return {
    name: data.name || street || a.suburb || a.city || data.display_name?.split(',')[0] || '—',
    subtitle: [a.suburb, a.city || a.town || a.village, a.state].filter(Boolean).join(', '),
    coords, source: 'online',
  };
}

/** Elevation for up to 100 points per call (Open-Meteo, key-free). */
export async function fetchElevations(points, { signal } = {}) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    const params = new URLSearchParams({
      latitude: chunk.map((c) => c[1].toFixed(5)).join(','),
      longitude: chunk.map((c) => c[0].toFixed(5)).join(','),
    });
    const data = await fetchJSON(`https://api.open-meteo.com/v1/elevation?${params}`,
      { retries: 1, timeout: 10000, signal });
    out.push(...(data.elevation ?? chunk.map(() => null)));
  }
  return out;
}
