export interface Mission {
  id: string;
  lat: number;
  lon: number;
  bottom: number; // m
  vehicle: string;
  chl: number; // surface chlorophyll-a [mg/m³] (typical climatological value)
  name: { ru: string; en: string };
  brief: { ru: string; en: string };
  goals: { ru: string[]; en: string[] };
  source: string;
}

export const MISSIONS: Mission[] = [
  {
    id: "challenger_deep", lat: 11.3733, lon: 142.5917, bottom: 10935, vehicle: "limiting_factor", chl: 0.05,
    name: { ru: "Бездна Челленджера", en: "Challenger Deep" },
    brief: {
      ru: "Самая глубокая точка Мирового океана, Марианский желоб. Давление на дне больше 1100 бар. Олиготрофный круговорот, вода у поверхности очень прозрачная.",
      en: "The deepest point of the ocean, Mariana Trench. Bottom pressure exceeds 1100 bar. Oligotrophic gyre with very clear surface water.",
    },
    goals: {
      ru: ["Снять CTD-профиль до дна", "Найти ось звукового канала SOFAR", "Увидеть, как in-situ температура растёт у дна при почти постоянной потенциальной", "Встретить марианского липариса (6200–8000 м)"],
      en: ["Record a CTD cast to the bottom", "Locate the SOFAR channel axis", "Observe in-situ temperature rising near the bottom while potential temperature is ~constant", "Encounter the Mariana snailfish (6200–8000 m)"],
    },
    source: "Greenaway S. et al. (2021) Earth Space Sci. — depth 10 935 ± 6 m",
  },
  {
    id: "tag_vents", lat: 26.137, lon: -44.826, bottom: 3650, vehicle: "alvin", chl: 0.08,
    name: { ru: "Гидротермы TAG, Срединно-Атлантический хребет", en: "TAG hydrothermal field, Mid-Atlantic Ridge" },
    brief: {
      ru: "Активный гидротермальный холм. Чёрные курильщики выбрасывают флюид около 360 °C. Жизнь здесь держится на хемосинтезе, а не на фотосинтезе.",
      en: "Active hydrothermal mound; black smokers vent ~360 °C fluid. Life is based on chemosynthesis, not photosynthesis.",
    },
    goals: {
      ru: ["Опуститься на хребет (~3650 м)", "Найти креветок Rimicaris", "Сравнить глубинные воды NADW с поверхностными на T-S диаграмме"],
      en: ["Descend to the ridge (~3650 m)", "Find Rimicaris shrimp", "Compare NADW with surface water on the T-S diagram"],
    },
    source: "Rona P.A. et al. (1986) Nature 321; Humphris S.E. et al. (1995) Nature 377",
  },
  {
    id: "gulf_stream", lat: 37.0, lon: -71.0, bottom: 3800, vehicle: "alvin", chl: 0.3,
    name: { ru: "Гольфстрим", en: "Gulf Stream" },
    brief: {
      ru: "Западное пограничное течение со скоростью до 2 м/с. Под поверхностью лежит «18-градусная» модовая вода Северной Атлантики.",
      en: "Western boundary current up to 2 m/s. Beneath lies the North Atlantic 18° Mode Water.",
    },
    goals: {
      ru: ["Найти слой 18-градусной модовой воды (~200–400 м)", "Измерить N² в главном термоклине", "Сравнить TEOS-10 с формулой Маккензи для скорости звука"],
      en: ["Find the 18° Mode Water layer (~200–400 m)", "Measure N² in the main thermocline", "Compare TEOS-10 and Mackenzie sound speed"],
    },
    source: "Talley L.D. et al. (2011) Descriptive Physical Oceanography, ch. 9",
  },
  {
    id: "weddell", lat: -65.0, lon: -40.0, bottom: 4700, vehicle: "mir", chl: 0.8,
    name: { ru: "Море Уэдделла", en: "Weddell Sea" },
    brief: {
      ru: "Здесь образуется Антарктическая донная вода, самая плотная вода открытого океана. Поверхность у точки замерзания, а под ней лежит тёплая глубинная вода.",
      en: "Formation region of Antarctic Bottom Water, the densest water of the open ocean. The surface is at freezing point with Warm Deep Water beneath.",
    },
    goals: {
      ru: ["Проверить, что поверхность близка к CT замерзания", "Найти тёплую глубинную воду (θ > 0 °C)", "Пройти через донную воду моря Уэдделла (θ < −0,7 °C)"],
      en: ["Check the surface is near CT_freezing", "Find Warm Deep Water (θ > 0 °C)", "Pass into Weddell Sea Bottom Water (θ < −0.7 °C)"],
    },
    source: "Talley L.D. et al. (2011) ch. 13; Orsi A.H. et al. (1999) Prog. Oceanogr. 43",
  },
  {
    id: "red_sea", lat: 21.35, lon: 38.07, bottom: 2200, vehicle: "mir", chl: 0.2,
    name: { ru: "Красное море, впадина Атлантис II", en: "Red Sea, Atlantis II Deep" },
    brief: {
      ru: "Самое тёплое и солёное глубоководье на планете: ниже 300 м около 21,6 °C и солёность 40,6. На дне впадины лежат горячие рассолы до ~68 °C.",
      en: "The warmest and saltiest deep water on Earth: ~21.6 °C and SP 40.6 below 300 m. The deep holds hot brines up to ~68 °C.",
    },
    goals: {
      ru: ["Сравнить профиль с открытым океаном", "Понять, почему на глубине не холодно (порог Баб-эль-Мандеб ~140 м)", "Оценить скорость звука в тёплой глубинной воде"],
      en: ["Compare the profile with the open ocean", "Understand why the deep is warm (Bab-el-Mandeb sill ~140 m)", "Estimate sound speed in warm deep water"],
    },
    source: "Talley L.D. et al. (2011) ch. 8; Swift S.A. et al. (2012) Deep-Sea Res. I 64",
  },
  {
    id: "baikal", lat: 53.25, lon: 108.07, bottom: 1642, vehicle: "mir", chl: 1.0,
    name: { ru: "Озеро Байкал", en: "Lake Baikal" },
    brief: {
      ru: "Самое глубокое озеро мира (1642 м). Пресная вода, поэтому температура максимальной плотности около 4 °C и падает с давлением. В 2008–2010 гг. сюда погружались «Миры».",
      en: "The deepest lake on Earth (1642 m). Fresh water: the temperature of maximum density is ~4 °C and decreases with pressure. Mir submersibles dived here in 2008–2010.",
    },
    goals: {
      ru: ["Сравнить плотность пресной и морской воды", "Встретить голомянку", "Увидеть, что глубинная вода Байкала холоднее 4 °C"],
      en: ["Compare fresh vs sea water density", "Meet the golomyanka", "See that Baikal deep water is colder than 4 °C"],
    },
    source: "Shimaraev M.N. et al. (1994) Physical Limnology of Lake Baikal",
  },
];
