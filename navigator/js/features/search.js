/* search.js — one search box over three sources: offline packs, online geocoding,
   and the user's own history and favourites. Offline always answers first, so
   the field stays usable in a tunnel. */

import { idb } from '../lib/idb.js';
import { uid, debounce } from '../lib/util.js';
import { flatDistance, cellsAround } from '../lib/geo.js';
import { geocodeSuggest, reverseGeocode } from '../routing/online.js';
import { tokenize } from '../offline/osm.js';

/** Rough importance so that a city outranks a corner shop with the same name. */
const KIND_RANK = {
  city: 100, town: 70, village: 40, suburb: 35, neighbourhood: 20, hamlet: 15,
  aerodrome: 60, station: 50, hospital: 30, fuel: 25, charging_station: 25,
  pharmacy: 20, supermarket: 18, hotel: 15, museum: 15, attraction: 15,
};

/** Search the downloaded packs. Works with no network at all. */
export async function searchOffline(query, { near, limit = 12 } = {}) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  // match on the longest token first: it is the most selective
  const probe = tokens.sort((a, b) => b.length - a.length)[0];
  const rows = await idb.byIndexPrefix('pois', 'tokens', probe, 400);

  const scored = [];
  for (const row of rows) {
    const haystack = `${row.name} ${row.subtitle ?? ''}`.toLowerCase();
    // every typed token has to appear somewhere, so "лев толстой 16" narrows down
    if (!tokens.every((t) => haystack.includes(t))) continue;

    const name = row.name.toLowerCase();
    let score = KIND_RANK[row.kind] ?? 8;
    if (name === query.toLowerCase()) score += 120;
    else if (name.startsWith(probe)) score += 45;
    if (near) score -= Math.min(60, flatDistance(near, row.coords) / 2000);

    scored.push({
      id: row.id, name: row.name,
      subtitle: row.subtitle || kindLabel(row.kind),
      coords: row.coords, kind: row.kind,
      distance: near ? flatDistance(near, row.coords) : null,
      source: 'offline', score,
    });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Nearby places of a category — powers the "fuel / pharmacy" quick chips. */
export async function nearbyOffline(coords, kinds, radius = 8000, limit = 20) {
  const rows = await idb.byIndexAny('pois', 'cell', cellsAround(coords[0], coords[1], radius));
  const wanted = new Set([].concat(kinds));
  return rows
    .filter((r) => wanted.has(r.kind))
    .map((r) => ({ ...r, distance: flatDistance(coords, r.coords), source: 'offline' }))
    .filter((r) => r.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

/**
 * Combined search. Offline results resolve immediately; online ones are merged in
 * when (and if) they arrive.
 * @param {(results:Array, done:boolean)=>void} onResults
 */
export function search(query, { near, lang = 'ru', online = true, signal } = {}, onResults) {
  let offlineResults = [];
  const emit = (extra = [], done = false) => {
    const merged = dedupe([...offlineResults, ...extra], near);
    onResults(merged, done);
  };

  const offlinePromise = searchOffline(query, { near })
    .then((r) => { offlineResults = r; emit([], !online); })
    .catch(() => { /* an empty pack is not an error */ });

  if (!online || !navigator.onLine) {
    offlinePromise.then(() => emit([], true));
    return offlinePromise;
  }

  const onlinePromise = geocodeSuggest(query, { near, lang, signal })
    .then((r) => r.map((x) => ({ ...x, distance: near ? flatDistance(near, x.coords) : null })))
    .catch(() => []);

  return Promise.all([offlinePromise, onlinePromise]).then(([, onlineResults]) => {
    emit(onlineResults, true);
    return onlineResults;
  });
}

/** Two results within 80 m with a similar name are the same place. */
function dedupe(results, near) {
  const out = [];
  for (const r of results) {
    const twin = out.find((o) =>
      flatDistance(o.coords, r.coords) < 80 &&
      (o.name.toLowerCase() === r.name.toLowerCase() ||
       o.name.toLowerCase().includes(r.name.toLowerCase()) ||
       r.name.toLowerCase().includes(o.name.toLowerCase())));
    if (twin) { if (r.source === 'offline') twin.source = 'offline'; continue; }
    out.push({ ...r });
  }
  if (near) out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return out.slice(0, 16);
}

export const debouncedSearch = (fn, ms = 220) => debounce(fn, ms);

/** Where am I — online reverse geocode, otherwise the nearest known place. */
export async function describePoint(coords, { lang = 'ru' } = {}) {
  if (navigator.onLine) {
    try { return await reverseGeocode(coords, { lang }); } catch { /* fall through */ }
  }
  const rows = await idb.byIndexAny('pois', 'cell', cellsAround(coords[0], coords[1], 1500));
  if (!rows.length) return { name: formatCoords(coords), subtitle: '', coords, source: 'offline' };
  const nearest = rows
    .map((r) => ({ r, d: flatDistance(coords, r.coords) }))
    .sort((a, b) => a.d - b.d)[0];
  return {
    name: nearest.r.name,
    subtitle: `${Math.round(nearest.d)} м${nearest.r.subtitle ? `, ${nearest.r.subtitle}` : ''}`,
    coords, source: 'offline',
  };
}

export const formatCoords = ([lon, lat]) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

/* ---------- history and favourites ---------- */

export async function pushHistory(place) {
  const existing = (await idb.getAll('history'))
    .find((h) => flatDistance(h.coords, place.coords) < 50);
  if (existing) {
    await idb.put('history', { ...existing, at: Date.now(), count: (existing.count ?? 1) + 1 });
    return;
  }
  await idb.put('history', { id: uid(), ...place, at: Date.now(), count: 1 });
  const all = (await idb.getAll('history')).sort((a, b) => b.at - a.at);
  for (const row of all.slice(40)) await idb.delete('history', row.id);
}

export async function getHistory(limit = 8) {
  return (await idb.getAll('history')).sort((a, b) => b.at - a.at).slice(0, limit);
}

export async function clearHistory() { return idb.clear('history'); }

export async function addFavorite(place, label = null) {
  const row = { id: uid(), ...place, label, createdAt: Date.now() };
  await idb.put('favorites', row);
  return row;
}

export async function getFavorites() {
  return (await idb.getAll('favorites')).sort((a, b) => a.createdAt - b.createdAt);
}

export const removeFavorite = (id) => idb.delete('favorites', id);

const KIND_LABELS_RU = {
  fuel: 'АЗС', charging_station: 'Зарядка', pharmacy: 'Аптека', hospital: 'Больница',
  supermarket: 'Супермаркет', restaurant: 'Ресторан', cafe: 'Кафе', hotel: 'Отель',
  parking: 'Парковка', station: 'Станция', aerodrome: 'Аэропорт', atm: 'Банкомат',
  city: 'Город', town: 'Город', village: 'Село', suburb: 'Район',
};

export function kindLabel(kind, lang = 'ru') {
  if (lang !== 'ru') return kind?.replace(/_/g, ' ') ?? '';
  return KIND_LABELS_RU[kind] ?? (kind?.replace(/_/g, ' ') ?? '');
}
