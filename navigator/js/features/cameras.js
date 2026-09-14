/* cameras.js — the camera radar.
 *
 * Alerting on every camera within a radius is what makes cheap radar apps
 * useless in a city: you get warned about the camera on the parallel street and
 * about the one you just passed. This engine only warns about a camera you are
 * actually approaching — ahead of you, facing you, and close in *time* rather
 * than distance, so the warning arrives at the same moment at 60 and at 110.
 */

import { Emitter } from '../lib/util.js';
import { idb } from '../lib/idb.js';
import { flatDistance, bearing, bearingDelta, cellsAround, nearestOnLine } from '../lib/geo.js';

/**
 * A stage fires on whichever comes first — time to the camera or raw distance.
 * Time alone is wrong in town (at 40 km/h a 22 s warning is only 240 m ahead,
 * too late to react); distance alone is wrong on a motorway (500 m at 110 km/h
 * is 16 s, which is fine, but 500 m at 40 km/h nags far too early). The
 * `maxDistance` cap stops the slow-speed case from warning half a kilometre out.
 */
const STAGE = {
  far:  { seconds: 25, distance: 500, maxDistance: 1200 },
  near: { seconds: 11, distance: 250, maxDistance: 600 },
  at:   { seconds: 3.5, distance: 60, maxDistance: 150 },
};

const stageHit = (s, eta, distance) =>
  distance <= s.maxDistance && (eta <= s.seconds || distance <= s.distance);

const REALERT_MS = 120000;   // never nag about the same camera twice in two minutes
const CONE_DEG = 55;         // how far off our heading a camera may sit
const FACING_DEG = 75;       // tolerance when matching a camera's direction

export class CameraRadar extends Emitter {
  /** @type {Map<string, object>} cameras currently held in memory */
  #cameras = new Map();
  #lastAlert = new Map();
  #loadedCell = null;
  #zone = null;              // active average-speed zone
  #enabled = true;
  #types = { speed: true, redLight: true, average: true, bus: true, parking: false, mobile: true };

  configure({ enabled, types }) {
    if (enabled !== undefined) this.#enabled = enabled;
    if (types) this.#types = { ...this.#types, ...types };
  }

