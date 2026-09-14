/* searchpanel.js — the default panel: search field, quick destinations, recents. */

import { el, debounce, formatDistance, haptic } from '../lib/util.js';
import { t, getLang } from '../i18n/strings.js';
import { icon } from './icons.js';
import { sectionTitle, listCard, emptyState, segmented } from './sheet.js';
import { search, getHistory, getFavorites, nearbyOffline, kindLabel, formatCoords } from '../features/search.js';
import { settings } from '../core/settings.js';
import { store } from '../core/store.js';

const PROFILE_OPTIONS = () => [
  { value: 'car',  label: t('profile.car'),  icon: icon('car') },
  { value: 'bike', label: t('profile.bike'), icon: icon('bike') },
  { value: 'foot', label: t('profile.foot'), icon: icon('walk') },
  { value: 'hike', label: t('profile.hike'), icon: icon('trail') },
];

const QUICK_CATEGORIES = [
  { kinds: ['fuel'], ru: 'АЗС', en: 'Fuel', icon: '⛽' },
  { kinds: ['charging_station'], ru: 'Зарядка', en: 'Charging', icon: '🔌' },
  { kinds: ['parking'], ru: 'Парковка', en: 'Parking', icon: '🅿️' },
  { kinds: ['supermarket', 'convenience'], ru: 'Магазин', en: 'Shop', icon: '🛒' },
  { kinds: ['cafe', 'restaurant', 'fast_food'], ru: 'Поесть', en: 'Food', icon: '☕' },
  { kinds: ['pharmacy'], ru: 'Аптека', en: 'Pharmacy', icon: '💊' },
  { kinds: ['hotel', 'hostel'], ru: 'Ночлег', en: 'Stay', icon: '🛏️' },
  { kinds: ['toilets'], ru: 'Туалет', en: 'WC', icon: '🚻' },
];

