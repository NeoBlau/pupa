/**
 * Organisms that can be encountered. Depth ranges are the commonly observed
 * range from the cited source (not absolute records unless stated). Encounters
 * are drawn from these ranges; they are NOT observations at the dive site.
 */
export type Region =
  | "global" | "tropical" | "temperate" | "southern" | "pacific_trench" | "mar_vent"
  | "baikal" | "red_sea" | "nw_atlantic";

export interface Species {
  id: string;
  latin: string;
  name: { ru: string; en: string };
  depth: [number, number]; // m
  /** Night-time range for diel vertical migrators. */
  nightDepth?: [number, number];
  regions: Region[];
  freshwater?: boolean;
  bioluminescent?: boolean;
  /** Lives on or just above the seafloor: only met within ~20 m of the bottom. */
  benthic?: boolean;
  /** Expected encounters per hour of dive time inside the range (game rate). */
  rate: number;
  fact: { ru: string; en: string };
  source: string;
  color: string;
}

export const SPECIES: Species[] = [
  {
    id: "physalia", latin: "Physalia physalis", name: { ru: "Португальский кораблик", en: "Portuguese man o' war" },
    depth: [0, 2], regions: ["tropical", "temperate"], rate: 1.5, color: "#8a7dff",
    fact: { ru: "Колония сифонофор, живёт у поверхности на газовом пузыре-парусе.", en: "A siphonophore colony that sails at the surface on a gas-filled float." },
    source: "WoRMS; Munro C. et al. (2019) Mol. Phylogenet. Evol.",
  },
  {
    id: "sargassum", latin: "Sargassum natans", name: { ru: "Саргассовые водоросли", en: "Sargassum" },
    depth: [0, 2], regions: ["nw_atlantic"], rate: 2, color: "#b58a2a",
    fact: { ru: "Единственные крупные водоросли, которые всю жизнь дрейфуют и нигде не прикреплены. По ним названо Саргассово море.", en: "Holopelagic brown alga that never attaches to the seabed; the Sargasso Sea is named after it." },
    source: "Laffoley D. et al. (2011) The protection and management of the Sargasso Sea",
  },
  {
    id: "tuna", latin: "Thunnus albacares", name: { ru: "Желтопёрый тунец", en: "Yellowfin tuna" },
    depth: [1, 250], regions: ["tropical"], rate: 0.6, color: "#d9c24a",
    fact: { ru: "Тёплые мышцы помогают ему нырять ниже термоклина.", en: "Regional endothermy lets it dive below the thermocline." },
    source: "FishBase: Thunnus albacares",
  },
  {
    id: "mola", latin: "Mola mola", name: { ru: "Рыба-луна", en: "Ocean sunfish" },
    depth: [30, 480], regions: ["tropical", "temperate"], rate: 0.3, color: "#a9b6c4",
    fact: { ru: "Самая тяжёлая костная рыба, до 2,3 т. Ныряет за сифонофорами и медузами.", en: "Heaviest bony fish (up to 2.3 t); dives after siphonophores and jellies." },
    source: "FishBase: Mola mola",
  },
  {
    id: "krill", latin: "Euphausia superba", name: { ru: "Антарктический криль", en: "Antarctic krill" },
    depth: [0, 200], regions: ["southern"], rate: 3, color: "#e07b67",
    fact: { ru: "Общая биомасса оценивается в сотни миллионов тонн. На нём держится пищевая сеть Южного океана.", en: "Total biomass estimated at hundreds of millions of tonnes — the base of the Southern Ocean food web." },
    source: "Atkinson A. et al. (2009) Mar. Ecol. Prog. Ser. 362",
  },
  {
    id: "silverfish", latin: "Pleuragramma antarctica", name: { ru: "Антарктическая серебрянка", en: "Antarctic silverfish" },
    depth: [0, 700], regions: ["southern"], rate: 1, color: "#c9d6e3",
    fact: { ru: "В крови антифриз-гликопротеины, поэтому она не замерзает при −1,9 °C.", en: "Antifreeze glycoproteins keep its blood liquid at −1.9 °C." },
    source: "FishBase: Pleuragramma antarctica",
  },
  {
    id: "emperor", latin: "Aptenodytes forsteri", name: { ru: "Императорский пингвин", en: "Emperor penguin" },
    depth: [0, 564], regions: ["southern"], rate: 0.2, color: "#f2f2f2",
    fact: { ru: "Рекордный зарегистрированный нырок 564 м.", en: "Deepest recorded dive 564 m." },
    source: "Wienecke B. et al. (2007) Polar Biol. 30",
  },
  {
    id: "lanternfish", latin: "Myctophidae", name: { ru: "Светящиеся анчоусы", en: "Lanternfishes" },
    depth: [300, 1200], nightDepth: [0, 200], regions: ["global"], bioluminescent: true, rate: 2, color: "#7fe3ff",
    fact: { ru: "Одна из самых массовых групп позвоночных. Каждую ночь поднимаются к поверхности: это суточная вертикальная миграция.", en: "Among the most abundant vertebrates; they migrate to the surface every night (diel vertical migration)." },
    source: "Catul V. et al. (2011) Rev. Fish Biol. Fish. 21",
  },
  {
    id: "viperfish", latin: "Chauliodus sloani", name: { ru: "Хаулиод", en: "Sloane's viperfish" },
    depth: [200, 1000], nightDepth: [50, 500], regions: ["tropical", "temperate"], bioluminescent: true, rate: 0.5, color: "#4bd6c8",
    fact: { ru: "Приманивает добычу фотофором на спинном луче.", en: "Lures prey with a photophore on its dorsal fin ray." },
    source: "FishBase: Chauliodus sloani",
  },
  {
    id: "vampire_squid", latin: "Vampyroteuthis infernalis", name: { ru: "Адский вампир", en: "Vampire squid" },
    depth: [600, 1200], regions: ["tropical", "temperate"], bioluminescent: true, rate: 0.25, color: "#9c2f4a",
    fact: { ru: "Живёт в зоне кислородного минимума и питается «морским снегом».", en: "Lives in the oxygen-minimum zone and feeds on marine snow." },
    source: "Hoving H.J.T., Robison B.H. (2012) Proc. R. Soc. B 279",
  },
  {
    id: "giant_squid", latin: "Architeuthis dux", name: { ru: "Гигантский кальмар", en: "Giant squid" },
    depth: [300, 1000], regions: ["global"], rate: 0.03, color: "#c0584a",
    fact: { ru: "Впервые снят живым в природе в 2004 г. (Кубодера и Мори). Глаза до 27 см, самые большие у животных.", en: "First filmed alive in the wild in 2004 (Kubodera & Mori); eyes up to 27 cm — the largest in the animal kingdom." },
    source: "Kubodera T., Mori K. (2005) Proc. R. Soc. B 272",
  },
  {
    id: "sperm_whale", latin: "Physeter macrocephalus", name: { ru: "Кашалот", en: "Sperm whale" },
    depth: [0, 2000], regions: ["tropical", "temperate"], rate: 0.08, color: "#6d7580",
    fact: { ru: "Охотится на кальмаров на глубинах 400–1200 м. Щелчки эхолокации достигают 230 дБ.", en: "Hunts squid at 400–1200 m; echolocation clicks reach 230 dB re 1 µPa." },
    source: "Watwood S.L. et al. (2006) J. Anim. Ecol. 75",
  },
  {
    id: "beaked_whale", latin: "Ziphius cavirostris", name: { ru: "Клюворыл", en: "Cuvier's beaked whale" },
    depth: [0, 2992], regions: ["global"], rate: 0.05, color: "#8b8f7a",
    fact: { ru: "Рекорд ныряния среди млекопитающих: 2992 м и 137 минут под водой.", en: "Mammalian dive record: 2992 m and 137 min." },
    source: "Schorr G.S. et al. (2014) PLoS ONE 9(3): e92633",
  },
  {
    id: "anglerfish", latin: "Melanocetus johnsonii", name: { ru: "Удильщик Джонсона", en: "Humpback anglerfish" },
    depth: [200, 2000], regions: ["global"], bioluminescent: true, rate: 0.2, color: "#3a3f55",
    fact: { ru: "Свет в эске дают симбиотические бактерии.", en: "The glowing lure (esca) is lit by symbiotic bacteria." },
    source: "FishBase: Melanocetus johnsonii",
  },
  {
    id: "fangtooth", latin: "Anoplogaster cornuta", name: { ru: "Саблезуб", en: "Fangtooth" },
    depth: [500, 2000], regions: ["global"], rate: 0.3, color: "#5b4636",
    fact: { ru: "Самые большие зубы у рыб относительно размера тела.", en: "Proportionally the largest teeth of any fish." },
    source: "FishBase: Anoplogaster cornuta",
  },
  {
    id: "gulper", latin: "Eurypharynx pelecanoides", name: { ru: "Большерот", en: "Gulper eel" },
    depth: [500, 3000], regions: ["global"], bioluminescent: true, rate: 0.15, color: "#2e2e3a",
    fact: { ru: "Рот может быть больше всего остального тела.", en: "Its mouth can be larger than the rest of its body." },
    source: "FishBase: Eurypharynx pelecanoides",
  },
  {
    id: "dumbo", latin: "Grimpoteuthis spp.", name: { ru: "Осьминог-дамбо", en: "Dumbo octopus" },
    depth: [1000, 7000], regions: ["global"], rate: 0.15, color: "#f0a3a3",
    fact: { ru: "Самые глубоководные осьминоги, наблюдались почти на 7000 м.", en: "Deepest-living octopods, observed near 7000 m." },
    source: "Jamieson A.J., Vecchione M. (2020) Mar. Biol. 167",
  },
  {
    id: "tripod", latin: "Bathypterois grallator", name: { ru: "Рыба-тренога", en: "Tripod fish" },
    depth: [878, 4720], benthic: true, regions: ["global"], rate: 0.4, color: "#9aa0a8",
    fact: { ru: "Стоит на дне на трёх удлинённых лучах плавников, развернувшись навстречу течению.", en: "Stands on three elongated fin rays facing into the current." },
    source: "FishBase: Bathypterois grallator",
  },
  {
    id: "sea_pig", latin: "Scotoplanes globosa", name: { ru: "Морская свинья (голотурия)", en: "Sea pig" },
    depth: [1000, 6000], benthic: true, regions: ["global"], rate: 0.5, color: "#f3c1c8",
    fact: { ru: "Голотурия, которая ходит по дну на трубчатых ножках и пропускает через себя осадок.", en: "A sea cucumber that walks on tube feet and eats sediment." },
    source: "WoRMS; Rogacheva A. et al. (2012) Mar. Biodivers.",
  },
  {
    id: "xeno", latin: "Xenophyophorea", name: { ru: "Ксенофиофоры", en: "Xenophyophores" },
    depth: [500, 10641], benthic: true, regions: ["global"], rate: 0.6, color: "#d8c9a3",
    fact: { ru: "Гигантские одноклеточные до 20 см. Найдены на глубине 10 641 м в Бездне Челленджера.", en: "Giant single-celled organisms up to 20 cm; found at 10 641 m in the Challenger Deep." },
    source: "Gooday A.J. et al. (2004) Deep-Sea Res. I 51",
  },
  {
    id: "snailfish", latin: "Pseudoliparis swirei", name: { ru: "Марианский липарис", en: "Mariana snailfish" },
    depth: [6198, 8078], benthic: true, regions: ["pacific_trench"], rate: 1.5, color: "#f5e4e8",
    fact: { ru: "Одна из самых глубоководных рыб. Предел около 8200 м задаёт осмолит TMAO: он стабилизирует белки при давлении.", en: "One of the deepest fish; the ~8200 m limit is set by the osmolyte TMAO that stabilises proteins under pressure." },
    source: "Gerringer M.E. et al. (2017) Zootaxa 4358; Yancey P.H. et al. (2014) PNAS 111",
  },
  {
    id: "amphipod", latin: "Hirondellea gigas", name: { ru: "Гигантская амфипода", en: "Hadal amphipod" },
    depth: [6000, 10900], benthic: true, regions: ["pacific_trench"], rate: 3, color: "#f8f4e8",
    fact: { ru: "Переваривает древесину с помощью фермента целлюлазы. Встречается на самом дне Бездны Челленджера.", en: "Digests wood with a cellulase enzyme; lives at the very bottom of the Challenger Deep." },
    source: "Kobayashi H. et al. (2012) PLoS ONE 7(8): e42727",
  },
  {
    id: "rimicaris", latin: "Rimicaris exoculata", name: { ru: "Креветка Rimicaris", en: "Vent shrimp" },
    depth: [1700, 4100], benthic: true, regions: ["mar_vent"], rate: 6, color: "#e8d9c0",
    fact: { ru: "Глаз нет. На спине фоторецептор, который видит слабое тепловое свечение чёрных курильщиков. Кормится хемосинтезирующими бактериями.", en: "Eyeless; a dorsal photoreceptor senses the faint thermal glow of black smokers. Farms chemosynthetic bacteria." },
    source: "Van Dover C.L. et al. (1989) Nature 337",
  },
  {
    id: "vent_mussel", latin: "Bathymodiolus puteoserpentis", name: { ru: "Гидротермальная мидия", en: "Vent mussel" },
    depth: [3000, 3600], benthic: true, regions: ["mar_vent"], rate: 2, color: "#6b5b4a",
    fact: { ru: "В жабрах одновременно живут сульфид-окисляющие и метанотрофные симбионты.", en: "Hosts both sulfur-oxidising and methanotrophic symbionts in its gills." },
    source: "Duperron S. et al. (2006) Environ. Microbiol. 8",
  },
  {
    id: "golomyanka", latin: "Comephorus baikalensis", name: { ru: "Большая голомянка", en: "Big Baikal oilfish" },
    depth: [0, 1600], regions: ["baikal"], freshwater: true, rate: 2, color: "#f1e6d8",
    fact: { ru: "Живородящая эндемичная рыба Байкала, до 35–40 % массы тела составляет жир. Плавательного пузыря нет.", en: "Viviparous Baikal endemic; up to 35–40 % of body mass is fat, no swim bladder." },
    source: "Sideleva V.G. (2003) The Endemic Fishes of Lake Baikal",
  },
  {
    id: "nerpa", latin: "Pusa sibirica", name: { ru: "Байкальская нерпа", en: "Baikal seal" },
    depth: [0, 300], regions: ["baikal"], freshwater: true, rate: 0.3, color: "#8f8f8f",
    fact: { ru: "Единственный тюлень, который живёт только в пресной воде.", en: "The only exclusively freshwater seal." },
    source: "Stewart B.E. et al. (1996) Can. J. Zool. 74",
  },
  {
    id: "epischura", latin: "Epischura baikalensis", name: { ru: "Эпишура", en: "Epischura copepod" },
    depth: [0, 250], regions: ["baikal"], freshwater: true, rate: 4, color: "#f7f0c8",
    fact: { ru: "Эндемичный рачок. На него приходится до 90 % биомассы зоопланктона Байкала, он фильтрует и очищает воду.", en: "Endemic copepod making up to 90 % of Baikal zooplankton biomass; it filters the water." },
    source: "Kozhova O.M., Izmest'eva L.R. (1998) Lake Baikal: Evolution and Biodiversity",
  },
];

