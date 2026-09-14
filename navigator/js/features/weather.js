/* weather.js — Open-Meteo forecasts, cached for offline use, plus the part that
   actually matters while driving: what the weather does to the road ahead. */

import { fetchJSON } from '../lib/util.js';
import { kv } from '../lib/idb.js';
import { cumulative, pointAlong } from '../lib/geo.js';

const API = 'https://api.open-meteo.com/v1/forecast';
const CACHE_TTL = 45 * 60 * 1000;
const CACHE_KEY = (lon, lat) => `weather:${lon.toFixed(2)}:${lat.toFixed(2)}`;

const CURRENT = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'is_day',
  'precipitation', 'rain', 'snowfall', 'weather_code', 'cloud_cover', 'surface_pressure',
  'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'];
const HOURLY = ['temperature_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation',
  'rain', 'snowfall', 'weather_code', 'visibility', 'wind_speed_10m', 'wind_gusts_10m',
  'wind_direction_10m', 'cloud_cover', 'is_day', 'freezing_level_height', 'dew_point_2m'];
const DAILY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'sunrise', 'sunset',
  'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'uv_index_max'];

/**
 * Forecast for a point. Falls back to the cached copy when offline, and marks it
 * `stale` so the UI can say so instead of quietly showing yesterday's weather.
 */
export async function getWeather(coords, { force = false, signal } = {}) {
  const key = CACHE_KEY(coords[0], coords[1]);
  const cached = await kv.get(key);
  const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL;
  if (cached && fresh && !force) return { ...cached, stale: false };

  if (!navigator.onLine) {
    return cached ? { ...cached, stale: true } : null;
  }

  try {
    const params = new URLSearchParams({
      latitude: coords[1].toFixed(4), longitude: coords[0].toFixed(4),
      current: CURRENT.join(','), hourly: HOURLY.join(','), daily: DAILY.join(','),
      timezone: 'auto', forecast_days: '7', past_hours: '1',
    });
    const data = await fetchJSON(`${API}?${params}`, { retries: 1, timeout: 10000, signal });
    const payload = { coords, data, fetchedAt: Date.now() };
    await kv.set(key, payload);
    return { ...payload, stale: false };
  } catch (err) {
    if (cached) return { ...cached, stale: true, error: err.message };
    throw err;
  }
}

/* ---------- WMO weather codes ---------- */

const WMO = {
  0:  { ru: 'Ясно', en: 'Clear', icon: '☀️', night: '🌙' },
  1:  { ru: 'В основном ясно', en: 'Mainly clear', icon: '🌤️', night: '🌙' },
  2:  { ru: 'Переменная облачность', en: 'Partly cloudy', icon: '⛅', night: '☁️' },
  3:  { ru: 'Пасмурно', en: 'Overcast', icon: '☁️' },
  45: { ru: 'Туман', en: 'Fog', icon: '🌫️' },
  48: { ru: 'Изморозь', en: 'Rime fog', icon: '🌫️' },
  51: { ru: 'Морось', en: 'Light drizzle', icon: '🌦️' },
  53: { ru: 'Морось', en: 'Drizzle', icon: '🌦️' },
  55: { ru: 'Сильная морось', en: 'Dense drizzle', icon: '🌧️' },
  56: { ru: 'Ледяная морось', en: 'Freezing drizzle', icon: '🌧️' },
  57: { ru: 'Ледяная морось', en: 'Freezing drizzle', icon: '🌧️' },
  61: { ru: 'Небольшой дождь', en: 'Light rain', icon: '🌦️' },
  63: { ru: 'Дождь', en: 'Rain', icon: '🌧️' },
  65: { ru: 'Сильный дождь', en: 'Heavy rain', icon: '🌧️' },
  66: { ru: 'Ледяной дождь', en: 'Freezing rain', icon: '🌧️' },
  67: { ru: 'Ледяной дождь', en: 'Freezing rain', icon: '🌧️' },
  71: { ru: 'Небольшой снег', en: 'Light snow', icon: '🌨️' },
  73: { ru: 'Снег', en: 'Snow', icon: '❄️' },
  75: { ru: 'Сильный снегопад', en: 'Heavy snow', icon: '❄️' },
  77: { ru: 'Снежная крупа', en: 'Snow grains', icon: '🌨️' },
  80: { ru: 'Ливень', en: 'Rain showers', icon: '🌦️' },
  81: { ru: 'Ливень', en: 'Rain showers', icon: '🌧️' },
  82: { ru: 'Сильный ливень', en: 'Violent showers', icon: '⛈️' },
  85: { ru: 'Снежный заряд', en: 'Snow showers', icon: '🌨️' },
  86: { ru: 'Сильный снегопад', en: 'Heavy snow showers', icon: '❄️' },
  95: { ru: 'Гроза', en: 'Thunderstorm', icon: '⛈️' },
  96: { ru: 'Гроза с градом', en: 'Thunderstorm, hail', icon: '⛈️' },
  99: { ru: 'Гроза с градом', en: 'Thunderstorm, hail', icon: '⛈️' },
};

export function describeCode(code, lang = 'ru', isDay = true) {
  const w = WMO[code] ?? WMO[3];
  return { text: w[lang] ?? w.ru, icon: (!isDay && w.night) ? w.night : w.icon };
}

/* ---------- road risk ---------- */

/**
 * Turn a forecast slice into driving advice.
 * Ice is the one that kills people, so it is checked first and wins ties.
 */
