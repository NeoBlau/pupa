/**
 * Surface gravity waves and wind-driven (Ekman) currents.
 *
 * Sources:
 *   Pierson W.J., Moskowitz L. (1964) J. Geophys. Res. 69(24), 5181–5190.
 *   Hasselmann K. et al. (1973) JONSWAP. Dtsch. Hydrogr. Z. A8(12).
 *   Large W.G., Pond S. (1981) J. Phys. Oceanogr. 11, 324–336 (drag coefficient).
 *   Ekman V.W. (1905); empirical surface current and depth after
 *     Pond S., Pickard G.L. (1983) Introductory Dynamical Oceanography, ch. 9.
 */

export const G = 9.81;
export const OMEGA_EARTH = 7.2921e-5; // rad/s
export const RHO_AIR = 1.225; // kg/m³

/** Linear dispersion ω² = g·k·tanh(k·h), solved for k by Newton iteration. */
export function wavenumber(omega: number, depth = Infinity): number {
  let k = (omega * omega) / G;
  if (!isFinite(depth)) return k;
  for (let i = 0; i < 50; i++) {
    const th = Math.tanh(k * depth);
    const f = G * k * th - omega * omega;
    const df = G * th + G * k * depth * (1 - th * th);
    const dk = f / df;
    k -= dk;
    if (Math.abs(dk) < 1e-12 * k) break;
  }
  return k;
}

/** Pierson–Moskowitz fully developed sea. U is wind at 19.5 m [m/s]. */
export function piersonMoskowitz(omega: number, U195: number): number {
  const alpha = 8.1e-3, beta = 0.74;
  const w0 = G / U195;
  return ((alpha * G * G) / Math.pow(omega, 5)) * Math.exp(-beta * Math.pow(w0 / omega, 4));
}

/** JONSWAP fetch-limited spectrum. U10 [m/s], fetch F [m]. */
export function jonswap(omega: number, U10: number, fetch: number, gamma = 3.3): number {
  const x = (G * fetch) / (U10 * U10);
  const alpha = 0.076 * Math.pow(x, -0.22);
  const wp = 22 * Math.pow((G * G) / (U10 * fetch), 1 / 3);
  const sigma = omega <= wp ? 0.07 : 0.09;
  const r = Math.exp(-Math.pow(omega - wp, 2) / (2 * sigma * sigma * wp * wp));
  return ((alpha * G * G) / Math.pow(omega, 5)) * Math.exp(-1.25 * Math.pow(wp / omega, 4)) * Math.pow(gamma, r);
}

/** Spectral moments → significant wave height Hs = 4√m0 and peak period. */
export function spectrumStats(S: (w: number) => number, wMin = 0.05, wMax = 6, n = 4000) {
  let m0 = 0, peakW = wMin, peakS = 0;
  const dw = (wMax - wMin) / n;
  for (let i = 0; i < n; i++) {
    const w = wMin + (i + 0.5) * dw;
    const s = S(w);
    m0 += s * dw;
    if (s > peakS) { peakS = s; peakW = w; }
  }
  return { Hs: 4 * Math.sqrt(m0), Tp: (2 * Math.PI) / peakW, m0, peakOmega: peakW };
}

export interface WaveComponent { amp: number; k: number; omega: number; dir: number; phase: number }

/**
 * Discretise a spectrum into N random-phase components for rendering and for
 * orbital velocities felt by the submersible near the surface.
 * a_i = √(2·S(ω_i)·Δω)  (standard linear random-wave synthesis).
 */
export function synthesise(S: (w: number) => number, N: number, windDir = 0, seed = 1, wMin = 0.2, wMax = 4): WaveComponent[] {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const dw = (wMax - wMin) / N;
  const out: WaveComponent[] = [];
  for (let i = 0; i < N; i++) {
    const omega = wMin + (i + rnd()) * dw;
    // cos² directional spreading around the wind direction
    const spread = Math.asin(2 * rnd() - 1);
    out.push({ amp: Math.sqrt(2 * S(omega) * dw), k: wavenumber(omega), omega, dir: windDir + spread, phase: rnd() * 2 * Math.PI });
  }
  return out;
}

/** Deep-water orbital velocity magnitude at depth z (>0 down) — decays as e^(−kz). */
export function orbitalSpeed(components: WaveComponent[], z: number): number {
  let v2 = 0;
  for (const c of components) {
    const u = c.amp * c.omega * Math.exp(-c.k * z);
    v2 += 0.5 * u * u;
  }
  return Math.sqrt(v2);
}

/** Large & Pond (1981) neutral drag coefficient for U10 [m/s]. */
export function dragCoefficient(U10: number): number {
  if (U10 < 11) return 1.2e-3;
  return (0.49 + 0.065 * Math.min(U10, 25)) * 1e-3;
}

export function windStress(U10: number): number {
  return RHO_AIR * dragCoefficient(U10) * U10 * U10;
}

export function coriolis(latDeg: number): number {
  return 2 * OMEGA_EARTH * Math.sin((latDeg * Math.PI) / 180);
}

/**
 * Ekman spiral (Pond & Pickard empirical form). Surface current V0 and Ekman
 * depth D_E; velocity rotates 45° from the wind at the surface (to the right
 * in the NH) and further with depth, decaying as e^(−πz/D_E).
 * Not valid within ~10° of the equator where f → 0.
 */
export function ekman(U10: number, latDeg: number) {
  const s = Math.sqrt(Math.abs(Math.sin((latDeg * Math.PI) / 180)));
  const valid = Math.abs(latDeg) >= 10;
  const V0 = (0.0127 * U10) / Math.max(s, 1e-6);
  const DE = (4.3 * U10) / Math.max(s, 1e-6);
  const sign = latDeg >= 0 ? -1 : 1; // rotate clockwise in NH (negative math angle)
  const at = (z: number) => {
    const decay = Math.exp((-Math.PI * z) / DE);
    const angle = sign * (Math.PI / 4 + (Math.PI * z) / DE);
    return { speed: V0 * decay, angleFromWind: angle };
  };
  return { V0, DE, valid, at };
}