export function regionsFor(lat: number, lon: number, missionId?: string): Region[] {
  if (missionId === "baikal") return ["baikal"];
  const r: Region[] = ["global"];
  const a = Math.abs(lat);
  if (a < 35) r.push("tropical");
  if (a >= 25 && a < 60) r.push("temperate");
  if (lat < -50) r.push("southern");
  if (missionId === "challenger_deep") r.push("pacific_trench");
  if (missionId === "tag_vents") r.push("mar_vent");
  if (missionId === "red_sea") r.push("red_sea");
  if (missionId === "reef_guam") r.push("tropical");
  if (missionId === "gulf_stream" || (lat > 20 && lat < 45 && lon > -80 && lon < -40)) r.push("nw_atlantic");
  return r;
}

export function isNight(solarHour: number): boolean {
  return solarHour < 6 || solarHour >= 18;
}

export const BENTHIC_ALTITUDE = 20; // m

export function candidates(depth: number, regions: Region[], freshwater: boolean, night: boolean, altitude = Infinity): Species[] {
  return SPECIES.filter((s) => {
    if (!!s.freshwater !== freshwater) return false;
    if (s.benthic && altitude > BENTHIC_ALTITUDE) return false;
    if (!s.regions.some((r) => regions.includes(r))) return false;
    const [lo, hi] = night && s.nightDepth ? s.nightDepth : s.depth;
    return depth >= lo && depth <= hi;
  });
}
