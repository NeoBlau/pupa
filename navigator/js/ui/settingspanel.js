/* settingspanel.js — preferences, plus the small data tools that belong with them. */

import { el } from '../lib/util.js';
import { t, getLang } from '../i18n/strings.js';
import { icon } from './icons.js';
import { sectionTitle, listCard, switchRow, segmented, kv, emptyState } from './sheet.js';
import { settings } from '../core/settings.js';
import { listTracks, deleteTrack, downloadGPX } from '../features/tracks.js';
import { clearHistory } from '../features/search.js';

export function settingsPanel(app) {
  return {
    id: 'settings',
    detent: 'full',
    render(body) {
      const lang = getLang();

      body.append(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', paddingBottom: '8px' } },
        el('button', { class: 'btn small', onClick: () => app.sheet.pop() }, '‹'),
        el('div', { style: { fontSize: '20px', fontWeight: '700' }, text: t('settings.title') })));

      /* --- language --- */
      body.append(sectionTitle(t('settings.language')));
      body.append(segmented(
        [{ value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }],
        settings.get('lang'),
        (value) => { settings.set('lang', value); app.onLanguageChange(value); }));

      /* --- voice --- */
      body.append(sectionTitle(t('settings.voice')));
      body.append(segmented([
        { value: 'off', label: t('settings.voiceOff') },
        { value: 'alerts', label: t('settings.voiceAlerts') },
        { value: 'full', label: t('settings.voiceFull') },
      ], settings.get('voice'), (value) => { settings.set('voice', value); app.onVoiceChange(value); }));

      /* --- appearance --- */
      body.append(sectionTitle(t('settings.theme')));
      body.append(segmented([
        { value: 'auto', label: t('settings.theme.auto') },
        { value: 'light', label: t('settings.theme.light') },
        { value: 'dark', label: t('settings.theme.dark') },
      ], settings.get('theme'), (value) => { settings.set('theme', value); app.applyTheme(); }));

      body.append(listCard(
        switchRow(t('settings.autoNight'), settings.get('autoNight'),
          (v) => { settings.set('autoNight', v); app.applyTheme(); },
          lang === 'ru' ? 'Переключаться на тёмную карту после заката' : 'Switch to the dark map after sunset'),
        switchRow(t('settings.headUp'), settings.get('headUp'), (v) => settings.set('headUp', v)),
        switchRow(t('settings.keepAwake'), settings.get('keepAwake'),
          (v) => { settings.set('keepAwake', v); app.applyWakeLock(); }),
        switchRow(t('settings.hud'), settings.get('hudMode'),
          (v) => { settings.set('hudMode', v); document.body.classList.toggle('hud-mode', v); },
          lang === 'ru' ? 'Зеркальное отражение для проекции на лобовое стекло' : 'Mirrored for windscreen projection')));

      /* --- radar --- */
      body.append(sectionTitle(t('camera.title')));
      const types = settings.get('cameraAlertTypes');
      body.append(listCard(
        switchRow(t('settings.cameraAlerts'), settings.get('cameraAlerts'),
          (v) => { settings.set('cameraAlerts', v); app.onRadarChange(); }),
        switchRow(t('camera.speed'), types.speed, (v) => { settings.setIn('cameraAlertTypes', 'speed', v); app.onRadarChange(); }),
        switchRow(t('camera.redLight'), types.redLight, (v) => { settings.setIn('cameraAlertTypes', 'redLight', v); app.onRadarChange(); }),
        switchRow(t('camera.average'), types.average, (v) => { settings.setIn('cameraAlertTypes', 'average', v); app.onRadarChange(); }),
        switchRow(t('camera.bus'), types.bus, (v) => { settings.setIn('cameraAlertTypes', 'bus', v); app.onRadarChange(); }),
        switchRow(t('camera.parking'), types.parking, (v) => { settings.setIn('cameraAlertTypes', 'parking', v); app.onRadarChange(); })));

      /* --- speeding --- */
      body.append(sectionTitle(t('settings.speedWarn')));
      body.append(listCard(switchRow(t('settings.speedWarn'), settings.get('speedWarn'),
        (v) => settings.set('speedWarn', v))));
      const threshold = el('input', {
        type: 'range', min: '0', max: '30', step: '5', value: String(settings.get('speedWarnBy')),
        style: { width: '100%', accentColor: 'var(--brand)' },
        onInput: (e) => { label.textContent = `+${e.target.value} ${t('common.kmh')}`; },
        onChange: (e) => settings.set('speedWarnBy', Number(e.target.value)),
      });
      const label = el('span', { class: 'kv-value', text: `+${settings.get('speedWarnBy')} ${t('common.kmh')}` });
      body.append(el('div', { class: 'kv' }, el('span', { class: 'kv-label', text: t('settings.speedWarnBy') }), label));
      body.append(threshold);

      /* --- tracks --- */
      body.append(sectionTitle(t('track.list')));
      body.append(tracksList(app));

      /* --- data --- */
      body.append(sectionTitle(t('settings.data')));
      body.append(el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        el('button', {
          class: 'btn small', onClick: async () => { await clearHistory(); app.toast(t('common.done'), { type: 'success' }); },
        }, t('search.recent')),
        el('button', { class: 'btn small', onClick: () => app.importGPX() },
          el('span', { html: icon('download'), style: { display: 'grid' } }), 'GPX')));

      /* --- about --- */
      body.append(sectionTitle(t('settings.about')));
      body.append(el('div', { class: 'hint', html: `
        <b>${t('app.name')}</b> — ${t('app.tagline')}.<br>
        ${lang === 'ru' ? 'Карты и данные' : 'Maps and data'}: © OpenStreetMap contributors, CARTO, Esri, OpenTopoMap.<br>
        ${lang === 'ru' ? 'Маршруты' : 'Routing'}: OSRM + ${lang === 'ru' ? 'собственный офлайн-движок' : 'built-in offline engine'}.<br>
        ${lang === 'ru' ? 'Погода' : 'Weather'}: Open-Meteo. ${lang === 'ru' ? 'Осадки' : 'Precipitation'}: RainViewer.<br>
        ${lang === 'ru'
          ? 'Камеры берутся из OpenStreetMap и дополняются вашими отметками. Это вспомогательная информация, а не замена дорожным знакам.'
          : 'Cameras come from OpenStreetMap plus your own marks. Treat them as a hint, not a substitute for road signs.'}
      ` }));
    },
  };
}

function tracksList(app) {
  const host = el('div', { class: 'list-card' });
  listTracks().then((tracks) => {
    if (!tracks.length) { host.append(emptyState(t('track.empty'))); return; }
    for (const track of tracks.slice(0, 12)) {
      host.append(el('div', { class: 'row' },
        el('div', { class: 'row-icon', html: icon('record') }),
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title', text: track.name }),
          el('div', { class: 'row-sub', text: `${(track.distance / 1000).toFixed(1)} ${t('common.km')} · ${Math.round(track.duration / 60)} ${t('common.min')}` })),
        el('button', { class: 'btn small', onClick: () => downloadGPX(track) }, 'GPX'),
        el('button', {
          class: 'btn small',
          onClick: async () => { await deleteTrack(track.id); app.sheet.refresh(); },
        }, el('span', { html: icon('trash'), style: { display: 'grid', width: '16px', height: '16px' } }))));
    }
  });
  return host;
}
