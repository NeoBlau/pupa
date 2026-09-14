/* mapview.js — everything that touches MapLibre lives here.
 *
 * The rest of the app talks in plain data (routes, cameras, trails) and never
 * sees a GL object, which keeps the UI testable and makes a style swap a
 * one-liner instead of a rebuild of every layer.
 */

import { Emitter, throttle, clamp } from '../lib/util.js';
import { bboxOf } from '../lib/geo.js';
import { buildStyle, BASEMAPS, LAYER_GROUPS } from './basemaps.js';
import { PUCK_SVG } from '../ui/icons.js';

const FOLLOW = { zoom: 16.8, pitch: 60, offsetFraction: 0.28 };
const OVERVIEW_PADDING = { top: 110, bottom: 200, left: 40, right: 40 };

export class MapView extends Emitter {
  /** @type {maplibregl.Map} */ map = null;
  #puck = null;
  #puckEl = null;
  #styleId = 'day';
  #hillshade = false;
  #pending = new Map();          // source id -> data queued while the style loads
  #followMode = 'follow';
  #userInteracting = false;
  #lastHeading = 0;

  async init(container, { styleId = 'day', center = [37.6173, 55.7558], zoom = 11, hillshade = false } = {}) {
    this.#styleId = styleId;
    this.#hillshade = hillshade;

    this.map = new maplibregl.Map({
      container,
      style: buildStyle(styleId, { hillshade }),
      center, zoom,
      pitch: 0, bearing: 0,
      attributionControl: { compact: true },
      maxPitch: 70,
      hash: false,
      dragRotate: true,
      pitchWithRotate: true,
      fadeDuration: 150,
      // navigation rides on rAF anyway; keep the canvas cheap on mobile GPUs
      antialias: false,
      refreshExpiredTiles: false,
    });

    this.map.touchZoomRotate.enableRotation();
    this.map.keyboard.disable();

    await new Promise((resolve) => this.map.once('load', resolve));
    this.#installPuck();
    this.#wireInteractions();
    this.#flushPending();
    this.emit('ready');
    return this;
  }

  /* ---------- data sources ---------- */

  #setData(sourceId, data) {
    const source = this.map?.getSource(sourceId);
    if (!source) { this.#pending.set(sourceId, data); return; }
    source.setData(data);
  }

  #flushPending() {
    for (const [id, data] of this.#pending) this.map.getSource(id)?.setData(data);
    this.#pending.clear();
  }

  setRoute(route) {
    if (!route) {
      this.#setData('route-line', empty());
      this.#setData('route-casing-traffic', empty());
      return;
    }
    this.#setData('route-line', lineFeature(route.coordinates, { label: route.label ?? '' }));
    this.setRouteProgress(0);
  }