  get cameras() { return [...this.#cameras.values()]; }

  /** Add cameras directly — used for user-reported ones and by tests. */
  add(cameras) {
    for (const cam of [].concat(cameras)) this.#cameras.set(cam.id, cam);
    this.emit('loaded', this.cameras);
  }
  get zone() { return this.#zone; }

  /** Pull cameras around a point into memory; cheap enough to call on every fix. */
  async ensureLoaded(coords, radius = 6000) {
    const key = `${Math.round(coords[0] * 50)}:${Math.round(coords[1] * 50)}`;
    if (key === this.#loadedCell) return;
    this.#loadedCell = key;
    const rows = await idb.byIndexAny('cameras', 'cell', cellsAround(coords[0], coords[1], radius));
    this.#cameras.clear();
    for (const cam of rows) this.#cameras.set(cam.id, cam);
    this.emit('loaded', this.cameras);
  }

  /** Preload everything within a corridor around a planned route. */
  async loadForRoute(coordinates, corridor = 1200) {
    const keys = new Set();
    const stride = Math.max(1, Math.floor(coordinates.length / 400));
    for (let i = 0; i < coordinates.length; i += stride) {
      for (const k of cellsAround(coordinates[i][0], coordinates[i][1], corridor)) keys.add(k);
    }
    const rows = await idb.byIndexAny('cameras', 'cell', [...keys]);
    this.#cameras.clear();
    for (const cam of rows) this.#cameras.set(cam.id, cam);
    this.#loadedCell = 'route';
    this.emit('loaded', this.cameras);
    return this.cameras;
  }

  /**
   * Find the camera we are approaching.
   * @param {{coords:[number,number], heading:number, speed:number}} fix speed in m/s
   * @param {number[][]|null} routeLine optional — restricts to cameras on the route
   */
  evaluate(fix, routeLine = null) {
    if (!this.#enabled || !fix?.coords) return null;
    const { coords, heading, speed = 0 } = fix;
    // below walking pace heading is noise; hold the last useful warning instead
    const usableHeading = Number.isFinite(heading) && speed > 1.5 ? heading : null;
    const effectiveSpeed = Math.max(speed, 8.3);   // never assume slower than 30 km/h

    let best = null;
    for (const cam of this.#cameras.values()) {
      if (!this.#types[cam.kind]) continue;
      const distance = flatDistance(coords, cam.coords);
      if (distance > STAGE.far.maxDistance) continue;

      const toCam = bearing(coords, cam.coords);
      if (usableHeading !== null) {
        if (Math.abs(bearingDelta(usableHeading, toCam)) > CONE_DEG) continue;   // behind or beside us
        if (!facesUs(cam, usableHeading)) continue;
      }
      if (routeLine && nearestOnLine(cam.coords, routeLine).distance > 60) continue;

      const eta = distance / effectiveSpeed;
      if (!best || distance < best.distance) best = { camera: cam, distance, eta, bearing: toCam };
    }
    // The corridor average has to keep ticking between the two cameras, where
    // by definition nothing is in range. Update it before any early return.
    if (!best) { this.#updateZone(null, fix); return null; }

    best.stage = stageHit(STAGE.at, best.eta, best.distance) ? 'at'
      : stageHit(STAGE.near, best.eta, best.distance) ? 'near'
      : stageHit(STAGE.far, best.eta, best.distance) ? 'far' : null;

    if (best.stage) {
      const key = `${best.camera.id}:${best.stage}`;
      const last = this.#lastAlert.get(key) ?? 0;
      if (Date.now() - last > REALERT_MS) {
        this.#lastAlert.set(key, Date.now());
        best.fresh = true;
        this.emit('alert', best);
      }
    }

    this.#updateZone(best, fix);
    return best;
  }

  /**
   * Average-speed corridors are what actually catch people: you can be legal at
   * both cameras and still be fined. We track the running average between them.
   */
  #updateZone(approach, fix) {
    const cam = approach?.camera;
    const now = Date.now();

    if (this.#zone) {
      const z = this.#zone;
      z.distance += flatDistance(z.lastCoords, fix.coords);
      z.lastCoords = fix.coords;
      z.elapsed = (now - z.startedAt) / 1000;
      z.average = z.elapsed > 5 ? (z.distance / z.elapsed) * 3.6 : 0;
      z.projectedFine = z.limit ? z.average > z.limit + 1 : false;

      // leaving the zone: the exit camera is behind us, or we drifted far from it
      const exitDistance = z.exitCamera ? flatDistance(fix.coords, z.exitCamera.coords) : Infinity;
      if (z.exitCamera && exitDistance < 40) {
        this.emit('zone-end', { ...z });
        this.#zone = null;
        return;
      }
      if (now - z.startedAt > 45 * 60 * 1000) { this.#zone = null; return; }   // stale
      this.emit('zone-update', { ...z });
      return;
    }

    if (cam?.kind === 'average' && approach.distance < 45) {
      const exitCamera = this.#findZoneExit(cam, fix);
      this.#zone = {
        entryCamera: cam, exitCamera,
        startedAt: now, lastCoords: fix.coords,
        distance: 0, elapsed: 0, average: 0,
        limit: cam.maxspeed ?? exitCamera?.maxspeed ?? null,
        projectedFine: false,
      };
      this.emit('zone-start', { ...this.#zone });
    }
  }

  /** The next average-speed camera roughly ahead of us closes the corridor. */
  #findZoneExit(entry, fix) {
    let best = null;
    for (const cam of this.#cameras.values()) {
      if (cam.kind !== 'average' || cam.id === entry.id) continue;
      const d = flatDistance(fix.coords, cam.coords);
      if (d < 200 || d > 30000) continue;
      if (Number.isFinite(fix.heading)
          && Math.abs(bearingDelta(fix.heading, bearing(fix.coords, cam.coords))) > 45) continue;
      if (!best || d < best.d) best = { cam, d };
    }
    return best?.cam ?? null;
  }

  clearZone() { this.#zone = null; }

  reset() {
    this.#lastAlert.clear();
    this.#zone = null;
    this.#loadedCell = null;
  }
}

/**
 * Does this camera watch traffic travelling on our heading?
 *
 * OSM is genuinely ambiguous here, so the two tags are read differently:
 * `camera:direction` / `surveillance:direction` is where the lens points, which
 * is roughly opposite to the traffic it catches; a bare `direction` on a
 * speed camera is conventionally the direction of the traffic monitored.
 */
export function facesUs(cam, heading, tolerance = FACING_DEG) {
  if (cam.lensDirection != null) {
    return Math.abs(bearingDelta(cam.lensDirection, (heading + 180) % 360)) <= tolerance;
  }
  if (cam.direction != null) {
    return Math.abs(bearingDelta(cam.direction, heading)) <= tolerance;
  }
  return true;   // untagged cameras watch everyone
}

/** Speeding check against the camera limit or the current road's limit. */
export function speedingBy(speedMs, limitKmh) {
  if (!limitKmh || !Number.isFinite(speedMs)) return 0;
  return Math.round(speedMs * 3.6 - limitKmh);
}

export const CAMERA_LABEL_KEY = {
  speed: 'camera.speed', redLight: 'camera.redLight', average: 'camera.average',
  bus: 'camera.bus', parking: 'camera.parking', mobile: 'camera.mobile',
};

export const radar = new CameraRadar();
