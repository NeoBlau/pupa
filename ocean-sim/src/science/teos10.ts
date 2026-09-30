/**
 * Seawater thermodynamics (TEOS-10) — the public API used by the simulator.
 *
 * All polynomial work lives in teos10.generated.ts, transcribed mechanically
 * from GSW-C so it matches the reference implementation to round-off.
 *
 * Variables follow TEOS-10 conventions:
 *   SA  Absolute Salinity                [g/kg]
 *   CT  Conservative Temperature         [°C]
 *   p   sea pressure (abs. − 10.1325)    [dbar]
 *   z   height, negative below surface   [m]
 *
 * Sources:
 *   IOC, SCOR & IAPSO (2010) The international thermodynamic equation of
 *     seawater – 2010. Manuals and Guides No. 56, UNESCO.
 *   Roquet F. et al. (2015) Accurate polynomial expressions for the density
 *     and specific volume of seawater using TEOS-10. Ocean Modelling 90, 29–43.
 */
import * as g from "./teos10.generated";

/** In-situ density ρ(SA, CT, p) [kg/m³]. */
export const rho = (SA: number, CT: number, p: number): number => 1 / g.specvol(SA, CT, p);

/** Specific volume [m³/kg]. */
export const specvol = g.specvol;

/** Potential density anomaly σ₀ = ρ(SA, CT, 0) − 1000 [kg/m³]. */
export const sigma0 = g.sigma0;

/** Thermal expansion coefficient w.r.t. CT [1/K]. */
export const alpha = g.alpha;

/** Saline contraction coefficient at constant CT [kg/g]. */
export const beta = g.beta;

/** Speed of sound in seawater [m/s]. */
export const soundSpeed = g.sound_speed;

/** Gravitational acceleration at latitude and pressure [m/s²]. */
export const grav = g.grav;

/** Pressure [dbar] from height z [m] (z < 0 in the ocean). */
export const pFromZ = (z: number, lat: number): number => g.p_from_z(z, lat, 0, 0);

/** Height z [m] from pressure [dbar]. */
export const zFromP = (p: number, lat: number): number => g.z_from_p(p, lat, 0, 0);

/** Conservative Temperature at which seawater freezes (air-free) [°C]. */
export const ctFreezing = (SA: number, p: number): number => g.ct_freezing_poly(SA, p, 0);

/**
 * Buoyancy (Brunt–Väisälä) frequency squared N² on the mid-points of a
 * column, discretised exactly as gsw.Nsquared:
 *   N² = g² / (v · Δp·10⁴) · (β ΔSA − α ΔCT)   evaluated at mid-points.
 * Returns N² [1/s²] and mid-point pressures [dbar].
 */
export function nSquared(
  SA: ArrayLike<number>,
  CT: ArrayLike<number>,
  p: ArrayLike<number>,
  lat: number,
): { N2: number[]; pMid: number[] } {
  const N2: number[] = [];
  const pMid: number[] = [];
  for (let i = 0; i + 1 < p.length; i++) {
    const gLocal = 0.5 * (grav(lat, p[i]) + grav(lat, p[i + 1]));
    const saMid = 0.5 * (SA[i] + SA[i + 1]);
    const ctMid = 0.5 * (CT[i] + CT[i + 1]);
    const pm = 0.5 * (p[i] + p[i + 1]);
    const dp = p[i + 1] - p[i];
    const v = g.specvol(saMid, ctMid, pm);
    N2.push(
      ((gLocal * gLocal) / (v * 1e4 * dp)) *
        (g.beta(saMid, ctMid, pm) * (SA[i + 1] - SA[i]) - g.alpha(saMid, ctMid, pm) * (CT[i + 1] - CT[i])),
    );
    pMid.push(pm);
  }
  return { N2, pMid };
}

/**
 * Mackenzie (1981) nine-term sound-speed equation, shown next to TEOS-10 for
 * comparison. Uses in-situ temperature t [°C], practical salinity S and depth
 * D [m]. Stated validity: t 2–30 °C, S 25–40, D 0–8000 m; standard error 0.07 m/s.
 * Mackenzie K.V. (1981) J. Acoust. Soc. Am. 70(3), 807–812.
 */
export function soundSpeedMackenzie(t: number, S: number, D: number): number {
  return (
    1448.96 +
    4.591 * t -
    5.304e-2 * t * t +
    2.374e-4 * t * t * t +
    1.34 * (S - 35) +
    1.63e-2 * D +
    1.675e-7 * D * D -
    1.025e-2 * t * (S - 35) -
    7.139e-13 * t * D * D * D
  );
}

/** Pressure of the SOFAR channel axis: depth of minimum sound speed in a profile. */
export function sofarAxis(p: ArrayLike<number>, c: ArrayLike<number>): { p: number; c: number } {
  let best = 0;
  for (let i = 1; i < c.length; i++) if (c[i] < c[best]) best = i;
  return { p: p[best], c: c[best] };
}
