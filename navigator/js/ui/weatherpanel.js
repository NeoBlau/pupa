/* weatherpanel.js — current conditions, the week, and what the road will be like. */

import { el, formatClock, formatDistance } from '../lib/util.js';
import { t, getLang } from '../i18n/strings.js';
import { icon } from './icons.js';
import { sectionTitle, listCard, emptyState, kv } from './sheet.js';
import { describeCode, roadRisk, hourlySlice, windLabel } from '../features/weather.js';
import { store } from '../core/store.js';

export function weatherPanel(app) {
  return {
    id: 'weather',
    detent: 'full',
    render(body) {
      const wx = store.state.weatherRaw;
      body.append(header(app));

      if (!wx?.data) { body.append(emptyState(t('common.loading'))); return; }
      const d = wx.data;
      const c = d.current ?? {};
      const lang = getLang();
      const desc = describeCode(c.weather_code, lang, c.is_day === 1);

      if (wx.stale) body.append(el('div', { class: 'risk l1' },
        el('span', { html: icon('offline'), style: { display: 'grid' } }),
        t('weather.offline')));

      /* --- now --- */
      body.append(el('div', { class: 'wx-now' },
        el('div', { class: 'wx-icon', text: desc.icon }),
        el('div', {},
          el('div', { class: 'wx-temp', text: `${Math.round(c.temperature_2m ?? 0)}°` }),
          el('div', { class: 'wx-desc', text: desc.text }),
          el('div', { class: 'wx-desc', text: `${t('weather.feels')} ${Math.round(c.apparent_temperature ?? 0)}°` }))));

      /* --- road risk right at the top: it is the reason a driver opens this --- */
      const slice = hourlySlice(d, new Date());
      const risks = roadRisk({ ...slice, humidity: c.relative_humidity_2m }, lang);
      body.append(sectionTitle(t('weather.roadRisk')));
      for (const risk of risks.slice(0, 3)) {
        body.append(el('div', { class: `risk l${risk.level}` },
          el('span', { html: icon(risk.level > 0 ? 'alert' : 'eye'), style: { display: 'grid' } }),
          t(risk.key)));
      }

      /* --- tiles --- */
      body.append(el('div', { class: 'wx-grid' },
        tile(t('weather.wind'), windLabel(c.wind_speed_10m, c.wind_direction_10m, lang),
          c.wind_gusts_10m ? `${t('weather.gusts')} ${Math.round(c.wind_gusts_10m)}` : null),
        tile(t('weather.humidity'), `${Math.round(c.relative_humidity_2m ?? 0)}%`),
        tile(t('weather.visibility'), slice?.visibility != null
          ? formatDistance(slice.visibility, lang) : '—'),
        tile(t('weather.pressure'), `${Math.round((c.surface_pressure ?? 0) * 0.7500616)} ${lang === 'ru' ? 'мм' : 'mmHg'}`)));

      /* --- hourly --- */
      body.append(sectionTitle(t('weather.hourly')));
      body.append(hourlyStrip(d, lang));

      /* --- daily --- */
      body.append(sectionTitle(t('weather.daily')));
      body.append(dailyList(d, lang));

      /* --- radar layer --- */
      body.append(el('button', {
        class: 'btn wide', style: { marginTop: '14px' },
        onClick: () => app.toggleRainLayer(),
      }, el('span', { html: icon('water'), style: { display: 'grid' } }),
         store.state.rainLayerOn ? `${t('map.weatherLayer')}: ${t('common.done')}` : t('map.weatherLayer')));

      const sunrise = d.daily?.sunrise?.[0], sunset = d.daily?.sunset?.[0];
      if (sunrise && sunset) {
        body.append(listCard(
          kv(t('weather.sunrise'), formatClock(new Date(sunrise), lang)),
          kv(t('weather.sunset'), formatClock(new Date(sunset), lang))));
      }
      body.append(el('div', { class: 'hint', text: 'Open-Meteo · RainViewer' }));
    },
  };

  function header(a) {
    return el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', paddingBottom: '6px' } },
      el('button', { class: 'btn small', onClick: () => a.sheet.pop() }, '‹'),
      el('div', { style: { fontSize: '20px', fontWeight: '700' }, text: t('weather.title') }),
      el('div', { style: { flex: '1' } }),
      el('button', { class: 'btn small', onClick: () => a.refreshWeather(true) },
        el('span', { html: icon('refresh'), style: { display: 'grid' } })));
  }
}

const tile = (label, value, sub) =>
  el('div', { class: 'wx-tile' },
    el('span', { text: label }),
    el('b', { text: value }),
    sub ? el('span', { text: sub }) : null);

function hourlyStrip(d, lang) {
  const host = el('div', { class: 'wx-hours' });
  const hourly = d.hourly;
  if (!hourly?.time) return host;
  const now = Date.now();
  let start = hourly.time.findIndex((tm) => new Date(tm).getTime() >= now - 3600e3);
  if (start < 0) start = 0;

  for (let i = start; i < Math.min(start + 24, hourly.time.length); i++) {
    const when = new Date(hourly.time[i]);
    const desc = describeCode(hourly.weather_code?.[i], lang, hourly.is_day?.[i] === 1);
    const prob = hourly.precipitation_probability?.[i] ?? 0;
    host.append(el('div', { class: 'wx-hour' },
      el('div', { class: 'h', text: i === start ? t('common.now') : formatClock(when, lang) }),
      el('div', { class: 'i', text: desc.icon }),
      el('div', { class: 't', text: `${Math.round(hourly.temperature_2m?.[i] ?? 0)}°` }),
      el('div', { class: 'p', text: prob > 15 ? `${prob}%` : '' })));
  }
  return host;
}

function dailyList(d, lang) {
  const host = el('div', { class: 'list-card' });
  const daily = d.daily;
  if (!daily?.time) return host;
  const fmt = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', { weekday: 'short' });
  const lows = daily.temperature_2m_min ?? [];
  const highs = daily.temperature_2m_max ?? [];
  const globalMin = Math.min(...lows), globalMax = Math.max(...highs);

  for (let i = 0; i < daily.time.length; i++) {
    const desc = describeCode(daily.weather_code?.[i], lang, true);
    const left = ((lows[i] - globalMin) / Math.max(1, globalMax - globalMin)) * 100;
    const width = ((highs[i] - lows[i]) / Math.max(1, globalMax - globalMin)) * 100;
    host.append(el('div', { class: 'kv' },
      el('span', { class: 'kv-label', style: { width: '62px', flex: 'none', fontSize: '14px', textTransform: 'capitalize' },
        text: i === 0 ? (lang === 'ru' ? 'Сегодня' : 'Today') : fmt.format(new Date(daily.time[i])) }),
      el('span', { style: { fontSize: '20px', width: '30px', flex: 'none', textAlign: 'center' }, text: desc.icon }),
      el('span', { class: 'kv-value', style: { width: '36px', flex: 'none', color: 'var(--text-2)' }, text: `${Math.round(lows[i])}°` }),
      el('span', { style: { flex: '1', height: '5px', borderRadius: '3px', background: 'var(--fill-strong)', position: 'relative', margin: '0 8px' } },
        el('i', { style: { position: 'absolute', left: `${left}%`, width: `${Math.max(8, width)}%`, height: '100%',
          borderRadius: '3px', background: 'linear-gradient(90deg, var(--accent), var(--amber))' } })),
      el('span', { class: 'kv-value', style: { width: '36px', flex: 'none' }, text: `${Math.round(highs[i])}°` })));
  }
  return host;
}
