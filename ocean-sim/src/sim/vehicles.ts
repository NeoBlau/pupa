/**
 * Real crewed deep submergence vehicles.
 *
 * Published values are marked `src`; values not published by the operator are
 * engineering estimates marked `est`. Displaced volume and descent-weight
 * mass are calibrated (see calibrate() in submersible.ts) so that transit
 * times over the rated depth equal the historically reported dive times.
 */
export interface Vehicle {
  id: string;
  name: { ru: string; en: string };
  year: string;
  crew: number;
  ratedDepth: number; // m, operational rating
  mass: number; // kg, in air
  length: number; width: number; height: number; // m
  /** Buoyant compressible volume (gasoline float or syntactic foam) [m³]. */
  floatVolume: number;
  /** Compressibility of the float medium [1/Pa]. */
  floatKappa: number;
  /** Volumetric thermal expansion of the float medium [1/K] (gasoline only). */
  floatThermal: number;
  /** Compressibility of the pressure hull and frame [1/Pa]. */
  hullKappa: number;
  descentSpeed: number; // m/s, historical average
  ascentSpeed: number; // m/s
  /** Drop weights carried for descent [kg] (released on the bottom). */
  descentWeights: number;
  /** Variable ballast capacity [kg of seawater]. */
  variableBallast: number;
  thrust: number; // N, total horizontal
  cdVertical: number;
  lightsW: number;
  notes: { ru: string; en: string };
  sources: string[];
}

export const VEHICLES: Vehicle[] = [
  {
    id: "trieste",
    name: { ru: "Триест (1960)", en: "Trieste (1960)" },
    year: "1953–1966",
    crew: 2,
    ratedDepth: 11000,
    // Mass in air (est): 85 m³ gasoline × 0.70 t/m³ ≈ 59.5 t, Krupp sphere,
    // float shell, shot and tanks. Often-quoted "50 t" cannot be the mass in
    // air because the gasoline alone weighs more.
    mass: 105000,
    length: 18.1, width: 3.5, height: 7.0,
    floatVolume: 85, // 85 000 L of gasoline (src)
    floatKappa: 7.7e-10, // gasoline bulk modulus ≈ 1.3 GPa (est)
    floatThermal: 9.5e-4, // gasoline (est)
    hullKappa: 1e-11,
    descentSpeed: 10916 / (4 * 3600 + 47 * 60), // 4 h 47 min to the bottom (src)
    ascentSpeed: 10916 / (3 * 3600 + 15 * 60), // 3 h 15 min (src)
    descentWeights: 9000, // ≈ 9 t iron shot in two hoppers (src)
    variableBallast: 0,
    thrust: 1200,
    cdVertical: 1.1,
    lightsW: 1500,
    notes: {
      ru: "Батискаф: плавучесть даёт поплавок с бензином, который сжимается и остывает сильнее воды, поэтому по мере погружения аппарат тяжелеет. Спуск регулируют сбросом дроби.",
      en: "Bathyscaphe: buoyancy from a gasoline float that is more compressible than seawater and cools on descent, so the craft gets heavier with depth. Descent is trimmed by releasing iron shot.",
    },
    sources: ["Piccard J., Dietz R.S. (1961) Seven Miles Down", "US Navy NHHC: Trieste"],
  },
  {
    id: "alvin",
    name: { ru: "Alvin (2022)", en: "Alvin (2022)" },
    year: "1964– (upgrade 2022)",
    crew: 3,
    ratedDepth: 6500,
    mass: 20700,
    length: 7.1, width: 2.6, height: 3.7,
    floatVolume: 8.0, // syntactic foam (est)
    floatKappa: 1.5e-10, // syntactic foam (est)
    floatThermal: 0,
    hullKappa: 1e-11,
    descentSpeed: 30 / 60, // ≈ 30 m/min (src: WHOI)
    ascentSpeed: 30 / 60,
    descentWeights: 450, // steel descent weights (est)
    variableBallast: 400,
    thrust: 2400,
    cdVertical: 1.0,
    lightsW: 2000,
    notes: {
      ru: "Научный аппарат WHOI. Титановая сфера, синтактная пена, сбрасываемые стальные грузы и система переменного балласта.",
      en: "WHOI research submersible. Titanium sphere, syntactic foam, droppable steel weights and variable ballast.",
    },
    sources: ["WHOI: HOV Alvin specifications", "NDSF Alvin User Manual"],
  },
  {
    id: "limiting_factor",
    name: { ru: "Limiting Factor (2019)", en: "Limiting Factor (2019)" },
    year: "2018–",
    crew: 2,
    ratedDepth: 11000,
    mass: 11700,
    length: 4.6, width: 1.9, height: 3.7,
    floatVolume: 5.5, // syntactic foam (est)
    floatKappa: 1.5e-10,
    floatThermal: 0,
    hullKappa: 1e-11,
    descentSpeed: 10925 / (4 * 3600), // ≈ 4 h to Challenger Deep (src: Five Deeps Expedition)
    ascentSpeed: 10925 / (4 * 3600),
    descentWeights: 300, // (est)
    variableBallast: 200,
    thrust: 1600,
    cdVertical: 0.9,
    lightsW: 1200,
    notes: {
      ru: "Triton 36000/2. Первый аппарат, сертифицированный DNV для многократных погружений на полную глубину океана. Титановая сфера 90 мм.",
      en: "Triton 36000/2. First vehicle certified by DNV for repeated full-ocean-depth dives. 90 mm titanium sphere.",
    },
    sources: ["Triton Submarines: 36000/2 specifications", "Jamieson A. et al. (2019) Five Deeps Expedition"],
  },
  {
    id: "mir",
    name: { ru: "«Мир» (1987)", en: "Mir (1987)" },
    year: "1987–",
    crew: 3,
    ratedDepth: 6000,
    mass: 18600,
    length: 7.8, width: 3.6, height: 3.0,
    floatVolume: 7.5, // (est)
    floatKappa: 1.5e-10,
    floatThermal: 0,
    hullKappa: 1e-11,
    descentSpeed: 0.6, // (est)
    ascentSpeed: 0.6,
    descentWeights: 400,
    variableBallast: 290,
    thrust: 2000,
    cdVertical: 1.0,
    lightsW: 2000,
    notes: {
      ru: "Построены Rauma-Repola для ИО РАН. Погружались на «Титаник», к гидротермам, на дно у Северного полюса (4261 м, 2007) и в Байкал (2008–2010).",
      en: "Built by Rauma-Repola for the Shirshov Institute. Dived to Titanic, hydrothermal vents, the North Pole seabed (4261 m, 2007) and Lake Baikal (2008–2010).",
    },
    sources: ["Shirshov Institute of Oceanology RAS: Mir-1/Mir-2", "Sagalevich A.M. (2008)"],
  },
];

/** Vertical plan area used for drag in heave [m²]. */
export const planArea = (v: Vehicle) => v.length * v.width * (v.id === "trieste" ? 0.8 : 0.75);
