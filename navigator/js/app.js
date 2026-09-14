/* app.js — composition root: wires the map, the sheet, the HUD and the engines. */

import { el, $, formatDistance, formatDuration, haptic, uid } from './lib/util.js';
import { requestPersistence } from './lib/idb.js';
import { t, getLang, setLang } from './i18n/strings.js';
import { settings } from './core/settings.js';
import { store } from './core/store.js';
import { mapview } from './map/mapview.js';
import { BASEMAPS } from './map/basemaps.js';
import { Sheet, toast } from './ui/sheet.js';
import { hud } from './ui/navhud.js';
import { icon } from './ui/icons.js';
import { searchPanel } from './ui/searchpanel.js';
import { placePanel, routePanel, stepsPanel } from './ui/routepanel.js';
import { weatherPanel } from './ui/weatherpanel.js';
import { trailsPanel } from './ui/trailspanel.js';
import { offlinePanel } from './ui/offlinepanel.js';
import { settingsPanel } from './ui/settingspanel.js';
import { planRoute, planAlternativesOffline, flowSegments, invalidateGraphCache } from './routing/service.js';
import { engine } from './nav/engine.js';
import { voice } from './nav/voice.js';
import { radar, speedingBy } from './features/cameras.js';
import { getWeather, describeCode, weatherAlongRoute, rainRadarFrames, rainTileTemplate, worstRisk } from './features/weather.js';
import { recorder, parseGPX } from './features/tracks.js';
import { describePoint, pushHistory } from './features/search.js';
import { downloadRegion, corridorBBox, addUserCamera } from './offline/regions.js';
import { bboxCenter } from './lib/geo.js';

const sheet = new Sheet();
let wakeLock = null;
let downloadController = null;
let weatherTimer = null;

/* ---------- the context panels talk to ---------- */

