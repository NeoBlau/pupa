/** Formula and source shown when a user clicks an instrument reading. */
export interface FormulaInfo {
  tex: string; // plain-text formula (Unicode), rendered as-is
  explain: { ru: string; en: string };
  refs: string[];
}

const TEOS = "IOC, SCOR & IAPSO (2010) TEOS-10 Manual, UNESCO Manuals and Guides 56";
const ROQUET = "Roquet F. et al. (2015) Ocean Modelling 90, 29–43";

export const FORMULAS: Record<string, FormulaInfo> = {
  pressure: {
    tex: "p(z): solve h_SSO(p) + g(φ)·(z − ½γz²) = 0, γ = 2.26·10⁻⁷ 1/m",
    explain: {
      ru: "Давление по глубине в стандартном океане (SA = 35,16504 г/кг, Θ = 0 °C) и широтной гравитации. Отклонение от реального столба воды меньше 0,1 %.",
      en: "Pressure from depth for the standard ocean (SA = 35.16504 g/kg, Θ = 0 °C) with latitude-dependent gravity; error vs a real column < 0.1 %.",
    },
    refs: [TEOS, "Saunders P.M. (1981) J. Phys. Oceanogr. 11, 573–574"],
  },
  rho: {
    tex: "ρ = 1 / v(SA, Θ, p),  v = Σ v_ijk · x^i · y^j · z^k   (75 terms)\nx = √(SA/40·(35/35.16504) + 0.5972), y = Θ/40, z = p/10⁴",
    explain: {
      ru: "Плотность in-situ по полиному Рокета и соавторов для удельного объёма. Погрешность относительно полной функции Гиббса TEOS-10 меньше 0,0015 kg/m³.",
      en: "In-situ density from the Roquet et al. 75-term specific-volume polynomial; error vs the full TEOS-10 Gibbs function < 0.0015 kg/m³.",
    },
    refs: [TEOS, ROQUET],
  },
  sigma0: {
    tex: "σ₀ = ρ(SA, Θ, 0) − 1000 kg/m³",
    explain: {
      ru: "Потенциальная плотность: какой была бы плотность частицы, если поднять её к поверхности адиабатически. Вода движется в основном вдоль поверхностей σ.",
      en: "Potential density: the density a parcel would have if moved adiabatically to the surface. Water spreads mainly along σ surfaces.",
    },
    refs: [TEOS],
  },
  soundSpeed: {
    tex: "c = √(∂p/∂ρ)|_{SA,η} = v · √(−1/(∂v/∂p))",
    explain: {
      ru: "Скорость звука считается из сжимаемости по тому же 75-членному полиному. Минимум c(z) задаёт ось звукового канала SOFAR: звук распространяется вдоль неё на тысячи километров.",
      en: "Sound speed from compressibility of the same 75-term polynomial. The minimum of c(z) is the SOFAR channel axis where sound travels thousands of km.",
    },
    refs: [TEOS, ROQUET, "Munk W.H. (1974) J. Acoust. Soc. Am. 55, 220–226"],
  },
  soundMack: {
    tex: "c = 1448.96 + 4.591t − 5.304·10⁻²t² + 2.374·10⁻⁴t³ + 1.340(S−35) + 1.630·10⁻²D + 1.675·10⁻⁷D² − 1.025·10⁻²t(S−35) − 7.139·10⁻¹³tD³",
    explain: {
      ru: "Эмпирическая формула из 9 членов, по-прежнему популярная в гидроакустике. Применима при t от 2 до 30 °C, S от 25 до 40 и D от 0 до 8000 м. Приведена для сравнения с TEOS-10.",
      en: "Empirical nine-term formula still common in underwater acoustics; valid for t 2–30 °C, S 25–40, D 0–8000 m. Shown for comparison with TEOS-10.",
    },
    refs: ["Mackenzie K.V. (1981) J. Acoust. Soc. Am. 70, 807–812"],
  },
  N2: {
    tex: "N² = g² / (v·Δp·10⁴) · (β·ΔSA − α·ΔΘ)",
    explain: {
      ru: "Квадрат частоты плавучести, считается по соседним стандартным уровням так же, как в gsw.Nsquared. Если N² > 0, столб устойчив. Период внутренних волн не может быть короче 2π/N.",
      en: "Squared buoyancy frequency from adjacent standard levels (same discretisation as gsw.Nsquared). N² > 0 means stable; internal waves cannot have periods shorter than 2π/N.",
    },
    refs: [TEOS, "Gill A.E. (1982) Atmosphere–Ocean Dynamics, §3.7"],
  },
  CT: {
    tex: "Θ = h⁰(SA, θ) / c⁰_p,  c⁰_p = 3991.868 J/(kg·K)",
    explain: {
      ru: "Консервативная температура пропорциональна потенциальной энтальпии. В отличие от потенциальной температуры θ, она почти точно сохраняется при перемешивании. Это стандарт TEOS-10.",
      en: "Conservative Temperature is proportional to potential enthalpy; unlike potential temperature θ it is (almost exactly) conserved on mixing. TEOS-10 standard.",
    },
    refs: [TEOS, "McDougall T.J. (2003) J. Phys. Oceanogr. 33, 945–963"],
  },
  insituT: {
    tex: "t = t(SA, Θ, p): inverse of Θ(SA, t, p) via the Gibbs function",
    explain: {
      ru: "Это температура, которую показал бы термометр на месте. На больших глубинах она растёт от адиабатического сжатия, примерно на 0,1–0,15 °C на километр. Ниже 5500 м SA и Θ считаются постоянными, а t растёт только за счёт сжатия.",
      en: "What a thermometer would read in place. At depth it rises due to adiabatic compression (~0.1–0.15 °C/km). Below 5500 m SA and Θ are held constant and t rises only by compression.",
    },
    refs: [TEOS],
  },
  SA: {
    tex: "SA = (35.16504/35)·SP + δSA(x, y, p)",
    explain: {
      ru: "Абсолютная солёность, масса растворённых солей в граммах на килограмм. Поправка δSA учитывает кремнезём и карбонаты, она до 0,03 г/кг и берётся из атласа SAAR.",
      en: "Absolute Salinity: mass of dissolved salts in g/kg. δSA (up to ~0.03 g/kg, silicate and carbonate) comes from the SAAR atlas.",
    },
    refs: [TEOS, "McDougall T.J. et al. (2012) Ocean Sci. 8, 1123–1134"],
  },
  SP: {
    tex: "SP = f(R₁₅), PSS-78 conductivity ratio",
    explain: { ru: "Практическая солёность: безразмерная величина по шкале PSS-78, её измеряют CTD-зонды.", en: "Practical Salinity: dimensionless PSS-78 conductivity scale measured by CTD probes." },
    refs: ["UNESCO (1981) Technical Papers in Marine Science 36"],
  },
  O2: {
    tex: "O₂ = O₂_sat(SP, θ) · saturation fraction",
    explain: {
      ru: "Растворимость кислорода по Гарсиа и Гордону (1992). В зоне кислородного минимума на 400–1200 м бактерии тратят кислород на разложение органики.",
      en: "Oxygen solubility from Garcia & Gordon (1992). The oxygen minimum zone (400–1200 m) forms where bacteria consume oxygen decomposing organic matter.",
    },
    refs: ["Garcia H.E., Gordon L.I. (1992) Limnol. Oceanogr. 37, 1307–1312", "Reagan J.R. et al. (2023) World Ocean Atlas 2023"],
  },
  light: {
    tex: "E_d(λ, z) = E_d(λ, 0)·exp(−K_d(λ)·z),  K_d = a_w(λ)/μ̄_d + K_bio;  K_d(490) = 0.0166 + 0.0773·Chl^0.6715",
    explain: {
      ru: "Закон Бугера–Ламберта для каждой длины волны от 380 до 700 нм. Поглощение чистой воды по Поупу и Фраю. Красный свет гаснет в первые метры, глубже всех проходит синий (≈ 420–480 нм). Упрощение: хлорофилл делает воду темнее, но не меняет её оттенок.",
      en: "Beer–Lambert–Bouguer law per wavelength (380–700 nm); pure-water absorption by Pope & Fry. Red is lost in the first metres; blue (≈ 420–480 nm) penetrates deepest. Simplification: chlorophyll darkens but does not re-colour the water.",
    },
    refs: ["Pope R.M., Fry E.S. (1997) Appl. Opt. 36, 8710–8723", "Morel A. et al. (2007) Remote Sens. Environ. 111, 69–88"],
  },
  netBuoy: {
    tex: "(m + C_a·ρV)·dw/dt = (m − ρ(z)·V(z))·g − ½ρ·C_d·A·|w|·w\nV(z) = V_h(1 − κ_h·Δp) + V_f(1 − κ_f·Δp + β_f·ΔT)",
    explain: {
      ru: "Вертикальное движение аппарата. На 11 км морская вода примерно на 5 % плотнее, чем у поверхности. Титан и синтактная пена сжимаются слабее, поэтому аппарат с глубиной легчает. У Триеста бензин сжимается сильнее воды, и он с глубиной тяжелеет. Грузы откалиброваны по историческому времени погружения.",
      en: "Vertical motion. Seawater is ~5 % denser at 11 km; titanium and syntactic foam compress less, so the craft gets lighter with depth. Trieste's gasoline compresses more, so it gets heavier. Ballast is calibrated to historical dive times.",
    },
    refs: ["Newman J.N. (1977) Marine Hydrodynamics, MIT Press", "Piccard J., Dietz R.S. (1961) Seven Miles Down"],
  },
};