  setAlternatives(routes) {
    this.#setData('route-alt', {
      type: 'FeatureCollection',
      features: routes.map((r, i) => lineFeature(r.coordinates, { label: r.label ?? '', index: i }).features[0]),
    });
  }

  setFlow(collection) { this.#setData('route-casing-traffic', collection ?? empty()); }

  /** Dim the part already driven, so the eye goes straight to what is left. */
  setRouteProgress(fraction) {
    if (!this.map?.getLayer('route-line')) return;
    const scheme = BASEMAPS[this.#styleId]?.scheme ?? 'light';
    const core = scheme === 'dark' ? '#0A84FF' : '#007AFF';
    const done = scheme === 'dark' ? 'rgba(10,132,255,0.25)' : 'rgba(0,122,255,0.28)';

    /* MapLibre rejects an interpolate expression whose stops are not strictly
       ascending, which is exactly what happens as the fraction nears 1. Build
       the four stops so 0 < edge < edge + band < 1 always holds. */
    const edge = clamp(fraction, 0.001, 0.985);
    const band = Math.min(0.995, edge + 0.008);
    try {
      this.map.setPaintProperty('route-line', 'line-gradient', [
        'interpolate', ['linear'], ['line-progress'],
        0, done,
        edge, done,
        band, core,
        1, core,
      ]);
    } catch { /* the style may be mid-swap */ }
  }

  setRoutePoints(points) {
    this.#setData('route-points', {
      type: 'FeatureCollection',
      features: points.map((p) => pointFeature(p.coords, { role: p.role, label: p.label ?? '' })),
    });
  }

  setCameras(cameras) {
    this.#setData('cameras', {
      type: 'FeatureCollection',
      features: cameras.map((c) => pointFeature(c.coords, {
        id: c.id, kind: c.kind, maxspeed: c.maxspeed ?? null, source: c.source ?? 'osm',
      })),
    });
  }

  setCameraZone(zone) {
    if (!zone?.entryCamera || !zone?.exitCamera) { this.#setData('camera-zones', empty()); return; }
    this.#setData('camera-zones', lineFeature([zone.entryCamera.coords, zone.exitCamera.coords], {}));
  }

  setTrails(trails) {
    this.#setData('trails', {
      type: 'FeatureCollection',
      features: trails.map((t) => lineFeature(t.coords, {
        id: t.id, name: t.name, scenic: t.scenic, difficulty: t.difficulty,
      }).features[0]),
    });
  }

  setActiveTrail(trail) {
    this.#setData('trail-active', trail ? lineFeature(trail.coords, { name: trail.name }) : empty());
  }

  setTrailPOIs(pois) {
    this.#setData('trail-pois', {
      type: 'FeatureCollection',
      features: pois.map((p) => pointFeature(p.coords, { kind: p.kind, name: p.name ?? '' })),
    });
  }

  setSearchResults(results, selectedId = null) {
    this.#setData('search-results', {
      type: 'FeatureCollection',
      features: results.map((r) => pointFeature(r.coords, {
        id: r.id, name: r.name, selected: r.id === selectedId,
      })),
    });
  }

  setRegionBox(bbox) {
    if (!bbox) { this.#setData('region-box', empty()); return; }
    const [w, s, e, n] = bbox;
    this.#setData('region-box', {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
      }],
    });
  }

  setTrack(coords) {
    this.#setData('track', coords?.length > 1 ? lineFeature(coords, {}) : empty());
  }

  /* ---------- layer visibility ---------- */

  setLayerGroup(group, visible) {
    for (const id of LAYER_GROUPS[group] ?? []) {
      if (this.map?.getLayer(id)) {
        this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  }

  /** Weather radar tiles are added and removed on demand. */
  setRainLayer(template) {
    if (!this.map) return;
    if (this.map.getLayer('rain')) { this.map.removeLayer('rain'); this.map.removeSource('rain'); }
    if (!template) return;
    this.map.addSource('rain', { type: 'raster', tiles: [template], tileSize: 256, maxzoom: 12 });
    this.map.addLayer({ id: 'rain', type: 'raster', source: 'rain', paint: { 'raster-opacity': 0.6 } },
      firstSymbolLayer(this.map));
  }

  /* ---------- style ---------- */

  async setStyle(styleId, { hillshade = this.#hillshade } = {}) {
    if (!this.map || (styleId === this.#styleId && hillshade === this.#hillshade)) return;
    const snapshot = this.#snapshotSources();
    this.#styleId = styleId;
    this.#hillshade = hillshade;
    this.map.setStyle(buildStyle(styleId, { hillshade }), { diff: false });
    await new Promise((resolve) => this.map.once('styledata', resolve));
    for (const [id, data] of snapshot) this.map.getSource(id)?.setData(data);
    this.emit('style', styleId);
  }

  get styleId() { return this.#styleId; }
  get scheme() { return BASEMAPS[this.#styleId]?.scheme ?? 'light'; }

  #snapshotSources() {
    const ids = ['route-line', 'route-alt', 'route-casing-traffic', 'route-points', 'cameras',
      'camera-zones', 'trails', 'trail-active', 'trail-pois', 'search-results', 'region-box', 'track'];
    const out = new Map();
    for (const id of ids) {
      const src = this.map.getSource(id);
      if (src?._data) out.set(id, src._data);
    }
    return out;
  }

  /* ---------- the location puck ---------- */

  #installPuck() {
    const el = document.createElement('div');
    el.className = 'puck-host';
    el.style.cssText = 'width:64px;height:64px;color:var(--accent);will-change:transform;';
    el.innerHTML = PUCK_SVG;
    this.#puckEl = el;
    this.#puck = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' })
      .setLngLat([0, 0]).addTo(this.map);
    el.parentElement.style.display = 'none';
  }

  setPosition({ coords, heading, accuracy }) {
    if (!this.#puck) return;
    this.#puck.setLngLat(coords);
    this.#puck.getElement().parentElement.style.display = '';
    if (Number.isFinite(heading)) {
      this.#lastHeading = heading;
      this.#puck.setRotation(heading);
      this.#puckEl.querySelector('.puck-cone')?.style.setProperty('opacity', '1');
    } else {
      this.#puckEl.querySelector('.puck-cone')?.style.setProperty('opacity', '0');
    }
    const cone = this.#puckEl.querySelector('.puck-accuracy');
    if (cone && Number.isFinite(accuracy)) {
      // scale the accuracy halo to real metres at the current zoom
      const metresPerPixel = 156543.03 * Math.cos(coords[1] * Math.PI / 180) / 2 ** this.map.getZoom();
      const radiusPx = clamp(accuracy / metresPerPixel, 8, 60);
      cone.setAttribute('r', String(radiusPx));
    }
  }

  hidePuck() {
    const parent = this.#puck?.getElement()?.parentElement;
    if (parent) parent.style.display = 'none';
  }

  /* ---------- camera ---------- */

  get followMode() { return this.#followMode; }

  setFollowMode(mode) {
    if (this.#followMode === mode) return;
    this.#followMode = mode;
    this.emit('follow', mode);
    if (mode === 'free') this.map.easeTo({ pitch: 0, duration: 400 });
  }

  /** Drive the camera from a navigation fix. Throttled to the display refresh. */
  follow = throttle(({ coords, heading, speed = 0, headUp = true }) => {
    if (!this.map || this.#followMode !== 'follow' || this.#userInteracting) return;
    // zoom out a little at speed so more of the road ahead is visible
    const zoom = FOLLOW.zoom - clamp((speed * 3.6 - 40) / 110, 0, 1.4);
    this.map.easeTo({
      center: coords,
      zoom,
      bearing: headUp ? (heading ?? this.#lastHeading) : 0,
      pitch: headUp ? FOLLOW.pitch : 0,
      // keep the puck low on screen so the road ahead fills the view
      padding: { top: this.map.getContainer().clientHeight * FOLLOW.offsetFraction, bottom: 0, left: 0, right: 0 },
      duration: 900,
      easing: (t) => t,
    });
  }, 700);

  flyTo(coords, { zoom = 15, duration = 900, pitch = 0, bearing: brg = 0 } = {}) {
    this.map?.easeTo({ center: coords, zoom, duration, pitch, bearing: brg });
  }

  fitBounds(bbox, { padding = OVERVIEW_PADDING, duration = 800, maxZoom = 16 } = {}) {
    if (!bbox || !this.map) return;
    this.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
      { padding, duration, maxZoom, pitch: 0, bearing: 0 });
  }

  fitRoute(coordinates, opts) { this.fitBounds(bboxOf(coordinates), opts); }

  resetNorth() { this.map?.easeTo({ bearing: 0, pitch: 0, duration: 400 }); }

  get bearing() { return this.map?.getBearing() ?? 0; }
  get center() { const c = this.map?.getCenter(); return c ? [c.lng, c.lat] : [0, 0]; }
  get zoom() { return this.map?.getZoom() ?? 0; }

  get viewBBox() {
    const b = this.map?.getBounds();
    return b ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] : null;
  }

  /* ---------- interaction ---------- */

  #wireInteractions() {
    const drop = () => {
      this.#userInteracting = true;
      if (this.#followMode === 'follow') this.setFollowMode('free');
    };
    this.map.on('dragstart', drop);
    this.map.on('rotatestart', drop);
    this.map.on('pitchstart', drop);
    this.map.on('zoomstart', (e) => { if (e.originalEvent) drop(); });
    this.map.on('moveend', () => { this.#userInteracting = false; this.emit('moveend', this.viewBBox); });
    this.map.on('rotate', () => this.emit('rotate', this.map.getBearing()));

    this.map.on('click', (e) => {
      const features = this.map.queryRenderedFeatures(e.point, {
        layers: ['cameras-point', 'search-results', 'trails-line', 'route-alt-line', 'route-points', 'trail-pois']
          .filter((id) => this.map.getLayer(id)),
      });
      this.emit('click', { coords: [e.lngLat.lng, e.lngLat.lat], features });
    });

    /* Long press drops a pin — the fastest way to route somewhere unnamed. */
    let pressTimer = null, pressStart = null;
    const startPress = (e) => {
      pressStart = e.point;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        this.emit('longpress', { coords: [e.lngLat.lng, e.lngLat.lat] });
      }, 550);
    };
    const cancelPress = (e) => {
      if (pressTimer && e?.point && pressStart
          && Math.hypot(e.point.x - pressStart.x, e.point.y - pressStart.y) < 12) return;
      clearTimeout(pressTimer); pressTimer = null;
    };
    this.map.on('mousedown', startPress);
    this.map.on('touchstart', startPress);
    for (const ev of ['mouseup', 'touchend', 'dragstart', 'mousemove', 'touchmove']) {
      this.map.on(ev, cancelPress);
    }
    this.map.on('contextmenu', (e) => {
      clearTimeout(pressTimer); pressTimer = null;
      this.emit('longpress', { coords: [e.lngLat.lng, e.lngLat.lat] });
    });
  }

  resize() { this.map?.resize(); }
}

/* ---------- GeoJSON helpers ---------- */

const empty = () => ({ type: 'FeatureCollection', features: [] });

const lineFeature = (coordinates, properties = {}) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties, geometry: { type: 'LineString', coordinates } }],
});

const pointFeature = (coordinates, properties = {}) => ({
  type: 'Feature', properties, geometry: { type: 'Point', coordinates },
});

function firstSymbolLayer(map) {
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type === 'symbol' || layer.id.startsWith('route')) return layer.id;
  }
  return undefined;
}

export const mapview = new MapView();