const app = {
  sheet,
  toast,

  /* --- navigation flow --- */
  async selectPlace(place) {
    store.set({ destination: place });
    mapview.setSearchResults([place], place.id);
    mapview.setRoutePoints([{ coords: place.coords, role: 'destination', label: place.name }]);
    mapview.flyTo(place.coords, { zoom: 15 });
    sheet.push(placePanel(app, place));
    refreshWeatherFor(place.coords);
    await pushHistory({ name: place.name, subtitle: place.subtitle, coords: place.coords, kind: place.kind });
  },

  async buildRoute(place) {
    const origin = store.coords;
    if (!origin) { toast(t('perm.locating'), { type: 'error' }); return; }

    store.set({ destination: place, routes: [], activeRouteIndex: 0, mode: 'planning' });
    sheet.push(routePanel(app));

    const points = [origin, ...store.state.waypoints.map((w) => w.coords), place.coords];
    try {
      const { routes, source, warning } = await planRoute(points, {
        profile: settings.get('profile'),
        avoid: settings.get('avoid'),
        preference: settings.get('routePreference'),
      });

      /* Offline gives one route by default; build the alternatives too so the
         choice is there whether or not there is a network. */
      let all = routes;
      if (source === 'offline' && routes.length === 1) {
        const alternatives = await planAlternativesOffline(points, {
          profile: settings.get('profile'), avoid: settings.get('avoid'),
        });
        if (alternatives.length > 1) all = alternatives;
      }

      store.set({ routes: all, activeRouteIndex: 0, routeSource: source });
      if (warning === 'online-failed') toast(t('common.offline'));

      drawRoute();
      sheet.refresh();
      await radar.loadForRoute(all[0].coordinates);
      mapview.setCameras(radar.cameras);
      loadRouteWeather(all[0]);
    } catch (err) {
      console.error(err);
      toast(err.message ?? t('route.failed'), { type: 'error' });
      sheet.pop();
    }
  },

  selectRoute(index) {
    store.set({ activeRouteIndex: index });
    drawRoute();
    sheet.refresh();
    loadRouteWeather(store.activeRoute);
  },

  addWaypoint(place) {
    store.set({ waypoints: [...store.state.waypoints, place] });
    toast(`${t('route.addStop')}: ${place.name}`, { type: 'success' });
    if (store.state.destination) app.buildRoute(store.state.destination);
  },

  startNavigation() {
    const route = store.activeRoute;
    if (!route) return;
    store.set({ mode: 'navigating' });
    voice.resetRoute();
    radar.reset();
    engine.start(route);
    hud.show();
    sheet.setDetent('hidden');
    mapview.setFollowMode('follow');
    mapview.setAlternatives([]);
    applyWakeLock();
    voice.say(route.steps?.[0] ? t('nav.start') : '', {});
  },

  stopNavigation({ silent = false } = {}) {
    engine.stop();
    voice.cancel();
    radar.reset();
    hud.hide();
    store.set({ mode: 'idle', navProgress: null, upcomingCamera: null, waypoints: [] });
    mapview.setFollowMode('free');
    mapview.setRouteProgress(0);
    sheet.setDetent('peek');
    releaseWakeLock();
    if (!silent) toast(t('nav.stop'));
  },

  showSteps() { sheet.push(stepsPanel(app)); },

  focusStep(step) {
    mapview.flyTo(step.coordinate, { zoom: 17, pitch: 0 });
    sheet.setDetent('peek');
  },

  /* --- panels --- */
  showWeather() {
    sheet.push(weatherPanel(app));
    refreshWeather().then(() => { if (sheet.current?.id === 'weather') sheet.refresh(); });
  },
  showTrails() { sheet.push(trailsPanel(app)); },
  showOffline() { sheet.push(offlinePanel(app)); },
  showSettings() { sheet.push(settingsPanel(app)); },

  /* --- map helpers --- */
  showResultsOnMap(results) { mapview.setSearchResults(results); },
  showTrailsOnMap(trails) { mapview.setTrails(trails); },
  showActiveTrail(trail) { mapview.setActiveTrail(trail); if (trail) mapview.fitBounds(trail.bbox); },
  showTrailPOIs(pois) { mapview.setTrailPOIs(pois); },
  showRegionBox(bbox) { mapview.setRegionBox(bbox); },
  currentViewBBox() { return mapview.viewBBox; },

  goToTrailArea(area) {
    mapview.flyTo(area.center, { zoom: 11 });
    toast(getLang() === 'ru' ? area.ru : area.en);
  },

  async followTrail(trail) {
    const origin = store.coords ?? trail.coords[0];
    settings.set('profile', 'hike');
    await app.buildRoute({
      name: trail.name || t('trails.title'),
      subtitle: `${formatDistance(trail.length, getLang())} · ${t('trails.scenic')} ${trail.scenic}`,
      coords: trail.coords[0],
    });
  },

  /* --- settings callbacks --- */
  setAvoid(key, value) {
    settings.setIn('avoid', key, value);
    if (store.state.destination) app.buildRoute(store.state.destination);
  },

  onProfileChange() {
    if (store.state.destination && store.hasRoute) app.buildRoute(store.state.destination);
  },

  onLanguageChange(lang) {
    setLang(lang);
    voice.configure({ lang });
    renderTopbar();
    sheet.refresh();
  },

  onVoiceChange(mode) {
    voice.configure({ mode });
    hud.setMuted(mode === 'off');
  },

  onRadarChange() {
    radar.configure({ enabled: settings.get('cameraAlerts'), types: settings.get('cameraAlertTypes') });
    mapview.setLayerGroup('cameras', settings.get('showCameras'));
  },

  applyTheme,
  applyWakeLock,
  refreshWeather,

  /* --- offline --- */
  async downloadCurrentView(detail, onDone) {
    const bbox = mapview.viewBBox;
    if (!bbox) return;
    const centre = bboxCenter(bbox);
    const place = await describePoint(centre, { lang: getLang() }).catch(() => ({ name: 'Регион' }));
    await runDownload({ bbox, detail, name: place.name }, onDone);
  },

  async previewRegion(preset) {
    mapview.fitBounds(preset.bbox);
    mapview.setRegionBox(preset.bbox);
    const name = getLang() === 'ru' ? preset.ru : preset.en;
    if (!confirm(`${t('offline.download')}: ${name}?`)) return;
    await runDownload({ bbox: preset.bbox, detail: preset.corridor ? 'route' : 'city', name },
      () => sheet.refresh());
  },

  async updateRegion(region, onDone) {
    await runDownload({ bbox: region.bbox, detail: region.detail, name: region.name, id: region.id }, onDone);
  },

  zoomToRegion(region) { mapview.fitBounds(region.bbox); sheet.setDetent('peek'); },

  cancelDownload() { downloadController?.abort(); },

  async saveRouteOffline() {
    const route = store.activeRoute;
    if (!route) return;
    const bbox = corridorBBox(route.coordinates, 5000);
    await runDownload({
      bbox, detail: 'route',
      name: `${t('route.go')}: ${store.state.destination?.name ?? ''}`.trim(),
    }, () => {});
  },

  async shareRoute() {
    const route = store.activeRoute;
    const dest = store.state.destination;
    if (!route || !dest) return;
    const text = `${dest.name} — ${formatDistance(route.distance, getLang())}, ${formatDuration(route.duration, getLang())}`;
    const url = `${location.origin}${location.pathname}#to=${dest.coords[1].toFixed(5)},${dest.coords[0].toFixed(5)}`;
    try {
      if (navigator.share) await navigator.share({ title: t('app.name'), text, url });
      else { await navigator.clipboard.writeText(`${text}\n${url}`); toast(t('common.done'), { type: 'success' }); }
    } catch { /* the user dismissed the share sheet */ }
  },

  /**
   * Mark a camera the map does not know about. Stored outside any region so it
   * survives deleting and re-downloading the pack it sits in.
   */
  async reportCamera(coords, kind = 'speed', maxspeed = null) {
    const cam = await addUserCamera(coords, kind, maxspeed);
    radar.add(cam);
    mapview.setCameras(radar.cameras);
    haptic([10, 30, 10]);
    toast(t('camera.reported'), { type: 'success' });
  },

  /* --- misc --- */
  async setHomeOrWork(key) {
    const coords = store.coords ?? mapview.center;
    const place = await describePoint(coords, { lang: getLang() });
    settings.set(key, { name: place.name, subtitle: place.subtitle, coords });
    toast(t('common.save'), { type: 'success' });
    sheet.refresh();
  },

  importGPX() {
    const input = el('input', { type: 'file', accept: '.gpx,application/gpx+xml', style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const track = parseGPX(await file.text());
        mapview.setTrack(track.coords);
        mapview.fitRoute(track.coords);
        sheet.setDetent('peek');
        toast(`${track.name}: ${formatDistance(track.distance, getLang())}`, { type: 'success' });
      } catch (err) { toast(err.message, { type: 'error' }); }
      input.remove();
    });
    document.body.append(input);
    input.click();
  },

  async toggleRainLayer() {
    if (store.state.rainLayerOn) {
      mapview.setRainLayer(null);
      store.set({ rainLayerOn: false });
      sheet.refresh();
      return;
    }
    try {
      const { host, frames, latestIndex } = await rainRadarFrames();
      const frame = frames[latestIndex] ?? frames.at(-1);
      if (!frame) throw new Error('no radar frames');
      mapview.setRainLayer(rainTileTemplate(host, frame.path));
      store.set({ rainLayerOn: true });
      sheet.refresh();
    } catch (err) { toast(err.message, { type: 'error' }); }
  },
};

