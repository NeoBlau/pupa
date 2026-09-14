/* routepanel.js — destination preview, route alternatives and the Go button. */

import { el, formatDistance, formatDuration, formatClock, haptic } from '../lib/util.js';
import { t, getLang } from '../i18n/strings.js';
import { icon, maneuverSVG } from './icons.js';
import { sectionTitle, listCard, switchRow, emptyState } from './sheet.js';
import { phraseFor, maneuverIcon } from '../routing/maneuvers.js';
import { settings } from '../core/settings.js';
import { store } from '../core/store.js';
import { addFavorite } from '../features/search.js';

export function placePanel(app, place) {
  return {
    id: 'place',
    detent: 'half',
    render(body) {
      body.append(el('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '2px 0 14px' } },
        el('div', { class: 'row-icon brand', html: icon('pin'), style: { width: '44px', height: '44px' } }),
        el('div', { style: { flex: '1', minWidth: '0' } },
          el('div', { style: { fontSize: '22px', fontWeight: '700', letterSpacing: '-0.02em' }, text: place.name }),
          el('div', { class: 'row-sub', text: place.subtitle ?? '' }),
          place.distance != null
            ? el('div', { class: 'row-sub', text: `${formatDistance(place.distance, getLang())} ${getLang() === 'ru' ? 'отсюда' : 'away'}` })
            : null),
        el('button', {
          class: 'fab', style: { position: 'static' }, 'aria-label': t('search.favorites'),
          onClick: async (e) => {
            await addFavorite(place);
            e.currentTarget.innerHTML = icon('starFill');
            app.toast(getLang() === 'ru' ? 'Добавлено в избранное' : 'Saved to favourites', { type: 'success' });
          },
        }, el('span', { html: icon('star'), style: { display: 'grid' } }))));

      body.append(el('div', { style: { display: 'flex', gap: '8px', marginBottom: '14px' } },
        el('button', {
          class: 'btn primary', style: { flex: '1' },
          onClick: () => { haptic(12); app.buildRoute(place); },
        }, el('span', { html: icon('route'), style: { display: 'grid' } }),
           settings.get('profile') === 'foot' || settings.get('profile') === 'hike' ? t('route.goWalk') : t('route.go')),
        el('button', {
          class: 'btn', onClick: () => app.addWaypoint(place),
          'aria-label': t('route.addStop'),
        }, el('span', { html: icon('plus'), style: { display: 'grid' } })),
        el('button', {
          class: 'btn', onClick: () => app.reportCamera(place.coords),
          'aria-label': t('camera.report'), title: t('camera.report'),
        }, el('span', { html: icon('camera'), style: { display: 'grid' } }))));

      if (store.state.weather) body.append(weatherStrip(app));
    },
  };
}

export function routePanel(app) {
  return {
    id: 'route',
    detent: 'half',
    render(body) {
      const { routes, activeRouteIndex, routeSource } = store.state;

      if (!routes.length) {
        body.append(el('div', { class: 'row' },
          el('div', { class: 'spinner' }),
          el('div', { class: 'row-main' }, el('div', { class: 'row-title', text: t('route.building') }))));
        return;
      }

      /* --- destination header --- */
      const dest = store.state.destination;
      body.append(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', paddingBottom: '10px' } },
        el('div', { class: 'row-icon brand', html: icon('flag') }),
        el('div', { style: { flex: '1', minWidth: '0' } },
          el('div', { class: 'row-title', text: dest?.name ?? '—' }),
          el('div', { class: 'row-sub', text: dest?.subtitle ?? '' })),
        routeSource === 'offline'
          ? el('span', { class: 'badge-offline', text: t('common.offline') }) : null));

      /* --- alternatives --- */
      for (const [i, route] of routes.entries()) {
        body.append(routeCard(app, route, i, i === activeRouteIndex));
      }

      /* --- go --- */
      const active = routes[activeRouteIndex];
      body.append(el('button', {
        class: 'btn primary wide', style: { marginTop: '6px' },
        onClick: () => { haptic(15); app.startNavigation(); },
      }, el('span', { html: icon('play'), style: { display: 'grid' } }),
         settings.get('profile') === 'foot' || settings.get('profile') === 'hike' ? t('route.goWalk') : t('route.go')));

      /* --- actions --- */
      body.append(el('div', { class: 'btn-row', style: { marginTop: '8px' } },
        el('button', { class: 'btn small', onClick: () => app.showSteps() },
          el('span', { html: icon('stack'), style: { display: 'grid' } }), t('route.steps')),
        el('button', { class: 'btn small', onClick: () => app.saveRouteOffline() },
          el('span', { html: icon('download'), style: { display: 'grid' } }), t('route.saveOffline')),
        el('button', { class: 'btn small', onClick: () => app.shareRoute() },
          el('span', { html: icon('share'), style: { display: 'grid' } }))));

      /* --- weather along the route --- */
      if (store.state.weatherAlongRoute?.length) {
        body.append(sectionTitle(t('weather.alongRoute')));
        body.append(routeWeather(app, store.state.weatherAlongRoute, active));
      }

      /* --- preferences --- */
      body.append(sectionTitle(t('route.details')));
      const avoid = settings.get('avoid');
      body.append(listCard(
        switchRow(t('route.avoidTolls'), avoid.tolls, (v) => app.setAvoid('tolls', v)),
        switchRow(t('route.avoidUnpaved'), avoid.unpaved, (v) => app.setAvoid('unpaved', v)),
        switchRow(t('route.avoidFerries'), avoid.ferries, (v) => app.setAvoid('ferries', v)),
        switchRow(t('route.avoidHighways'), avoid.highways, (v) => app.setAvoid('highways', v))));
    },
  };
}

