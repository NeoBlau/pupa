/* tracks.js — recording where you actually went, and GPX in and out. */

import { idb } from '../lib/idb.js';
import { uid } from '../lib/util.js';
import { lineLength, flatDistance, simplify, bboxOf } from '../lib/geo.js';

export class TrackRecorder {
  #points = [];
  #id = null;
  #startedAt = 0;
  #paused = false;

  get active() { return !!this.#id; }
  get points() { return this.#points; }
  get distance() { return this.#points.length > 1 ? lineLength(this.#points.map((p) => p.coords)) : 0; }
  get elapsed() { return this.#id ? (Date.now() - this.#startedAt) / 1000 : 0; }

  start(name) {
    this.#id = uid();
    this.#points = [];
    this.#startedAt = Date.now();
    this.#paused = false;
    this.name = name ?? new Date().toLocaleString();
    return this.#id;
  }

  pause() { this.#paused = true; }
  resume() { this.#paused = false; }

  /** Drop fixes that are noise: too close, too soon, or wildly inaccurate. */
  add(fix) {
    if (!this.#id || this.#paused) return false;
    if ((fix.accuracy ?? 0) > 50) return false;
    const last = this.#points.at(-1);
    if (last) {
      const moved = flatDistance(last.coords, fix.coords);
      if (moved < 4 || fix.at - last.at < 900) return false;
      if (moved / ((fix.at - last.at) / 1000) > 90) return false;   // 320 km/h on foot, no
    }
    this.#points.push({ coords: fix.coords, at: fix.at, ele: fix.altitude ?? null, speed: fix.speed ?? null });
    return true;
  }

  async stop() {
    if (!this.#id) return null;
    const coords = this.#points.map((p) => p.coords);
    const track = {
      id: this.#id, name: this.name,
      startedAt: this.#startedAt, endedAt: Date.now(),
      points: this.#points,
      distance: Math.round(this.distance),
      duration: Math.round(this.elapsed),
      bbox: coords.length ? bboxOf(coords) : null,
      simplified: coords.length > 2 ? simplify(coords, 4) : coords,
    };
    await idb.put('tracks', track);
    this.#id = null; this.#points = [];
    return track;
  }

  cancel() { this.#id = null; this.#points = []; }
}

export const recorder = new TrackRecorder();

export async function listTracks() {
  return (await idb.getAll('tracks')).sort((a, b) => b.startedAt - a.startedAt);
}

export const deleteTrack = (id) => idb.delete('tracks', id);

/* ---------- GPX ---------- */

const escapeXML = (s) => String(s ?? '').replace(/[<>&'"]/g,
  (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

export function toGPX(track, { creator = 'Compass Navigator' } = {}) {
  const points = track.points ?? (track.coords ?? []).map((c) => ({ coords: c }));
  const body = points.map((p) => {
    const ele = p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : '';
    const time = p.at ? `<time>${new Date(p.at).toISOString()}</time>` : '';
    return `<trkpt lat="${p.coords[1].toFixed(6)}" lon="${p.coords[0].toFixed(6)}">${ele}${time}</trkpt>`;
  }).join('\n      ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${escapeXML(creator)}" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXML(track.name)}</name><time>${new Date(track.startedAt ?? Date.now()).toISOString()}</time></metadata>
  <trk>
    <name>${escapeXML(track.name)}</name>
    <trkseg>
      ${body}
    </trkseg>
  </trk>
</gpx>`;
}

export function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('not valid GPX');
  const read = (selector) => Array.from(doc.querySelectorAll(selector)).map((pt) => ({
    coords: [Number(pt.getAttribute('lon')), Number(pt.getAttribute('lat'))],
    ele: pt.querySelector('ele') ? Number(pt.querySelector('ele').textContent) : null,
    at: pt.querySelector('time') ? Date.parse(pt.querySelector('time').textContent) : null,
  })).filter((p) => Number.isFinite(p.coords[0]) && Number.isFinite(p.coords[1]));

  const points = read('trkpt');
  const routePoints = points.length ? points : read('rtept');
  if (!routePoints.length) throw new Error('GPX has no track points');

  return {
    id: uid(),
    name: doc.querySelector('trk > name, metadata > name')?.textContent ?? 'GPX',
    points: routePoints,
    coords: routePoints.map((p) => p.coords),
    startedAt: routePoints[0].at ?? Date.now(),
    distance: Math.round(lineLength(routePoints.map((p) => p.coords))),
    imported: true,
  };
}

export function downloadGPX(track) {
  const blob = new Blob([toGPX(track)], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(track.name ?? 'track').replace(/[^\wЀ-ӿ-]+/g, '_')}.gpx`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