export function searchPanel(app) {
  let query = '';
  let results = [];
  let busy = false;
  let activeCategory = null;

  const runSearch = debounce(async (value) => {
    if (!value.trim()) { results = []; busy = false; app.sheet.refresh(); return; }
    busy = true;
    app.sheet.refresh();
    await search(value, { near: store.coords, lang: getLang() }, (found, done) => {
      results = found;
      busy = !done;
      app.sheet.refresh();
    });
  }, 240);

  return {
    id: 'search',
    detent: 'peek',
    render(body) {
      /* --- search field --- */
      const input = el('input', {
        type: 'search', inputmode: 'search', autocomplete: 'off',
        placeholder: settings.get('profile') === 'foot' || settings.get('profile') === 'hike'
          ? t('search.placeholder.walk') : t('search.placeholder'),
        value: query,
        onInput: (e) => { query = e.target.value; activeCategory = null; runSearch(query); },
        onFocus: () => app.sheet.setDetent('full'),
      });

      const field = el('div', { class: 'search-field' },
        el('span', { html: icon('search'), style: { display: 'grid' } }),
        input,
        query ? el('button', {
          class: 'search-clear', 'aria-label': t('common.close'),
          onClick: () => { query = ''; results = []; activeCategory = null; app.sheet.refresh(); },
        }, el('span', { html: icon('close'), style: { width: '14px', height: '14px', display: 'grid' } })) : null);

      body.append(field);

      /* --- profile switcher --- */
      body.append(segmented(PROFILE_OPTIONS(), settings.get('profile'), (value) => {
        settings.set('profile', value);
        app.onProfileChange(value);
      }));

      if (query) {
        renderResults(body);
        queueMicrotask(() => input.focus({ preventScroll: true }));
        return;
      }

      renderQuickCategories(body);
      renderShortcuts(body);
      renderRecents(body);
    },
  };

  function renderResults(body) {
    if (busy && !results.length) {
      body.append(el('div', { class: 'row' },
        el('div', { class: 'spinner' }),
        el('div', { class: 'row-main' }, el('div', { class: 'row-title', text: t('search.searching') }))));
      return;
    }
    if (!results.length) {
      body.append(emptyState(t('search.nothing')));
      if (!store.state.online) body.append(el('div', { class: 'hint', text: t('search.offlineHint') }));
      return;
    }
    const card = listCard(...results.map((r) => resultRow(r)));
    body.append(card);
    if (busy) body.append(el('div', { class: 'hint', text: t('search.searching') }));
  }

  function resultRow(r) {
    return el('button', {
      class: 'row',
      onClick: () => { haptic(); app.selectPlace(r); },
    },
      el('div', { class: 'row-icon', html: icon(iconForKind(r.kind)) }),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title', text: r.name }),
        el('div', { class: 'row-sub', text: r.subtitle || kindLabel(r.kind, getLang()) || formatCoords(r.coords) })),
      el('div', { class: 'row-meta' },
        r.source === 'offline' ? el('div', { class: 'badge-offline', text: t('common.offline') }) : null,
        r.distance != null ? el('div', { text: formatDistance(r.distance, getLang()) }) : null));
  }

  function renderQuickCategories(body) {
    const chips = el('div', { class: 'chips' });
    for (const cat of QUICK_CATEGORIES) {
      const label = getLang() === 'ru' ? cat.ru : cat.en;
      chips.append(el('button', {
        class: 'chip', 'aria-pressed': String(activeCategory === label),
        onClick: async () => {
          haptic();
          if (activeCategory === label) { activeCategory = null; results = []; app.sheet.refresh(); return; }
          activeCategory = label;
          if (!store.coords) { app.toast(t('perm.locating')); return; }
          const found = await nearbyOffline(store.coords, cat.kinds, 12000);
          results = found.map((f) => ({ ...f, subtitle: f.subtitle || label }));
          query = '';
          app.sheet.setDetent('full');
          app.sheet.refresh();
          app.showResultsOnMap(results);
        },
      }, `${cat.icon} ${label}`));
    }
    body.append(chips);
    if (activeCategory && results.length) {
      body.append(sectionTitle(activeCategory), listCard(...results.map(resultRow)));
    } else if (activeCategory && !results.length) {
      body.append(emptyState(t('search.nothing')));
    }
  }

  function renderShortcuts(body) {
    const home = settings.get('homePoint');
    const work = settings.get('workPoint');
    const rows = [
      shortcutRow('home', t('search.home'), home, () => app.setHomeOrWork('homePoint')),
      shortcutRow('work', t('search.work'), work, () => app.setHomeOrWork('workPoint')),
    ];
    body.append(listCard(...rows));
  }

  function shortcutRow(iconName, label, point, onSet) {
    return el('button', {
      class: 'row',
      onClick: () => {
        haptic();
        if (point) app.selectPlace({ ...point, name: label });
        else onSet();
      },
    },
      el('div', { class: `row-icon ${iconName === 'home' ? 'green' : ''}`, html: icon(iconName) }),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title', text: label }),
        el('div', { class: 'row-sub', text: point?.subtitle ?? point?.name ?? (getLang() === 'ru' ? 'Не задано — нажмите, чтобы выбрать' : 'Not set — tap to choose') })),
      el('div', { class: 'row-meta', html: icon('chevron'), style: { width: '18px', color: 'var(--text-3)' } }));
  }

  async function renderRecents(body) {
    const [history, favorites] = await Promise.all([getHistory(6), getFavorites()]);
    if (favorites.length) {
      body.append(sectionTitle(t('search.favorites')),
        listCard(...favorites.slice(0, 6).map((f) => el('button', {
          class: 'row', onClick: () => { haptic(); app.selectPlace(f); },
        },
          el('div', { class: 'row-icon brand', html: icon('starFill') }),
          el('div', { class: 'row-main' },
            el('div', { class: 'row-title', text: f.label ?? f.name }),
            el('div', { class: 'row-sub', text: f.subtitle ?? '' }))))));
    }
    if (history.length) {
      body.append(sectionTitle(t('search.recent')),
        listCard(...history.map((h) => el('button', {
          class: 'row', onClick: () => { haptic(); app.selectPlace(h); },
        },
          el('div', { class: 'row-icon', html: icon('clock') }),
          el('div', { class: 'row-main' },
            el('div', { class: 'row-title', text: h.name }),
            el('div', { class: 'row-sub', text: h.subtitle ?? '' }))))));
    }
    if (!history.length && !favorites.length) {
      body.append(el('div', { class: 'hint', text: getLang() === 'ru'
        ? 'Найдите место или задержите палец на карте, чтобы поставить точку.'
        : 'Search for a place, or long-press the map to drop a pin.' }));
    }
  }
}

function iconForKind(kind) {
  if (['city', 'town', 'village', 'suburb', 'hamlet', 'neighbourhood'].includes(kind)) return 'pin';
  if (['fuel', 'charging_station'].includes(kind)) return 'car';
  if (['peak', 'viewpoint'].includes(kind)) return 'mountain';
  if (kind === 'station' || kind === 'aerodrome') return 'route';
  return 'pin';
}
