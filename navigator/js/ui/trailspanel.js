/* trailspanel.js — scenic trails: discovery, ranking, elevation profile. */

import { el, formatDistance, formatDuration, haptic } from '../lib/util.js';
import { t, getLang, plural } from '../i18n/strings.js';
import { icon } from './icons.js';
import { sectionTitle, listCard, emptyState, spinnerRow, kv } from './sheet.js';
import { trailsNear, discoverTrails, withElevation, hikingDuration, difficultyKey, trailPOIs } from '../features/trails.js';
import { TRAIL_AREAS } from '../data/presets.js';
import { store } from '../core/store.js';

export function trailsPanel(app) {
  let trails = [];
  let loading = false;
  let loaded = false;

  async function load() {
    if (!store.coords) return;
    trails = await trailsNear(store.coords, 25000);
    loaded = true;
    app.sheet.refresh();
    app.showTrailsOnMap(trails);
  }

  async function discover() {
    if (!store.coords) { app.toast(t('perm.locating')); return; }
    if (!navigator.onLine) { app.toast(t('common.offline'), { type: 'error' }); return; }
    loading = true; app.sheet.refresh();
    try {
      trails = await discoverTrails(store.coords, 15000);
      app.showTrailsOnMap(trails);
      app.toast(`${trails.length} ${plural(trails.length, ['тропа', 'тропы', 'троп'])}`, { type: 'success' });
    } catch (err) {
      app.toast(err.message, { type: 'error' });
    } finally { loading = false; loaded = true; app.sheet.refresh(); }
  }

  return {
    id: 'trails',
    detent: 'full',
    onLeave: () => app.showTrailsOnMap([]),
    render(body) {
      body.append(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', paddingBottom: '8px' } },
        el('button', { class: 'btn small', onClick: () => app.sheet.pop() }, '‹'),
        el('div', { style: { fontSize: '20px', fontWeight: '700' }, text: t('trails.title') })));

      if (!loaded && !loading) load();

      body.append(el('button', {
        class: 'btn wide', style: { marginBottom: '12px' },
        onClick: discover, disabled: loading,
      }, loading ? el('div', { class: 'spinner' }) : el('span', { html: icon('trail'), style: { display: 'grid' } }),
         loading ? t('common.loading') : t('trails.load')));

      if (loading) { body.append(spinnerRow(t('common.loading'))); return; }

      if (trails.length) {
        body.append(sectionTitle(t('trails.nearby')));
        for (const trail of trails.slice(0, 30)) body.append(trailCard(app, trail));
      } else if (loaded) {
        body.append(emptyState(t('trails.noneFound')));
      }

      /* --- curated scenic areas worth travelling to --- */
      body.append(sectionTitle(getLang() === 'ru' ? 'Знаменитые маршруты' : 'Famous routes'));
      body.append(listCard(...TRAIL_AREAS.map((area) => el('button', {
        class: 'row',
        onClick: () => { haptic(); app.goToTrailArea(area); },
      },
        el('div', { class: 'row-icon green', html: icon('mountain') }),
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title', text: getLang() === 'ru' ? area.ru : area.en }),
          el('div', { class: 'row-sub', text: `${Math.round(area.radius / 1000)} ${t('common.km')}` })),
        el('div', { class: 'row-meta', html: icon('chevron'), style: { width: '18px', color: 'var(--text-3)' } })))));
    },
  };
}

function trailCard(app, trail) {
  const lang = getLang();
  const duration = hikingDuration(trail.length, trail.ascent ?? 0, trail.difficulty);
  return el('button', {
    class: 'trail-card',
    onClick: () => { haptic(); app.sheet.push(trailDetailPanel(app, trail)); },
  },
    el('div', { class: 'trail-head' },
      el('div', { class: 'trail-name', text: trail.name || (lang === 'ru' ? 'Тропа без названия' : 'Unnamed path') }),
      el('div', { class: 'scenic-meter' },
        el('div', { class: 'scenic-bar' }, el('i', { style: { width: `${trail.scenic}%` } })),
        el('div', { class: 'scenic-val', text: String(trail.scenic) }))),
    el('div', { class: 'trail-meta' },
      el('i', { text: formatDistance(trail.length, lang) }),
      el('i', { text: `~${formatDuration(duration, lang)}` }),
      el('i', { text: t(difficultyKey(trail.difficulty)) }),
      trail.loop ? el('i', { text: t('trails.loop') }) : null,
      trail.viewpoints ? el('i', { text: `👁 ${trail.viewpoints}` }) : null,
      trail.water ? el('i', { text: '💧' }) : null,
      trail.distance != null ? el('i', { style: { marginLeft: 'auto', color: 'var(--text-3)' },
        text: `${formatDistance(trail.distance, lang)} ${lang === 'ru' ? 'до старта' : 'to start'}` }) : null));
}