/* ---------- route drawing ---------- */

function drawRoute() {
  const active = store.activeRoute;
  if (!active) { mapview.setRoute(null); return; }
  mapview.setRoute(active);
  mapview.setAlternatives(store.state.routes.filter((_, i) => i !== store.state.activeRouteIndex));
  mapview.setFlow(settings.get('showTraffic') ? flowSegments(active) : null);

  const points = [];
  if (store.coords) points.push({ coords: store.coords, role: 'origin', label: '' });
  for (const w of store.state.waypoints) points.push({ coords: w.coords, role: 'stop', label: w.name });
  if (store.state.destination) {
    points.push({ coords: store.state.destination.coords, role: 'destination', label: store.state.destination.name });
  }
  mapview.setRoutePoints(points);
  mapview.fitRoute(active.coordinates);
}

/* ---------- downloads ---------- */

async function runDownload({ bbox, detail, name, id }, onDone) {
  if (downloadController) { toast(t('offline.downloading')); return; }
  downloadController = new AbortController();
  store.set({ downloading: { name, phase: 'roads', done: 0, total: 1 } });
  sheet.refresh();

  try {
    await downloadRegion({
      bbox, detail, name, id,
      signal: downloadController.signal,
      onProgress: (p) => {
        store.set({ downloading: { name, ...p } });
        sheet.refresh();
      },
    });
    invalidateGraphCache();
    toast(t('offline.done'), { type: 'success' });
    haptic([10, 40, 10]);
  } catch (err) {
    if (err.name === 'AbortError') toast(t('offline.cancel'));
    else if (err.code === 'AREA_TOO_LARGE') toast(t('offline.tooBig'), { type: 'error' });
    else toast(`${t('offline.failed')}: ${err.message}`, { type: 'error' });
  } finally {
    downloadController = null;
    store.set({ downloading: null });
    onDone?.();
    sheet.refresh();
  }
}

