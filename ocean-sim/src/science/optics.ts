/**
 * Underwater light field.
 *
 * Downwelling spectral irradiance follows the Beer–Lambert–Bouguer law
 *   Ed(λ, z) = Ed(λ, 0⁻) · exp(−Kd(λ) · z)
 * with Kd(λ) ≈ a_w(λ)/μ̄d + Kbio(λ).
 *
 * Sources:
 *   Pope R.M., Fry E.S. (1997) Absorption spectrum (380–700 nm) of pure water.
 *     II. Integrating cavity measurements. Applied Optics 36(33), 8710–8723.
 *   Morel A. et al. (2007) Examining the consistency of products derived from
 *     various ocean color sensors… Remote Sens. Environ. 111, 69–88
 *     — Kd(490) = 0.0166 + 0.0773·Chl^0.6715 and Kd(PAR) from Kd(490).
 *   Wyman C., Sloan P.-P., Shirley P. (2013) Simple analytic approximations to
 *     the CIE XYZ color matching functions. JCGT 2(2).
 *
 * Simplification (stated in the UI): the non-water part of Kd keeps the
 * spectral shape of Kd(490) scaled by a flat factor; chlorophyll therefore
 * darkens the water but does not shift its hue toward green.
 */

/** Pure-water absorption a_w [1/m], Pope & Fry (1997), 380–700 nm every 10 nm. */
export const POPE_FRY_1997: ReadonlyArray<readonly [number, number]> = [
  [380, 0.01137], [390, 0.00851], [400, 0.00663], [410, 0.00473], [420, 0.00454],
  [430, 0.00495], [440, 0.00635], [450, 0.00922], [460, 0.00979], [470, 0.0106],
  [480, 0.0127], [490, 0.015], [500, 0.0204], [510, 0.0325], [520, 0.0409],
  [530, 0.0434], [540, 0.0474], [550, 0.0565], [560, 0.0619], [570, 0.0695],
  [580, 0.0896], [590, 0.1351], [600, 0.2224], [610, 0.2644], [620, 0.2755],
  [630, 0.2916], [640, 0.3108], [650, 0.34], [660, 0.41], [670, 0.439],
  [680, 0.465], [690, 0.516], [700, 0.624],
];

export const WAVELENGTHS = POPE_FRY_1997.map(([l]) => l);

/** Mean cosine of downwelling light just below the surface (typical clear sky). */
export const MU_D = 0.86;

export function kd490(chl: number): number {
  return 0.0166 + 0.0773 * Math.pow(Math.max(chl, 1e-3), 0.6715);
}

/** Morel et al. (2007), eq. for Kd(PAR) over the first optical depth. */
export function kdPAR(chl: number): number {
  const k = kd490(chl);
  return 0.0864 + 0.884 * k - 0.00137 / k;
}

/** Euphotic depth from Morel's Kd(PAR): 4.6/Kd(PAR). Valid for the first optical depth only. */
export function euphoticDepthMorel(chl: number): number {
  return Math.log(100) / kdPAR(chl);
}

/** Spectral diffuse attenuation Kd(λ) [1/m]. */
export function kdSpectrum(chl: number): number[] {
  const kbio = kd490(chl) - 0.0166;
  return POPE_FRY_1997.map(([, aw]) => aw / MU_D + kbio);
}

/**
 * Planck spectral radiance at the Sun's effective temperature, normalised at
 * 550 nm. Used as the above-water spectral shape (atmospheric absorption bands
 * are ignored — stated simplification).
 */
export function solarShape(lambdaNm: number, T = 5772): number {
  const h = 6.62607015e-34, c = 299792458, k = 1.380649e-23;
  const planck = (l: number) => 1 / (Math.pow(l, 5) * (Math.exp((h * c) / (l * k * T)) - 1));
  return planck(lambdaNm * 1e-9) / planck(550e-9);
}

/** Spectral irradiance relative to the surface at depth z [m]. */
export function irradianceSpectrum(z: number, chl: number, surface = 1): number[] {
  const kd = kdSpectrum(chl);
  return WAVELENGTHS.map((l, i) => surface * solarShape(l) * Math.exp(-kd[i] * Math.max(z, 0)));
}

/**
 * Depth of 1 % surface PAR from the spectral model. Deeper than the Kd(PAR)
 * estimate because light becomes bluer (less attenuated) with depth.
 */