function routeCard(app, route, index, selected) {
  const lang = getLang();
  const arrival = new Date(Date.now() + route.duration * 1000);
  const attrs = route.attributes ?? {};
  const tags = [];
  if (attrs.toll > 50) tags.push({ cls: 'toll', text: `${t('route.tollsOnRoute')} ${formatDistance(attrs.toll, lang)}` });
  if (attrs.unpaved > 200) tags.push({ cls: 'unpaved', text: `${t('route.unpavedOnRoute')} ${formatDistance(attrs.unpaved, lang)}` });
  if (attrs.scenic > 500) tags.push({ cls: 'scenic', text: t('route.scenic') });
  if (route.source === 'offline') tags.push({ cls: 'offline', text: t('common.offline') });

  return el('button', {
    class: 'route-card', 'aria-selected': String(selected),
    onClick: () => { haptic(); app.selectRoute(index); },
  },
    el('div', { style: { flex: '1', minWidth: '0' } },
      el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px' } },
        el('span', { class: 'route-time', text: formatDuration(route.duration, lang) }),
        el('span', { class: 'route-dist', text: formatDistance(route.distance, lang) })),
      el('div', { class: 'row-sub', text: route.summaryText || route.label || '' }),
      tags.length
        ? el('div', { class: 'route-tags' }, ...tags.map((tg) => el('span', { class: `tag ${tg.cls}`, text: tg.text })))
        : null),
    el('div', { style: { textAlign: 'right', flex: 'none' } },
      el('div', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: t('route.arrive') }),
      el('div', { style: { fontWeight: '640', fontVariantNumeric: 'tabular-nums' }, text: formatClock(arrival, lang) })));
}

function routeWeather(app, points, route) {
  const host = el('div', { class: 'list-card' });
  for (const p of points) {
    const worst = (p.risks ?? []).reduce((a, b) => (b.level > (a?.level ?? -1) ? b : a), null);
    host.append(el('div', { class: 'wx-route-point' },
      el('div', { class: 'when', text: formatClock(p.at, getLang()) }),
      el('div', { class: 'ic', text: p.description?.icon ?? '—' }),
      el('div', { style: { flex: '1', minWidth: '0' } },
        el('div', { class: 'row-title', style: { fontSize: '15px' },
          text: p.slice?.temperature != null ? `${Math.round(p.slice.temperature)}°  ${p.description?.text ?? ''}` : '—' }),
        worst && worst.level > 0
          ? el('div', { class: 'row-sub', style: { color: worst.level >= 3 ? 'var(--red)' : 'var(--amber)' }, text: t(worst.key) })
          : null),
      el('div', { class: 'row-meta', text: formatDistance(p.distance, getLang()) })));
  }
  return host;
}

function weatherStrip(app) {
  const wx = store.state.weather;
  if (!wx?.current) return el('div');
  return el('button', {
    class: 'row', style: { marginTop: '4px' }, onClick: () => app.showWeather(),
  },
    el('div', { class: 'row-icon', style: { fontSize: '20px' }, text: wx.current.icon }),
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title', text: `${Math.round(wx.current.temperature)}°, ${wx.current.text}` }),
      el('div', { class: 'row-sub', text: wx.stale ? t('weather.stale') : t('weather.now') })),
    el('div', { class: 'row-meta', html: icon('chevron'), style: { width: '18px', color: 'var(--text-3)' } }));
}

/** Full turn-by-turn list — useful before you set off, and while a passenger reads. */
export function stepsPanel(app) {
  return {
    id: 'steps',
    detent: 'full',
    render(body) {
      const route = store.activeRoute;
      if (!route?.steps?.length) { body.append(emptyState(t('common.error'))); return; }

      body.append(el('button', {
        class: 'btn small', style: { marginBottom: '12px' }, onClick: () => app.sheet.pop(),
      }, '‹ ', t('common.close')));

      const lang = getLang();
      const host = el('div', { class: 'list-card' });
      for (const step of route.steps) {
        host.append(el('button', {
          class: 'row', onClick: () => app.focusStep(step),
        },
          el('div', { class: 'row-icon', html: maneuverSVG(maneuverIcon(step)) }),
          el('div', { class: 'row-main' },
            el('div', { class: 'row-title', text: phraseFor(step, lang) }),
            step.name ? el('div', { class: 'row-sub', text: step.name }) : null),
          el('div', { class: 'row-meta', text: step.distance > 0 ? formatDistance(step.distance, lang) : '' })));
      }
      body.append(host);
    },
  };
}