/* ---------- weather ---------- */

async function refreshWeatherFor(coords, force = false) {
  if (!coords) return;
  try {
    const wx = await getWeather(coords, { force });
    if (!wx?.data) return;
    const c = wx.data.current ?? {};
    const desc = describeCode(c.weather_code, getLang(), c.is_day === 1);
    store.set({
      weatherRaw: wx,
      weather: { current: { temperature: c.temperature_2m, ...desc }, stale: wx.stale },
    });
    renderTopbar();
    // the panel may already be open, showing its loading state
    if (sheet.current?.id === 'weather' || sheet.current?.id === 'route') sheet.refresh();
  } catch { /* weather is never worth an error banner */ }
}

/* A function declaration, not a const: the `app` object literal below references
   it while this module is still evaluating. */
function refreshWeather(force = false) {
  return refreshWeatherFor(store.coords ?? mapview.center, force);
}

async function loadRouteWeather(route) {
  if (!route || !navigator.onLine) return;
  try {
    const points = await weatherAlongRoute(route.coordinates, route.duration, { samples: 5, lang: getLang() });
    store.set({ weatherAlongRoute: points });
    sheet.refresh();
    const worst = worstRisk(points);
    if (worst && worst.risk.level >= 2) {
      toast(t(worst.risk.key), { type: 'error', duration: 4200 });
      voice.say(t(worst.risk.key), { priority: 'high', key: `wx:${worst.risk.key}` });
    }
  } catch { /* ignore */ }
}

/* ---------- geolocation ---------- */

function startGeolocation() {
  if (!navigator.geolocation) { toast(t('perm.locationDenied'), { type: 'error' }); return; }
  navigator.geolocation.watchPosition(onFix, onFixError, {
    enableHighAccuracy: true, maximumAge: 1000, timeout: 20000,
  });
}

let lastCameraCheck = 0;

function onFix(position) {
  const { longitude, latitude, accuracy, heading, speed, altitude } = position.coords;
  const fix = {
    coords: [longitude, latitude],
    accuracy, heading: Number.isFinite(heading) ? heading : null,
    speed: Number.isFinite(speed) ? speed : null,
    altitude, at: position.timestamp ?? Date.now(),
  };

  const first = !store.state.position;
  store.set({ position: fix, positionError: null });
  mapview.setPosition({ coords: fix.coords, heading: fix.heading, accuracy });

  if (first) {
    mapview.flyTo(fix.coords, { zoom: 14 });
    refreshWeatherFor(fix.coords);
    radar.ensureLoaded(fix.coords).then(() => mapview.setCameras(radar.cameras));
  }

  if (recorder.active) {
    if (recorder.add(fix)) mapview.setTrack(recorder.points.map((p) => p.coords));
  }

  /* --- navigation tick --- */
  if (engine.isActive) {
    // the engine emits 'progress'; everything that reacts to it is wired in
    // wireEngine(), so the HUD updates for any fix source, tests included
    engine.update(fix);
  } else {
    // idle: still warn about cameras, which is what a radar detector is for
    if (Date.now() - lastCameraCheck > 1500) {
      lastCameraCheck = Date.now();
      radar.ensureLoaded(fix.coords).then(() => checkRadar(fix, null));
    }
  }
}