export function roadRisk({ temperature, dewPoint, precipitation, snowfall, weatherCode,
                           visibility, windGusts, humidity }, lang = 'ru') {
  const risks = [];
  const near = (t, a, b) => t >= a && t <= b;

  const freezingRain = [56, 57, 66, 67].includes(weatherCode);
  const icyTemp = temperature != null && temperature <= 1;
  const wetOrRecentlyWet = (precipitation ?? 0) > 0 || (humidity ?? 0) > 88;

  if (freezingRain || (icyTemp && wetOrRecentlyWet)) {
    risks.push({ level: 3, key: 'weather.risk.ice' });
  } else if (temperature != null && near(temperature, -1, 4) && (humidity ?? 0) > 85) {
    // the classic black-ice window: just above zero, damp, often a bridge deck
    risks.push({ level: 2, key: 'weather.risk.ice' });
  }

  if ((snowfall ?? 0) > 0.3 || [71, 73, 75, 77, 85, 86].includes(weatherCode)) {
    risks.push({ level: (snowfall ?? 0) > 1.5 ? 3 : 2, key: 'weather.risk.snow' });
  }
  if ((precipitation ?? 0) > 4 || [65, 82, 95, 96, 99].includes(weatherCode)) {
    risks.push({ level: 2, key: 'weather.risk.rain' });
  }
  if ((visibility != null && visibility < 400) || [45, 48].includes(weatherCode)) {
    risks.push({ level: visibility != null && visibility < 200 ? 3 : 2, key: 'weather.risk.fog' });
  }
  if ((windGusts ?? 0) > 17) {
    risks.push({ level: (windGusts ?? 0) > 25 ? 3 : 1, key: 'weather.risk.wind' });
  }
  if ((temperature ?? 0) > 33) risks.push({ level: 1, key: 'weather.risk.heat' });

  risks.sort((a, b) => b.level - a.level);
  return risks.length ? risks : [{ level: 0, key: 'weather.risk.none' }];
}

/** Pull the hourly values for a given time into the shape roadRisk wants. */
export function hourlySlice(data, when = new Date()) {
  const hourly = data?.hourly;
  if (!hourly?.time?.length) return null;
  const target = when.getTime();
  let bestIdx = 0, bestDiff = Infinity;
  for (let i = 0; i < hourly.time.length; i++) {
    const diff = Math.abs(new Date(hourly.time[i]).getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  }
  const at = (k) => hourly[k]?.[bestIdx] ?? null;
  return {
    index: bestIdx,
    time: new Date(hourly.time[bestIdx]),
    temperature: at('temperature_2m'),
    apparent: at('apparent_temperature'),
    dewPoint: at('dew_point_2m'),
    precipitation: at('precipitation'),
    precipitationProbability: at('precipitation_probability'),
    snowfall: at('snowfall'),
    weatherCode: at('weather_code'),
    visibility: at('visibility'),
    windSpeed: at('wind_speed_10m'),
    windGusts: at('wind_gusts_10m'),
    windDirection: at('wind_direction_10m'),
    cloudCover: at('cloud_cover'),
    humidity: null,
    isDay: at('is_day') === 1,
  };
}

/**
 * Weather at several points along a route, each sampled at the time you will
 * actually be there. This is the bit Google and Apple both leave out.
 */
export async function weatherAlongRoute(coordinates, durationSeconds, { samples = 5, signal, lang = 'ru' } = {}) {
  if (!coordinates?.length) return [];
  const cum = cumulative(coordinates);
  const total = cum[cum.length - 1];
  const now = Date.now();

  const points = [];
  for (let i = 0; i < samples; i++) {
    const frac = samples === 1 ? 0 : i / (samples - 1);
    points.push({
      coords: pointAlong(coordinates, total * frac, cum),
      at: new Date(now + durationSeconds * 1000 * frac),
      fraction: frac,
      distance: total * frac,
    });
  }

  const results = [];
  for (const p of points) {
    try {
      const wx = await getWeather(p.coords, { signal });
      if (!wx) { results.push({ ...p, weather: null }); continue; }
      const slice = hourlySlice(wx.data, p.at);
      results.push({
        ...p,
        stale: wx.stale,
        slice,
        risks: slice ? roadRisk(slice, lang) : [],
        description: slice ? describeCode(slice.weatherCode, lang, slice.isDay) : null,
      });
    } catch {
      results.push({ ...p, weather: null });
    }
  }
  return results;
}

/** The single worst thing waiting on this route. */
export function worstRisk(alongRoute) {
  let worst = null;
  for (const point of alongRoute) {
    for (const risk of point.risks ?? []) {
      if (!worst || risk.level > worst.risk.level) worst = { risk, point };
    }
  }
  return worst && worst.risk.level > 0 ? worst : null;
}

/* ---------- precipitation radar tiles (RainViewer, key-free) ---------- */

export async function rainRadarFrames({ signal } = {}) {
  const data = await fetchJSON('https://api.rainviewer.com/public/weather-maps.json',
    { retries: 1, timeout: 8000, signal });
  const past = data.radar?.past ?? [];
  const nowcast = data.radar?.nowcast ?? [];
  return {
    host: data.host ?? 'https://tilecache.rainviewer.com',
    frames: [...past, ...nowcast].map((f) => ({ time: f.time, path: f.path })),
    latestIndex: Math.max(0, past.length - 1),
  };
}

export const rainTileTemplate = (host, path) => `${host}${path}/256/{z}/{x}/{y}/4/1_1.png`;

export function windLabel(speedKmh, direction, lang = 'ru') {
  const dirs = lang === 'ru'
    ? ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ']
    : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(((direction ?? 0) % 360) / 45) % 8;
  return `${dirs[idx]} ${Math.round((speedKmh ?? 0))} ${lang === 'ru' ? 'км/ч' : 'km/h'}`;
}
