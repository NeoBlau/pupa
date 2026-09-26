export type Lang = "ru" | "en";

const dict = {
  title: { ru: "Океан: научный симулятор", en: "Ocean: a scientific simulator" },
  modeDive: { ru: "Батискаф", en: "Submersible" },
  modeMap: { ru: "Карта", en: "Map" },
  modeLab: { ru: "Лаборатория", en: "Laboratory" },
  pause: { ru: "Пауза", en: "Pause" },
  resume: { ru: "Пуск", en: "Run" },
  timeWarp: { ru: "Ускорение", en: "Time warp" },
  depth: { ru: "Глубина", en: "Depth" },
  pressure: { ru: "Давление", en: "Pressure" },
  insituT: { ru: "In-situ температура t", en: "In-situ temperature t" },
  CT: { ru: "Консервативная температура Θ", en: "Conservative Temperature Θ" },
  SP: { ru: "Практическая солёность SP", en: "Practical Salinity SP" },
  SA: { ru: "Абсолютная солёность SA", en: "Absolute Salinity SA" },
  rho: { ru: "Плотность in-situ ρ", en: "In-situ density ρ" },
  sigma0: { ru: "Потенц. плотность σ₀", en: "Potential density σ₀" },
  soundSpeed: { ru: "Скорость звука c", en: "Sound speed c" },
  soundMack: { ru: "c по Маккензи (1981)", en: "c, Mackenzie (1981)" },
  N2: { ru: "Частота Брента–Вяйсяля N²", en: "Brunt–Väisälä N²" },
  O2: { ru: "Растворённый O₂", en: "Dissolved O₂" },
  NO3: { ru: "Нитраты NO₃⁻", en: "Nitrate NO₃⁻" },
  light: { ru: "Свет (доля PAR)", en: "Light (PAR fraction)" },
  lightZone: { ru: "Световая зона", en: "Light zone" },
  euphotic: { ru: "эвфотическая", en: "euphotic" },
  dysphotic: { ru: "дисфотическая (сумеречная)", en: "dysphotic (twilight)" },
  aphotic: { ru: "афотическая", en: "aphotic" },
  pelagicZone: { ru: "Пелагическая зона", en: "Pelagic zone" },
  vspeed: { ru: "Вертикальная скорость", en: "Vertical speed" },
  netBuoy: { ru: "Нетто-вес (+ тонет)", en: "Net weight (+ sinks)" },
  hullLoad: { ru: "Нагрузка на корпус", en: "Hull load" },
  diveTime: { ru: "Время погружения", en: "Dive time" },
  bottom: { ru: "Дно", en: "Seafloor" },
  altitude: { ru: "Высота над дном", en: "Altitude" },
  vb: { ru: "Переменный балласт", en: "Variable ballast" },
  dropWeights: { ru: "Сбросить грузы", en: "Drop weights" },
  emergency: { ru: "Аварийное всплытие", en: "Emergency ascent" },
  lights: { ru: "Прожекторы", en: "Lights" },
  photo: { ru: "Снимок", en: "Photo" },
  exportCTD: { ru: "CTD → CSV", en: "CTD → CSV" },
  exportLog: { ru: "Журнал → JSON", en: "Log → JSON" },
  log: { ru: "Журнал наблюдений", en: "Observation log" },
  profiles: { ru: "Профили", en: "Profiles" },
  tsDiagram: { ru: "T-S диаграмма", en: "T-S diagram" },
  spectrum: { ru: "Спектр света", en: "Light spectrum" },
  formula: { ru: "Формула и источник", en: "Formula and source" },
  source: { ru: "Источник", en: "Source" },
  dataSource: { ru: "Данные", en: "Data" },
  idealised: { ru: "модельный профиль (не измерения; заменится WOA23)", en: "idealised profile (not measurements; replaced by WOA23)" },
  vehicle: { ru: "Аппарат", en: "Vehicle" },
  mission: { ru: "Миссия", en: "Mission" },
  freeDive: { ru: "Свободная точка", en: "Free point" },
  start: { ru: "Начать погружение", en: "Start dive" },
  goals: { ru: "Задачи", en: "Goals" },
  month: { ru: "Месяц", en: "Month" },
  chl: { ru: "Хлорофилл-a у поверхности", en: "Surface chlorophyll-a" },
  landed: { ru: "НА ДНЕ", en: "ON BOTTOM" },
  imploded: { ru: "Корпус разрушен: превышен запас прочности 1,5 от рабочей глубины", en: "Hull failure: 1.5× rated depth safety factor exceeded" },
  overRated: { ru: "Глубже рабочей глубины аппарата!", en: "Deeper than the rated depth!" },
  encounter: { ru: "Встреча", en: "Encounter" },
  controlsHelp: {
    ru: "↑↓ ход · ←→ поворот · A/D лаг · R/F (PgUp/PgDn) верт. движители · W/S балласт · T цистерны · B грузы · H удержание глубины · E скан · C камера · мышь: обзор, колесо: зум · L свет · X аварийное · P снимок · 1/2/3 ускорение · пробел пауза · геймпад: стики, RT/LT, A скан, B грузы, X свет, Y камера",
    en: "↑↓ surge · ←→ yaw · A/D sway · R/F (PgUp/PgDn) vertical · W/S ballast · T tanks · B weights · H depth hold · E scan · C camera · mouse: look, wheel: zoom · L lights · X emergency · P photo · 1/2/3 warp · space pause · gamepad: sticks, RT/LT, A scan, B weights, X lights, Y camera",
  },
  firstPerson: { ru: "Вид из кабины", en: "Cockpit view" },
  thirdPerson: { ru: "Вид снаружи", en: "Outside view" },
  depthHold: { ru: "Удержание глубины", en: "Depth hold" },
  off: { ru: "выкл", en: "off" },
  holdNeedsDrop: { ru: "Сначала сбросьте спусковые грузы: с ними аппарат не удержать", en: "Drop the descent weights first: the craft cannot hold depth with them" },
  blow: { ru: "Продуть цистерны", en: "Blow tanks" },
  vent: { ru: "Стравить цистерны (погружение)", en: "Vent tanks (dive)" },
  interact: { ru: "Сканировать", en: "Scan" },
  scanNone: { ru: "Рядом никого — подойдите ближе и посветите", en: "Nothing nearby — get closer and use the lights" },
  scanned: { ru: "Идентифицировано", en: "Identified" },
  proceduralNote: { ru: "◇ процедурная модель: свободной готовой модели нет", en: "◇ procedural model: no free ready-made asset available" },
  battery: { ru: "Батарея", en: "Battery" },
  hull: { ru: "Корпус", en: "Hull" },
  impact: { ru: "Удар", en: "Impact" },
  lowBattery: { ru: "Батарея ниже 10 %", en: "Battery below 10 %" },
  batteryEmpty: { ru: "Батарея разряжена: движители и свет отключены", en: "Battery empty: thrusters and lights off" },
  surfaced: { ru: "Аппарат на поверхности", en: "Surfaced" },
  submerged: { ru: "Аппарат под водой", en: "Submerged" },
  afloat: { ru: "НА ПЛАВУ", en: "AFLOAT" },
  floorAhead: { ru: "Близко дно!", en: "Seafloor close!" },
  speedH: { ru: "Ход", en: "Speed" },
  heading: { ru: "курс", en: "hdg" },
  loading: { ru: "Загрузка моделей…", en: "Loading models…" },
  credits: { ru: "Источники 3D-моделей", en: "3D model credits" },
  labSeawater: { ru: "Морская вода (TEOS-10)", en: "Seawater (TEOS-10)" },
  labWaves: { ru: "Волны и экмановский перенос", en: "Waves and Ekman transport" },
  labLight: { ru: "Свет в воде", en: "Light in water" },
  wind: { ru: "Ветер U₁₀", en: "Wind U₁₀" },
  fetch: { ru: "Разгон волн", en: "Fetch" },
  latitude: { ru: "Широта", en: "Latitude" },
  Hs: { ru: "Значимая высота волны Hs", en: "Significant wave height Hs" },
  Tp: { ru: "Пиковый период Tp", en: "Peak period Tp" },
  ekmanDepth: { ru: "Глубина Экмана D_E", en: "Ekman depth D_E" },
  ekmanV0: { ru: "Поверхностное течение V₀", en: "Surface current V₀" },
  ekmanInvalid: { ru: "Теория Экмана неприменима у экватора (|φ| < 10°)", en: "Ekman theory invalid near the equator (|φ| < 10°)" },
  zeu: { ru: "Эвфотическая глубина (1 % PAR)", en: "Euphotic depth (1 % PAR)" },
  sofar: { ru: "Ось SOFAR", en: "SOFAR axis" },
  mapHint: { ru: "Щёлкните по океану, чтобы выбрать точку, или выберите миссию", en: "Click the ocean to pick a point, or choose a mission" },
  noBathy: { ru: "Рельеф GEBCO не загружен: глубина дна по умолчанию 4000 м", en: "GEBCO bathymetry not loaded: default depth 4000 m" },
  months: {
    ru: ["год", "янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
    en: ["annual", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  },
} as const;

type Key = keyof typeof dict;

let lang: Lang = ((): Lang => {
  try {
    const s = localStorage.getItem("ocean-lang");
    if (s === "ru" || s === "en") return s;
  } catch { /* storage unavailable */ }
  return navigator.language?.startsWith("ru") ? "ru" : "en";
})();

const listeners: Array<() => void> = [];

export const getLang = () => lang;
export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem("ocean-lang", l); } catch { /* ignore */ }
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}
export const onLang = (f: () => void) => listeners.push(f);

export function tr(key: Key): string {
  const v = dict[key][lang];
  return Array.isArray(v) ? v.join(",") : (v as string);
}
export function trList(key: "months"): readonly string[] {
  return dict[key][lang];
}
/** Pick from a {ru, en} record. */
export const L = <T>(o: { ru: T; en: T }): T => o[lang];