function checkRadar(fix, progress) {
  if (!settings.get('cameraAlerts')) { hud.setCameraAlert(null); return; }
  const speed = progress?.speed ?? fix.speed ?? 0;
  const heading = progress?.heading ?? fix.heading;
  const alert = radar.evaluate({ coords: fix.coords, heading, speed },
    progress ? store.activeRoute?.coordinates : null);

  store.set({ upcomingCamera: alert });
  hud.setCameraAlert(alert);
  hud.setZone(radar.zone);
  mapview.setCameraZone(radar.zone);
  if (alert?.fresh) { voice.announceCamera(alert); haptic(18); }

  /* Speed limit: the camera's own limit is the one that will actually fine you. */
  const limit = alert?.camera?.maxspeed ?? store.state.speedLimit;
  const overBy = settings.get('speedWarn') ? speedingBy(speed, limit) : 0;
  hud.setSpeedLimit(limit, overBy > settings.get('speedWarnBy') ? overBy : 0);
  if (overBy > settings.get('speedWarnBy') && alert) voice.announceSpeeding(overBy);
}

function onFixError(err) {
  store.set({ positionError: err.message });
  if (err.code === err.PERMISSION_DENIED) toast(t('perm.locationDenied'), { type: 'error', duration: 5000 });
  else if (engine.isActive) voice.announce('nav.gpsWeak');
}

/* ---------- theme + wake lock ---------- */

function applyTheme() {
  const wx = store.state.weatherRaw?.data;
  const isNight = wx?.current?.is_day === 0;
  const theme = settings.effectiveTheme(isNight);
  document.documentElement.dataset.theme = theme;

  const wantStyle = settings.get('mapStyle');
  const auto = wantStyle === 'day' || wantStyle === 'night';
  const styleId = auto ? (theme === 'dark' ? 'night' : 'day') : wantStyle;
  mapview.setStyle(styleId, { hillshade: styleId === 'topo' || settings.get('profile') === 'hike' });
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#000000' : '#f2f2f7');
}

async function applyWakeLock() {
  if (!settings.get('keepAwake') || !('wakeLock' in navigator)) return releaseWakeLock();
  if (wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* denied or unsupported */ }
}

function releaseWakeLock() { wakeLock?.release?.(); wakeLock = null; }

/* ---------- chrome ---------- */

let topbarNode = null;

function renderTopbar() {
  const host = topbarNode;
  if (!host) return;
  host.replaceChildren();

  const online = store.state.online;
  host.append(el('button', {
    class: 'pill', onClick: () => app.showOffline(),
  }, el('span', { class: `dot ${online ? '' : 'off'}` }),
     online ? t('common.online') : t('common.offline')));

  const wx = store.state.weather;
  if (wx?.current) {
    host.append(el('button', {
      class: 'pill', onClick: () => app.showWeather(),
    }, wx.current.icon, `${Math.round(wx.current.temperature)}°`));
  }

  host.append(el('div', { style: { flex: '1' } }));

  host.append(el('button', {
    class: 'pill', onClick: () => app.showTrails(), 'aria-label': t('trails.title'),
  }, el('span', { html: icon('trail'), style: { display: 'grid', width: '17px', height: '17px' } })));

  host.append(el('button', {
    class: 'pill', onClick: () => app.showSettings(), 'aria-label': t('settings.title'),
  }, el('span', { html: icon('settings'), style: { display: 'grid', width: '17px', height: '17px' } })));
}

