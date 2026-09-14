/* offlinepanel.js — downloading, inspecting and deleting offline packs. */

import { el, formatBytes, haptic } from '../lib/util.js';
import { t, getLang } from '../i18n/strings.js';
import { icon } from './icons.js';
import { sectionTitle, listCard, emptyState, kv } from './sheet.js';
import { listRegions, deleteRegion, MAX_AREA_KM2 } from '../offline/regions.js';
import { estimatePack, DETAIL, clearTileCache } from '../offline/tiles.js';
import { storageEstimate, requestPersistence } from '../lib/idb.js';
import { bboxAreaKm2 } from '../lib/geo.js';
import { PRESET_REGIONS } from '../data/presets.js';
import { store } from '../core/store.js';

export function offlinePanel(app) {
  let regions = [];
  let storage = { usage: 0, quota: 0 };
  let persisted = false;
  let detail = 'city';
  let loaded = false;

  async function refresh() {
    [regions, storage] = await Promise.all([listRegions(), storageEstimate()]);
    loaded = true;
    app.sheet.refresh();
  }

  return {
    id: 'offline',
    detent: 'full',
    onLeave: () => app.showRegionBox(null),
    render(body) {
      if (!loaded) refresh();

      body.append(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', paddingBottom: '8px' } },
        el('button', { class: 'btn small', onClick: () => { app.showRegionBox(null); app.sheet.pop(); } }, '‹'),
        el('div', { style: { fontSize: '20px', fontWeight: '700' }, text: t('offline.title') })));

      /* --- in-flight download --- */
      const job = store.state.downloading;
      if (job) {
        body.append(downloadProgress(app, job));
      } else {
        body.append(downloadForm(app, detail, (value) => { detail = value; app.sheet.refresh(); }, refresh));
      }

      /* --- what is already here --- */
      body.append(sectionTitle(t('offline.regions')));
      if (!regions.length) {
        body.append(emptyState(getLang() === 'ru'
          ? 'Пока ничего не скачано. Область на карте — и можно ехать без сети.'
          : 'Nothing downloaded yet. Pick an area and you can drive with no network.'));
      } else {
        for (const region of regions) body.append(regionCard(app, region, refresh));
      }

      /* --- presets --- */
      body.append(sectionTitle(t('offline.presets')));
      body.append(listCard(...PRESET_REGIONS.map((preset) => {
        const estimate = estimatePack(preset.bbox, preset.corridor ? 'route' : 'city');
        return el('button', {
          class: 'row',
          onClick: () => { haptic(); app.previewRegion(preset); },
        },
          el('div', { class: 'row-icon', html: icon('download') }),
          el('div', { class: 'row-main' },
            el('div', { class: 'row-title', text: getLang() === 'ru' ? preset.ru : preset.en }),
            el('div', { class: 'row-sub', text: `${Math.round(bboxAreaKm2(preset.bbox))} км² · ≈${formatBytes(estimate.bytes, getLang())}` })),
          el('div', { class: 'row-meta', html: icon('chevron'), style: { width: '18px', color: 'var(--text-3)' } }));
      })));

      /* --- storage --- */
      body.append(sectionTitle(t('settings.data')));
      const used = storage.usage, quota = storage.quota || 1;
      body.append(el('div', { class: 'storage-bar' },
        el('i', { class: 'tiles', style: { width: `${Math.min(100, (used / quota) * 100)}%` } })));
      body.append(listCard(
        kv(t('offline.used'), formatBytes(used, getLang())),
        kv(t('offline.free'), formatBytes(Math.max(0, quota - used), getLang())),
        kv(getLang() === 'ru' ? 'Защита данных' : 'Data protection',
          persisted ? t('offline.persisted') : t('offline.notPersisted'))));

      body.append(el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
        el('button', {
          class: 'btn small', style: { flex: '1' },
          onClick: async () => {
            persisted = await requestPersistence();
            app.toast(persisted ? t('offline.persisted') : t('offline.notPersisted'));
            app.sheet.refresh();
          },
        }, getLang() === 'ru' ? 'Защитить' : 'Protect'),
        el('button', {
          class: 'btn small', style: { flex: '1' },
          onClick: async () => {
            await clearTileCache();
            app.toast(t('settings.clearCache'), { type: 'success' });
            refresh();
          },
        }, t('settings.clearCache'))));
    },
  };
}