export function euphoticDepth(chl: number): number {
  let lo = 0, hi = 1000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (parFraction(mid, chl) > 0.01) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Fraction of surface PAR remaining at depth z (spectrally resolved, 400–700 nm). */
export function parFraction(z: number, chl: number): number {
  const kd = kdSpectrum(chl);
  let top = 0, bottom = 0;
  WAVELENGTHS.forEach((l, i) => {
    if (l < 400) return;
    // PAR is a photon count: weight energy by λ.
    const e0 = solarShape(l) * l;
    top += e0 * Math.exp(-kd[i] * Math.max(z, 0));
    bottom += e0;
  });
  return top / bottom;
}

const lobe = (x: number, mu: number, s1: number, s2: number) => {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
};

/** CIE 1931 2° colour-matching functions, Wyman et al. (2013) multi-lobe fit. */
export function cie1931(l: number): [number, number, number] {
  const x = 1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2);
  const y = 0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1);
  const z = 1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8);
  return [x, y, z];
}

/** XYZ → linear sRGB (IEC 61966-2-1, D65). */
function xyzToLinearRgb([X, Y, Z]: [number, number, number]): [number, number, number] {
  return [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.204 * Y + 1.057 * Z,
  ];
}

/**
 * Colour of downwelling light at depth z as linear sRGB. Returns the hue
 * normalised to unit maximum plus the absolute luminance ratio Y(z)/Y(0) so the
 * renderer can map exposure separately (the human eye stops seeing colour
 * long before light is gone).
 */
export function waterColour(z: number, chl: number): { rgb: [number, number, number]; luminance: number } {
  const E = irradianceSpectrum(z, chl);
  const E0 = irradianceSpectrum(0, chl);
  const integrate = (spec: number[]) => {
    const acc: [number, number, number] = [0, 0, 0];
    WAVELENGTHS.forEach((l, i) => {
      const [x, y, zz] = cie1931(l);
      acc[0] += spec[i] * x; acc[1] += spec[i] * y; acc[2] += spec[i] * zz;
    });
    return acc;
  };
  const xyz = integrate(E);
  const Y0 = integrate(E0)[1];
  const rgb = xyzToLinearRgb(xyz).map((v) => Math.max(v, 0)) as [number, number, number];
  const m = Math.max(...rgb, 1e-30);
  return { rgb: rgb.map((v) => v / m) as [number, number, number], luminance: xyz[1] / Y0 };
}

/**
 * Colour of the veiling (path) light of the water body seen horizontally at
 * depth z: L(λ) ∝ E_d(λ, z) · b(λ) / c(λ). Pure-seawater scattering
 * b_w = 0.00288·(λ/500)^−4.32 m⁻¹ (Morel 1974); particles
 * b_p = 0.30·Chl^0.62·(550/λ) (Morel 1988). Blue even just below the surface.
 */
export function veilingColour(z: number, chl: number): { rgb: [number, number, number]; luminance: number } {
  const E = irradianceSpectrum(z, chl);
  const E0 = irradianceSpectrum(0, chl);
  const kbio = kd490(chl) - 0.0166;
  const acc: [number, number, number] = [0, 0, 0];
  let Y0 = 0;
  POPE_FRY_1997.forEach(([l, aw], i) => {
    const bw = 0.00288 * Math.pow(l / 500, -4.32);
    const bp = 0.3 * Math.pow(Math.max(chl, 0.01), 0.62) * (550 / l);
    const b = bw + bp;
    const ratio = b / (aw + kbio * 0.5 + b);
    const [x, y, zz] = cie1931(l);
    acc[0] += E[i] * ratio * x; acc[1] += E[i] * ratio * y; acc[2] += E[i] * ratio * zz;
    Y0 += E0[i] * y;
  });
  const rgb = xyzToLinearRgb(acc).map((v) => Math.max(v, 0)) as [number, number, number];
  const m = Math.max(...rgb, 1e-30);
  return { rgb: rgb.map((v) => v / m) as [number, number, number], luminance: acc[1] / Y0 };
}

/** Classical light zones (by 1 % and ~0 % PAR). */
export function lightZone(z: number, chl: number): "euphotic" | "dysphotic" | "aphotic" {
  if (z <= euphoticDepth(chl)) return "euphotic";
  // ~1e-10 of surface irradiance is often quoted as the limit of vision for
  // deep-sea fish (Denton 1990) and is reached near 1000 m in clear water.
  return parFraction(z, chl) > 1e-10 ? "dysphotic" : "aphotic";
}
