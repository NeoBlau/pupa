/* basemaps.js — raster/vector basemap definitions and MapLibre style assembly.
   Every default source is key-free, so the app works out of the box. */

const ATTR_OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ATTR_CARTO = `${ATTR_OSM} © <a href="https://carto.com/attributions">CARTO</a>`;

export const BASEMAPS = {
  day: {
    id: 'day', labelKey: 'map.style.day', scheme: 'light',
    tiles: ['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
            'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
            'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'],
    tileSize: 256, maxzoom: 20, attribution: ATTR_CARTO,
    background: '#eef1f5',
  },
  night: {
    id: 'night', labelKey: 'map.style.night', scheme: 'dark',
    tiles: ['https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png',
            'https://b.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png',
            'https://c.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png'],
    tileSize: 256, maxzoom: 20, attribution: ATTR_CARTO,
    background: '#0b0d10',
  },
  satellite: {
    id: 'satellite', labelKey: 'map.style.satellite', scheme: 'dark',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256, maxzoom: 19, attribution: '© Esri, Maxar, Earthstar Geographics',
    background: '#1a1f26',
    overlayLabels: {
      tiles: ['https://a.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}@2x.png'],
      attribution: ATTR_CARTO,
    },
  },
  topo: {
    id: 'topo', labelKey: 'map.style.topo', scheme: 'light',
    tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
            'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
            'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'],
    tileSize: 256, maxzoom: 17, attribution: `${ATTR_OSM}, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a>`,
    background: '#e8e3d8', hillshade: false, // the raster already carries contours
  },
};

/** Terrarium-encoded elevation, used for hillshade under the hiking style. */
export const TERRAIN_SOURCE = {
  type: 'raster-dem',
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium',
  tileSize: 256, maxzoom: 13,
  attribution: 'Elevation © Mapzen / AWS Terrain Tiles',
};

/**
 * Live traffic needs a commercial feed; there is no key-free source that is
 * legal and current. The layer is therefore opt-in: paste a key and it appears,
 * otherwise the app shows no traffic at all rather than inventing it.
 */
export const TRAFFIC_PROVIDERS = {
  tomtom: {
    id: 'tomtom', label: 'TomTom',
    url: (key) => `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`,
    maxzoom: 18, attribution: '© TomTom Traffic',
    signupUrl: 'https://developer.tomtom.com/',
  },
};

/** Empty GeoJSON collections the overlay layers bind to before data arrives. */
const EMPTY = { type: 'FeatureCollection', features: [] };
const geojson = (extra = {}) => ({ type: 'geojson', data: EMPTY, ...extra });

/**
 * Build a full MapLibre style for a basemap.
 * Overlay sources are declared up front so `setStyle` swaps never lose our data layers.
 */
export function buildStyle(basemapId, { hillshade = false } = {}) {
  const bm = BASEMAPS[basemapId] ?? BASEMAPS.day;

  const sources = {
    basemap: {
      type: 'raster', tiles: bm.tiles, tileSize: bm.tileSize,
      maxzoom: bm.maxzoom, attribution: bm.attribution,
    },
    'route-line': geojson({ lineMetrics: true }),
    'route-alt': geojson(),
    'route-casing-traffic': geojson({ lineMetrics: true }),
    'route-points': geojson(),
    'cameras': geojson({ cluster: true, clusterRadius: 42, clusterMaxZoom: 12 }),
    'camera-zones': geojson(),
    'trails': geojson(),
    'trail-active': geojson(),
    'trail-pois': geojson(),
    'search-results': geojson(),
    'region-box': geojson(),
    'track': geojson(),
  };

  if (bm.overlayLabels) {
    sources['basemap-labels'] = {
      type: 'raster', tiles: bm.overlayLabels.tiles, tileSize: 256,
      maxzoom: 20, attribution: bm.overlayLabels.attribution,
    };
  }
  if (hillshade) sources.terrain = TERRAIN_SOURCE;

  const layers = [
    { id: 'bg', type: 'background', paint: { 'background-color': bm.background } },
    {
      id: 'basemap', type: 'raster', source: 'basemap',
      paint: { 'raster-opacity': 1, 'raster-fade-duration': 180 },
    },
  ];

  if (hillshade) {
    layers.push({
      id: 'hillshade', type: 'hillshade', source: 'terrain',
      paint: {
        'hillshade-exaggeration': 0.35,
        'hillshade-shadow-color': bm.scheme === 'dark' ? '#000000' : '#4a5568',
        'hillshade-highlight-color': bm.scheme === 'dark' ? '#3a4350' : '#ffffff',
      },
    });
  }
  if (bm.overlayLabels) {
    layers.push({ id: 'basemap-labels', type: 'raster', source: 'basemap-labels', paint: { 'raster-opacity': 0.95 } });
  }

  layers.push(...overlayLayers(bm.scheme));
  return {
    version: 8,
    name: `compass-${bm.id}`,
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sources,
    layers,
    sky: { 'sky-color': bm.scheme === 'dark' ? '#0b1020' : '#8fbcf5', 'horizon-color': bm.scheme === 'dark' ? '#1c2333' : '#dce9fb', 'fog-color': bm.scheme === 'dark' ? '#0b0d10' : '#eef1f5', 'fog-ground-blend': 0.6 },
  };
}

