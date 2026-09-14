/* presets.js — ready-made offline packs for RU/CIS, bbox = [west, south, east, north]. */

export const PRESET_REGIONS = [
  { id: 'msk',      ru: 'Москва и МКАД',        en: 'Moscow',           bbox: [37.30, 55.55, 37.90, 55.95], zoom: 15 },
  { id: 'msk-obl',  ru: 'Московская область',   en: 'Moscow region',    bbox: [35.80, 54.25, 40.20, 56.95], zoom: 12 },
  { id: 'spb',      ru: 'Санкт-Петербург',      en: 'St Petersburg',    bbox: [29.95, 59.75, 30.65, 60.15], zoom: 15 },
  { id: 'kzn',      ru: 'Казань',               en: 'Kazan',            bbox: [48.90, 55.68, 49.32, 55.92], zoom: 15 },
  { id: 'ekb',      ru: 'Екатеринбург',         en: 'Yekaterinburg',    bbox: [60.40, 56.72, 60.83, 56.95], zoom: 15 },
  { id: 'nsk',      ru: 'Новосибирск',          en: 'Novosibirsk',      bbox: [82.70, 54.88, 83.12, 55.15], zoom: 15 },
  { id: 'nng',      ru: 'Нижний Новгород',      en: 'Nizhny Novgorod',  bbox: [43.75, 56.20, 44.15, 56.40], zoom: 15 },
  { id: 'sochi',    ru: 'Сочи и Красная Поляна', en: 'Sochi & Krasnaya Polyana', bbox: [39.55, 43.35, 40.35, 43.75], zoom: 14 },
  { id: 'krd',      ru: 'Краснодар',            en: 'Krasnodar',        bbox: [38.85, 44.95, 39.20, 45.15], zoom: 15 },
  { id: 'kld',      ru: 'Калининград',          en: 'Kaliningrad',      bbox: [20.30, 54.62, 20.68, 54.80], zoom: 15 },
  { id: 'vvo',      ru: 'Владивосток',          en: 'Vladivostok',      bbox: [131.80, 43.05, 132.05, 43.25], zoom: 15 },
  { id: 'm11',      ru: 'Трасса М-11 Нева',     en: 'M-11 highway',     bbox: [30.20, 55.60, 37.80, 60.05], zoom: 11, corridor: true },
  { id: 'm4',       ru: 'Трасса М-4 Дон',       en: 'M-4 Don highway',  bbox: [37.00, 44.50, 40.20, 55.80], zoom: 11, corridor: true },
  { id: 'minsk',    ru: 'Минск',                en: 'Minsk',            bbox: [27.36, 53.80, 27.80, 54.02], zoom: 15 },
  { id: 'almaty',   ru: 'Алматы',               en: 'Almaty',           bbox: [76.75, 43.15, 77.05, 43.35], zoom: 15 },
  { id: 'tbilisi',  ru: 'Тбилиси',              en: 'Tbilisi',          bbox: [44.68, 41.63, 44.92, 41.80], zoom: 15 },
  { id: 'yerevan',  ru: 'Ереван',               en: 'Yerevan',          bbox: [44.40, 40.10, 44.62, 40.25], zoom: 15 },
  { id: 'tashkent', ru: 'Ташкент',              en: 'Tashkent',         bbox: [69.13, 41.22, 69.42, 41.38], zoom: 15 },
  { id: 'bishkek',  ru: 'Бишкек',               en: 'Bishkek',          bbox: [74.48, 42.78, 74.72, 42.92], zoom: 15 },
  { id: 'baku',     ru: 'Баку',                 en: 'Baku',             bbox: [49.75, 40.30, 50.02, 40.45], zoom: 15 },
];

/** Scenic hiking areas worth a curated entry point. */
export const TRAIL_AREAS = [
  { id: 'kr-polyana', ru: 'Красная Поляна',      en: 'Krasnaya Polyana',  center: [40.20, 43.68], radius: 15000 },
  { id: 'elbrus',     ru: 'Приэльбрусье',        en: 'Elbrus area',       center: [42.47, 43.30], radius: 20000 },
  { id: 'baikal',     ru: 'Большая Байкальская тропа', en: 'Great Baikal Trail', center: [104.90, 51.87], radius: 30000 },
  { id: 'lena',       ru: 'Ленские столбы',      en: 'Lena Pillars',      center: [127.00, 61.10], radius: 25000 },
  { id: 'karelia',    ru: 'Карелия, Рускеала',   en: 'Karelia, Ruskeala', center: [30.58, 61.95], radius: 20000 },
  { id: 'altai',      ru: 'Горный Алтай',        en: 'Altai mountains',   center: [86.20, 50.30], radius: 40000 },
  { id: 'ural',       ru: 'Таганай, Урал',       en: 'Taganay, Urals',    center: [59.80, 55.25], radius: 20000 },
  { id: 'crimea',     ru: 'Крым, Ай-Петри',      en: 'Crimea, Ai-Petri',  center: [34.05, 44.45], radius: 20000 },
  { id: 'kamchatka',  ru: 'Камчатка, Налычево',  en: 'Kamchatka, Nalychevo', center: [159.10, 53.35], radius: 30000 },
  { id: 'kavkaz',     ru: 'Домбай',              en: 'Dombay',            center: [41.63, 43.29], radius: 15000 },
];