function renderControls(parent) {
  const compass = el('button', {
    class: 'fab', 'aria-label': t('map.style.day'), html: icon('compass'),
    onClick: () => mapview.resetNorth(),
  });
  mapview.on('rotate', (bearing) => {
    compass.querySelector('.compass-needle')?.style.setProperty('transform', `rotate(${-bearing}deg)`);
  });

  const locate = el('button', {
    class: 'fab active', 'aria-label': t('search.myLocation'), html: icon('locate'),
    onClick: () => {
      if (!store.coords) { toast(t('perm.locating')); return; }
      mapview.setFollowMode('follow');
      mapview.flyTo(store.coords, { zoom: 16 });
      haptic();
    },
  });
  mapview.on('follow', (mode) => locate.classList.toggle('active', mode === 'follow'));

  const layers = el('button', {
    class: 'fab', 'aria-label': t('map.layers'), html: icon('layers'),
    onClick: cycleMapStyle,
  });

  const camerasBtn = el('button', {
    class: `fab brand ${settings.get('showCameras') ? 'active' : ''}`,
    'aria-label': t('map.cameras'), html: icon('camera'),
    onClick: (e) => {
      const next = settings.toggle('showCameras');
      e.currentTarget.classList.toggle('active', next);
      mapview.setLayerGroup('cameras', next);
      haptic();
    },
  });

  const record = el('button', {
    class: 'fab', 'aria-label': t('track.record'), html: icon('record'),
    onClick: async (e) => {
      if (recorder.active) {
        const track = await recorder.stop();
        e.currentTarget.classList.remove('active');
        toast(`${t('track.saved')}: ${formatDistance(track.distance, getLang())}`, { type: 'success' });
      } else {
        recorder.start();
        e.currentTarget.classList.add('active');
        toast(t('track.record'));
      }
    },
  });

  parent.append(el('div', { class: 'controls' }, compass, layers, camerasBtn, record, locate));
}

const STYLE_CYCLE = ['day', 'night', 'satellite', 'topo'];

function cycleMapStyle() {
  const current = mapview.styleId;
  const next = STYLE_CYCLE[(STYLE_CYCLE.indexOf(current) + 1) % STYLE_CYCLE.length];
  settings.set('mapStyle', next);
  mapview.setStyle(next, { hillshade: next === 'topo' });
  toast(t(BASEMAPS[next].labelKey));
  haptic();
}

/* ---------- map interactions ---------- */

function wireMap() {
  mapview.on('longpress', async ({ coords }) => {
    haptic(15);
    const place = await describePoint(coords, { lang: getLang() });
    app.selectPlace({ ...place, id: `pin:${uid()}`, coords });
  });

  mapview.on('click', ({ features, coords }) => {
    const cameraFeature = features.find((f) => f.layer.id === 'cameras-point');
    if (cameraFeature) {
      const p = cameraFeature.properties;
      toast(`${t(`camera.${p.kind === 'redLight' ? 'redLight' : p.kind}`)}${p.maxspeed ? ` · ${p.maxspeed}` : ''}`);
      return;
    }
    const trailFeature = features.find((f) => f.layer.id === 'trails-line');
    if (trailFeature) {
      toast(`${trailFeature.properties.name || t('trails.title')} · ${t('trails.scenic')} ${trailFeature.properties.scenic}`);
      return;
    }
    const altFeature = features.find((f) => f.layer.id === 'route-alt-line');
    if (altFeature && store.state.routes.length > 1) {
      const index = store.state.routes.findIndex((r) => r.label === altFeature.properties.label);
      if (index >= 0) app.selectRoute(index);
    }
  });
}

/* ---------- engine wiring ---------- */