function downloadForm(app, detail, setDetail, onDone) {
  const bbox = app.currentViewBBox();
  const area = bbox ? bboxAreaKm2(bbox) : 0;
  const estimate = bbox ? estimatePack(bbox, detail) : { bytes: 0, tiles: 0 };
  const tooBig = area > (MAX_AREA_KM2[detail] ?? 3500);
  const lang = getLang();

  app.showRegionBox(bbox);

  const detailPicker = el('div', { class: 'chips' },
    ...Object.entries(DETAIL).map(([key, def]) => el('button', {
      class: 'chip', 'aria-pressed': String(key === detail),
      onClick: () => setDetail(key),
    }, t(def.label))));

  return el('div', { class: 'region-card' },
    el('div', { class: 'region-head' },
      el('div', { class: 'row-icon brand', html: icon('download') }),
      el('div', { style: { flex: '1' } },
        el('div', { class: 'region-name', text: t('offline.currentView') }),
        el('div', { class: 'row-sub', text: `${Math.round(area)} км² · ≈${formatBytes(estimate.bytes, lang)} · ${estimate.tiles} ${lang === 'ru' ? 'тайлов' : 'tiles'}` }))),
    detailPicker,
    el('div', { class: 'hint', text: `${t('offline.includes')}: ${t('offline.incTiles')}, ${t('offline.incRoads')}, ${t('offline.incCameras')}, ${t('offline.incTrails')}, ${t('offline.incPois')}` }),
    tooBig
      ? el('div', { class: 'risk l2' }, el('span', { html: icon('alert'), style: { display: 'grid' } }), t('offline.tooBig'))
      : el('button', {
          class: 'btn primary wide',
          onClick: () => { haptic(12); app.downloadCurrentView(detail, onDone); },
        }, el('span', { html: icon('download'), style: { display: 'grid' } }), t('offline.download')));
}

const PHASE_LABEL = {
  roads: 'offline.incRoads', cameras: 'offline.incCameras', trails: 'offline.incTrails',
  scenic: 'trails.viewpoints', places: 'offline.incPois', tiles: 'offline.incTiles', done: 'offline.done',
};

function downloadProgress(app, job) {
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
  return el('div', { class: 'region-card' },
    el('div', { class: 'region-head' },
      el('div', { class: 'spinner' }),
      el('div', { style: { flex: '1' } },
        el('div', { class: 'region-name', text: `${t('offline.downloading')}: ${job.name ?? ''}` }),
        el('div', { class: 'row-sub', text: `${t(PHASE_LABEL[job.phase] ?? 'common.loading')} · ${job.done}/${job.total || '…'}` }))),
    el('div', { class: 'progress brand' }, el('i', { style: { width: `${pct}%` } })),
    el('button', { class: 'btn small wide', onClick: () => app.cancelDownload() }, t('offline.cancel')));
}

function regionCard(app, region, onChange) {
  const lang = getLang();
  const counts = region.counts ?? {};
  return el('div', { class: 'region-card' },
    el('div', { class: 'region-head' },
      el('div', { class: `row-icon ${region.status === 'ready' ? 'green' : ''}`,
        html: icon(region.status === 'ready' ? 'offline' : 'alert') }),
      el('div', { style: { flex: '1', minWidth: '0' } },
        el('div', { class: 'region-name', text: region.name }),
        el('div', { class: 'row-sub', text: region.status === 'ready'
          ? t('offline.ready')
          : `${t('offline.failed')}${region.error ? `: ${region.error}` : ''}` })),
      el('button', {
        class: 'fab', style: { position: 'static', width: '38px', height: '38px' },
        'aria-label': t('offline.delete'),
        onClick: async () => {
          if (!confirm(t('offline.deleteConfirm'))) return;
          await deleteRegion(region.id);
          app.toast(t('offline.delete'), { type: 'success' });
          onChange();
        },
      }, el('span', { html: icon('trash'), style: { display: 'grid', width: '18px', height: '18px' } }))),
    el('div', { class: 'region-stats' },
      counts.edges ? el('span', {}, `${t('offline.incRoads')} `, el('b', { text: String(counts.edges) })) : null,
      counts.cameras != null ? el('span', {}, `${t('offline.incCameras')} `, el('b', { text: String(counts.cameras) })) : null,
      counts.trails != null ? el('span', {}, `${t('offline.incTrails')} `, el('b', { text: String(counts.trails) })) : null,
      counts.places != null ? el('span', {}, `${t('offline.incPois')} `, el('b', { text: String(counts.places) })) : null,
      counts.tiles != null ? el('span', {}, `${t('offline.incTiles')} `, el('b', { text: String(counts.tiles) })) : null),
    el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
      el('button', { class: 'btn small', style: { flex: '1' }, onClick: () => app.zoomToRegion(region) },
        getLang() === 'ru' ? 'Показать' : 'Show'),
      el('button', { class: 'btn small', style: { flex: '1' }, onClick: () => app.updateRegion(region, onChange) },
        t('offline.update'))));
}