export function trailDetailPanel(app, initial) {
  let trail = initial;
  let pois = [];
  let loadingElevation = false;

  return {
    id: `trail:${trail.id}`,
    detent: 'half',
    async render(body) {
      const lang = getLang();
      app.showActiveTrail(trail);

      body.append(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', paddingBottom: '8px' } },
        el('button', { class: 'btn small', onClick: () => { app.showActiveTrail(null); app.sheet.pop(); } }, '‹'),
        el('div', { style: { fontSize: '19px', fontWeight: '700', flex: '1', minWidth: '0' },
          text: trail.name || (lang === 'ru' ? 'Тропа' : 'Trail') })));

      body.append(el('div', { class: 'trail-meta', style: { marginBottom: '10px' } },
        el('i', { text: formatDistance(trail.length, lang) }),
        el('i', { text: t(difficultyKey(trail.difficulty)) }),
        el('i', { text: `${t('trails.scenic')} ${trail.scenic}/100` }),
        trail.surface ? el('i', { text: trail.surface }) : null));

      /* --- elevation --- */
      if (trail.elevation?.length) {
        body.append(sectionTitle(t('trails.profile')));
        body.append(elevationChart(trail));
        body.append(listCard(
          kv(t('route.elevGain'), `${trail.ascent} ${t('common.m')}`),
          kv(t('route.elevLoss'), `${trail.descent} ${t('common.m')}`),
          kv(`${t('trails.length')} · ~`, formatDuration(hikingDuration(trail.length, trail.ascent, trail.difficulty), lang))));
      } else if (navigator.onLine) {
        const btn = el('button', { class: 'btn wide', style: { marginBottom: '10px' } },
          loadingElevation ? el('div', { class: 'spinner' }) : el('span', { html: icon('mountain'), style: { display: 'grid' } }),
          t('trails.profile'));
        btn.addEventListener('click', async () => {
          loadingElevation = true; app.sheet.refresh();
          try { trail = await withElevation(trail); }
          catch (err) { app.toast(err.message, { type: 'error' }); }
          finally { loadingElevation = false; app.sheet.refresh(); }
        });
        body.append(btn);
      }

      body.append(el('button', {
        class: 'btn primary wide',
        onClick: () => { haptic(12); app.followTrail(trail); },
      }, el('span', { html: icon('walk'), style: { display: 'grid' } }), t('trails.follow')));

      /* --- what you will see --- */
      pois = await trailPOIs(trail);
      if (pois.length) {
        body.append(sectionTitle(t('trails.viewpoints')));
        body.append(listCard(...pois.slice(0, 12).map((p) => el('div', { class: 'row' },
          el('div', { class: 'row-icon green', html: icon(p.kind === 'water' ? 'water' : 'mountain') }),
          el('div', { class: 'row-main' },
            el('div', { class: 'row-title', text: p.name || poiLabel(p.kind, lang) }),
            p.ele ? el('div', { class: 'row-sub', text: `${Math.round(p.ele)} ${t('common.m')}` }) : null)))));
        app.showTrailPOIs(pois);
      }
    },
    onLeave: () => { app.showTrailPOIs([]); },
  };
}

/** Elevation profile as a plain SVG — no chart library, no network. */
function elevationChart(trail) {
  const values = trail.elevation.filter((v) => Number.isFinite(v));
  if (values.length < 2) return el('div');
  const W = 320, H = 92, pad = 4;
  const min = Math.min(...values), max = Math.max(...values);
  const range = Math.max(1, max - min);

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (W - pad * 2);
    const y = H - pad - ((v - min) / range) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const area = `M${pad},${H - pad} L${points.join(' L')} L${W - pad},${H - pad} Z`;
  const line = `M${points.join(' L')}`;

  const svg = `<svg class="elev-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
    <defs><linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--green)" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="var(--green)" stop-opacity="0.04"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#elevFill)"/>
    <path d="${line}" fill="none" stroke="var(--green)" stroke-width="2" stroke-linejoin="round"/>
  </svg>`;

  return el('div', {},
    el('div', { html: svg }),
    el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-2)' } },
      el('span', { text: `${Math.round(min)} м` }),
      el('span', { text: `${Math.round(max)} м` })));
}

function poiLabel(kind, lang) {
  const map = {
    ru: { viewpoint: 'Видовая точка', peak: 'Вершина', water: 'Вода', shelter: 'Приют', cave: 'Пещера', rest: 'Место отдыха' },
    en: { viewpoint: 'Viewpoint', peak: 'Peak', water: 'Water', shelter: 'Shelter', cave: 'Cave', rest: 'Rest spot' },
  };
  return map[lang]?.[kind] ?? kind;
}