function wireEngine() {
  engine.on('progress', (progress) => {
    store.set({ navProgress: progress });
    hud.update(progress);
    mapview.setRouteProgress(progress.fraction);
    mapview.follow({
      coords: progress.snapped, heading: progress.heading,
      speed: progress.speed, headUp: settings.get('headUp'),
    });
    voice.announceManeuver(progress);
    checkRadar({ coords: progress.snapped, heading: progress.heading, speed: progress.speed }, progress);
  });

  engine.on('off-route', async () => {
    if (!store.state.destination) return;
    toast(t('nav.recalculating'));
    voice.announce('nav.recalculating');
    voice.resetRoute();
    const origin = store.coords;
    try {
      const { routes, source } = await planRoute(
        [origin, ...store.state.waypoints.map((w) => w.coords), store.state.destination.coords],
        { profile: settings.get('profile'), avoid: settings.get('avoid'), preference: settings.get('routePreference') });
      store.set({ routes, activeRouteIndex: 0, routeSource: source });
      mapview.setRoute(routes[0]);
      mapview.setAlternatives([]);
      engine.start(routes[0]);
      await radar.loadForRoute(routes[0].coordinates);
      mapview.setCameras(radar.cameras);
    } catch (err) {
      toast(t('route.failed'), { type: 'error' });
    }
  });

  engine.on('arrived', () => {
    voice.say(t('nav.arrived'), { priority: 'high', key: 'arrived' });
    haptic([20, 60, 20]);
    toast(t('nav.arrived'), { type: 'success', duration: 4000 });
    setTimeout(() => app.stopNavigation({ silent: true }), 2500);
  });

  radar.on('zone-start', (zone) => voice.announceZone(zone, 'start'));
  radar.on('zone-update', (zone) => {
    hud.setZone(zone);
    if (zone.projectedFine) voice.announceZone(zone, 'over');
  });
  radar.on('zone-end', () => { hud.setZone(null); mapview.setCameraZone(null); });

  hud.onEnd(() => { if (confirm(t('nav.stopConfirm'))) app.stopNavigation(); });
  hud.onOverview(() => {
    const route = store.activeRoute;
    if (!route) return;
    const free = mapview.followMode !== 'follow';
    mapview.setFollowMode(free ? 'follow' : 'free');
    if (!free) mapview.fitRoute(route.coordinates);
  });
  hud.onMute(() => {
    const next = settings.get('voice') === 'off' ? 'full' : 'off';
    settings.set('voice', next);
    voice.configure({ mode: next });
    hud.setMuted(next === 'off');
    toast(next === 'off' ? t('nav.muted') : t('nav.unmuted'));
  });
}

/* ---------- deep links ---------- */

async function handleHash() {
  const match = location.hash.match(/to=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (!match) return;
  const coords = [Number(match[2]), Number(match[1])];
  const place = await describePoint(coords, { lang: getLang() });
  app.selectPlace({ ...place, id: `link:${uid()}`, coords });
}

/* ---------- boot ---------- */

async function boot() {
  const root = $('#app');
  document.documentElement.dataset.theme = settings.effectiveTheme(false);
  document.body.classList.toggle('hud-mode', settings.get('hudMode'));

  await mapview.init('map', {
    styleId: settings.get('mapStyle') === 'night' ? 'night' : settings.get('mapStyle'),
    hillshade: settings.get('mapStyle') === 'topo',
  });

  topbarNode = el('div', { class: 'topbar' });
  root.append(topbarNode);
  renderTopbar();
  renderControls(root);
  hud.mount(root);
  sheet.mount(root);
  sheet.reset(searchPanel(app));

  voice.configure({ lang: settings.get('lang'), mode: settings.get('voice'), rate: settings.get('voiceRate') });
  radar.configure({ enabled: settings.get('cameraAlerts'), types: settings.get('cameraAlertTypes') });
  hud.setMuted(settings.get('voice') === 'off');

  wireMap();
  wireEngine();
  startGeolocation();
  applyTheme();
  requestPersistence();

  store.on('change:online', () => { renderTopbar(); sheet.refresh(); });
  settings.on('change:lang', () => renderTopbar());
  addEventListener('resize', () => { mapview.resize(); hud.layout(); });
  addEventListener('hashchange', handleHash);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && engine.isActive) applyWakeLock();
  });

  /* Speech voices load asynchronously in most browsers. */
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.addEventListener?.('voiceschanged', () => voice.configure({ lang: settings.get('lang') }));
  }

  weatherTimer = setInterval(() => refreshWeather(), 20 * 60 * 1000);
  handleHash();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: './' })
      .catch((err) => console.warn('service worker registration failed', err));
  }

  document.body.dataset.ready = 'true';
}

/* Expose a little of the app for debugging without opening a console tab. */
globalThis.compass = { app, store, settings, mapview, engine, radar, voice };

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<div style="padding:40px;font:16px system-ui">Ошибка запуска: ${err.message}</div>`;
});