const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];

/** Route, camera, trail and marker layers — shared across every basemap. */
function overlayLayers(scheme) {
  const dark = scheme === 'dark';
  const routeCore = dark ? '#0A84FF' : '#007AFF';
  const routeCasing = dark ? '#0a2a4d' : '#ffffff';

  return [
    /* --- region selection box (offline download) --- */
    { id: 'region-box-fill', type: 'fill', source: 'region-box',
      paint: { 'fill-color': '#FC3F1D', 'fill-opacity': 0.12 } },
    { id: 'region-box-line', type: 'line', source: 'region-box',
      paint: { 'line-color': '#FC3F1D', 'line-width': 2, 'line-dasharray': [2, 2] } },

    /* --- recorded track --- */
    { id: 'track-line', type: 'line', source: 'track',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#FF9F0A', 'line-width': 4, 'line-opacity': 0.9 } },

    /* --- trails --- */
    { id: 'trails-casing', type: 'line', source: 'trails',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': dark ? '#04150a' : '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 8], 'line-opacity': 0.7 } },
    { id: 'trails-line', type: 'line', source: 'trails',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 16, 4.5],
        'line-color': ['interpolate', ['linear'], ['get', 'scenic'],
          0, dark ? '#4f7a5c' : '#7ba888', 50, '#34C759', 100, '#00C2A8'],
        'line-dasharray': [2.2, 1.1],
      } },
    { id: 'trail-active-casing', type: 'line', source: 'trail-active',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': dark ? '#052b16' : '#ffffff', 'line-width': 11, 'line-opacity': 0.9 } },
    { id: 'trail-active-line', type: 'line', source: 'trail-active',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#30D158', 'line-width': 6 } },
    { id: 'trail-pois', type: 'circle', source: 'trail-pois',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 7],
        'circle-color': ['match', ['get', 'kind'],
          'viewpoint', '#FF9F0A', 'peak', '#FF453A', 'water', '#0A84FF', 'shelter', '#BF5AF2', '#8E8E93'],
        'circle-stroke-width': 1.5, 'circle-stroke-color': dark ? '#0b0d10' : '#ffffff',
      } },
    { id: 'trail-pois-label', type: 'symbol', source: 'trail-pois',
      minzoom: 13,
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': dark ? '#e7e9ee' : '#1c1c1e', 'text-halo-color': dark ? '#000' : '#fff', 'text-halo-width': 1.4 } },

    /* --- alternative routes sit under the active one --- */
    { id: 'route-alt-casing', type: 'line', source: 'route-alt',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': dark ? '#000000' : '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 13], 'line-opacity': 0.55 } },
    { id: 'route-alt-line', type: 'line', source: 'route-alt',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': dark ? '#5a6572' : '#9aa4b2', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 9] } },
    { id: 'route-alt-label', type: 'symbol', source: 'route-alt',
      layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': 13 },
      paint: { 'text-color': dark ? '#c8cfd8' : '#3a3f47', 'text-halo-color': dark ? '#000' : '#fff', 'text-halo-width': 2 } },

    /* --- active route: casing, core, traffic tint, direction arrows --- */
    { id: 'route-casing', type: 'line', source: 'route-line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': routeCasing, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 8, 16, 18], 'line-opacity': 0.95 } },
    { id: 'route-line', type: 'line', source: 'route-line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': routeCore,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 13],
        // travelled portion dims as navigation progresses (set via setPaintProperty)
        'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, routeCore, 1, routeCore],
      } },
    { id: 'route-flow', type: 'line', source: 'route-casing-traffic',
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7],
        'line-color': ['match', ['get', 'flow'], 'slow', '#FF9F0A', 'jam', '#FF453A', 'closed', '#8E0000', 'transparent'],
        'line-opacity': 0.95,
      } },
    { id: 'route-arrows', type: 'symbol', source: 'route-line',
      minzoom: 13,
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'text-field': '▸', 'text-font': FONT, 'text-size': 15, 'text-keep-upright': false, 'text-allow-overlap': true },
      paint: { 'text-color': '#ffffff', 'text-halo-color': routeCore, 'text-halo-width': 1 } },

    /* --- average-speed enforcement corridors --- */
    { id: 'camera-zone-line', type: 'line', source: 'camera-zones',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#FF375F', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7], 'line-opacity': 0.55, 'line-dasharray': [1.5, 1] } },

    /* --- cameras: clustered dots + icons --- */
    { id: 'cameras-cluster', type: 'circle', source: 'cameras', filter: ['has', 'point_count'],
      paint: {
        'circle-color': dark ? 'rgba(255,55,95,0.85)' : 'rgba(255,59,48,0.9)',
        'circle-radius': ['step', ['get', 'point_count'], 13, 10, 17, 50, 22],
        'circle-stroke-width': 2, 'circle-stroke-color': dark ? '#1c1c1e' : '#ffffff',
      } },
    { id: 'cameras-cluster-count', type: 'symbol', source: 'cameras', filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': FONT_BOLD, 'text-size': 12 },
      paint: { 'text-color': '#ffffff' } },
    { id: 'cameras-point', type: 'circle', source: 'cameras', filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 9],
        'circle-color': ['match', ['get', 'kind'],
          'redLight', '#FF375F', 'average', '#BF5AF2', 'bus', '#FF9F0A', 'parking', '#5E5CE6', '#FF3B30'],
        'circle-stroke-width': 2, 'circle-stroke-color': dark ? '#101214' : '#ffffff',
      } },
    { id: 'cameras-limit', type: 'symbol', source: 'cameras',
      filter: ['all', ['!', ['has', 'point_count']], ['has', 'maxspeed']], minzoom: 14,
      layout: { 'text-field': ['to-string', ['get', 'maxspeed']], 'text-font': FONT_BOLD, 'text-size': 10, 'text-offset': [0, -1.3], 'text-allow-overlap': false },
      paint: { 'text-color': dark ? '#fff' : '#1c1c1e', 'text-halo-color': dark ? '#000' : '#fff', 'text-halo-width': 1.6 } },

    /* --- search results --- */
    { id: 'search-results', type: 'circle', source: 'search-results',
      paint: {
        'circle-radius': ['case', ['boolean', ['get', 'selected'], false], 9, 6],
        'circle-color': '#FC3F1D', 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff',
      } },
    { id: 'search-results-label', type: 'symbol', source: 'search-results',
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT_BOLD, 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': dark ? '#f2f2f7' : '#1c1c1e', 'text-halo-color': dark ? '#000' : '#fff', 'text-halo-width': 1.8 } },

    /* --- route origin / stops / destination --- */
    { id: 'route-points-halo', type: 'circle', source: 'route-points',
      paint: { 'circle-radius': 13, 'circle-color': ['match', ['get', 'role'], 'destination', '#FC3F1D', 'origin', '#34C759', '#0A84FF'], 'circle-opacity': 0.22 } },
    { id: 'route-points', type: 'circle', source: 'route-points',
      paint: {
        'circle-radius': 7,
        'circle-color': ['match', ['get', 'role'], 'destination', '#FC3F1D', 'origin', '#34C759', '#0A84FF'],
        'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff',
      } },
    { id: 'route-points-label', type: 'symbol', source: 'route-points',
      layout: { 'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': 12, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': dark ? '#f2f2f7' : '#1c1c1e', 'text-halo-color': dark ? '#000' : '#fff', 'text-halo-width': 2 } },
  ];
}

/** Layer ids grouped by the toggle that controls them. */
export const LAYER_GROUPS = {
  cameras: ['cameras-cluster', 'cameras-cluster-count', 'cameras-point', 'cameras-limit', 'camera-zone-line'],
  trails: ['trails-casing', 'trails-line', 'trail-pois', 'trail-pois-label'],
  traffic: ['route-flow'],
};
