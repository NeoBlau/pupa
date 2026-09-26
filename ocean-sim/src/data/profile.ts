/**
 * Ocean water column at one location, and interpolation of every quantity the
 * instruments show at an arbitrary depth.
 *
 * Columns come from (in order of preference):
 *   1. WOA23 tiles prepared by tools/prepare_woa.py      (source "WOA23")
 *   2. literature-guided idealised columns               (source "idealised*")
 */
import * as t10 from "../science/teos10";

export interface Column {
  name: string;
  lat: number;
  lon: number;
  bottom: number; // m
  source: string;
  z: number[]; // m, positive down
  p: number[]; // dbar
  SP: number[];
  SA: number[]; // g/kg
  CT: number[]; // °C
  t: number[]; // in-situ °C (precomputed with gsw.t_from_CT)
  sigma0: number[];
  O2: number[]; // µmol/kg
  NO3: number[]; // µmol/kg
}

export interface Sample {
  z: number;
  p: number;
  SP: number;
  SA: number;
  CT: number;
  t: number;
  rho: number;
  sigma0: number;
  soundSpeed: number;
  soundSpeedMackenzie: number;
  N2: number;
  alpha: number;
  beta: number;
  O2: number;
  NO3: number;
  ctFreezing: number;
}

function bracket(z: number[], v: number): [number, number, number] {
  if (v <= z[0]) return [0, 0, 0];
  const n = z.length - 1;
  if (v >= z[n]) return [n, n, 0];
  let lo = 0, hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (z[mid] <= v) lo = mid; else hi = mid;
  }
  return [lo, hi, (v - z[lo]) / (z[hi] - z[lo])];
}

const lerp = (arr: number[], i: number, j: number, f: number) => arr[i] + (arr[j] - arr[i]) * f;

/** Sample the column at depth z [m]. Pressure is computed exactly with TEOS-10. */
export function sample(col: Column, z: number): Sample {
  const zc = Math.min(Math.max(z, 0), col.bottom);
  const [i, j, f] = bracket(col.z, zc);
  const SA = lerp(col.SA, i, j, f);
  const CT = lerp(col.CT, i, j, f);
  const SP = lerp(col.SP, i, j, f);
  const t = lerp(col.t, i, j, f);
  const p = t10.pFromZ(-zc, col.lat);
  // Local N² from the bracketing standard levels.
  const a = Math.max(0, Math.min(i, col.z.length - 2));
  const n2 = t10.nSquared([col.SA[a], col.SA[a + 1]], [col.CT[a], col.CT[a + 1]], [col.p[a], col.p[a + 1]], col.lat).N2[0];
  return {
    z: zc,
    p,
    SP,
    SA,
    CT,
    t,
    rho: t10.rho(SA, CT, p),
    sigma0: t10.sigma0(SA, CT),
    soundSpeed: t10.soundSpeed(SA, CT, p),
    soundSpeedMackenzie: t10.soundSpeedMackenzie(t, SP, zc),
    N2: n2 ?? 0,
    alpha: t10.alpha(SA, CT, p),
    beta: t10.beta(SA, CT, p),
    O2: lerp(col.O2, i, j, f),
    NO3: lerp(col.NO3, i, j, f),
    ctFreezing: t10.ctFreezing(SA, p),
  };
}

export interface FallbackBundle {
  levels: number[];
  missions: Record<string, Column>;
  bands: Column[];
}

let fallback: FallbackBundle | null = null;

export async function loadFallback(base = import.meta.env.BASE_URL): Promise<FallbackBundle> {
  if (!fallback) fallback = (await (await fetch(`${base}data/fallback.json`)).json()) as FallbackBundle;
  return fallback;
}

/** WOA23 tile index written by tools/prepare_woa.py (absent until data is prepared). */
interface WoaIndex { tileDeg: number; levels: number[]; vars: string[]; scale: Record<string, [number, number]>; tiles: string[] }
let woaIndex: WoaIndex | null | undefined;

async function loadWoaIndex(base: string): Promise<WoaIndex | null> {
  if (woaIndex !== undefined) return woaIndex;
  try {
    const r = await fetch(`${base}data/woa23/index.json`);
    woaIndex = r.ok ? ((await r.json()) as WoaIndex) : null;
  } catch {
    woaIndex = null;
  }
  return woaIndex;
}

/**
 * Column at (lat, lon). Tries WOA23 first, then falls back to the idealised
 * latitude band. Bathymetry is applied by the caller.
 */
export async function columnAt(lat: number, lon: number, base = import.meta.env.BASE_URL): Promise<Column> {
  const idx = await loadWoaIndex(base);
  if (idx) {
    const col = await woaColumn(idx, lat, lon, base);
    if (col) return col;
  }
  const fb = await loadFallback(base);
  let best = fb.bands[0];
  for (const b of fb.bands) if (Math.abs(b.lat - lat) < Math.abs(best.lat - lat)) best = b;
  return { ...best, lat, lon, name: `idealised ${best.lat}°` };
}

/**
 * Tiles are Int16 little-endian, layout [var][level][cellLat][cellLon],
 * value = raw·scale + offset, missing = −32768.
 */
async function woaColumn(idx: WoaIndex, lat: number, lon: number, base: string): Promise<Column | null> {
  const d = idx.tileDeg;
  const tLat = Math.floor((lat + 90) / d) * d - 90;
  const tLon = Math.floor((lon + 180) / d) * d - 180;
  const key = `${tLat}_${tLon}`;
  if (!idx.tiles.includes(key)) return null;
  const buf = await (await fetch(`${base}data/woa23/${key}.bin`)).arrayBuffer();
  const data = new Int16Array(buf);
  const cells = d; // 1° cells
  const ci = Math.min(cells - 1, Math.floor(lat - tLat));
  const cj = Math.min(cells - 1, Math.floor(lon - tLon));
  const nL = idx.levels.length;
  const get = (v: number, l: number) => {
    const raw = data[((v * nL + l) * cells + ci) * cells + cj];
    if (raw === -32768) return NaN;
    const [s, o] = idx.scale[idx.vars[v]];
    return raw * s + o;
  };
  const cols: Record<string, number[]> = {};
  idx.vars.forEach((name, v) => (cols[name] = idx.levels.map((_, l) => get(v, l))));
  let n = 0;
  while (n < nL && !Number.isNaN(cols.SA[n])) n++;
  if (n < 2) return null;
  const cut = (a: number[]) => a.slice(0, n);
  return {
    name: `WOA23 ${lat.toFixed(1)}, ${lon.toFixed(1)}`,
    lat, lon, bottom: idx.levels[n - 1], source: "WOA23",
    z: cut(idx.levels), p: cut(idx.levels).map((z) => t10.pFromZ(-z, lat)),
    SP: cut(cols.SP), SA: cut(cols.SA), CT: cut(cols.CT), t: cut(cols.t),
    sigma0: cut(cols.SA).map((sa, i) => t10.sigma0(sa, cols.CT[i])),
    O2: cut(cols.O2), NO3: cut(cols.NO3),
  };
}

/**
 * Extend a column below its deepest level to the real bottom depth by holding
 * SA and CT constant (homogeneous hadal/abyssal water) — the in-situ t then
 * rises adiabatically. For the extension, t is derived from the last level
 * with the local adiabatic lapse rate Γ ≈ 0.12–0.15 K/km; we use the exact
 * lapse from the last two levels when they are already homogeneous, otherwise
 * Γ = 0.13 K/km (Talley et al. 2011, §3.5).
 */
export function extendToBottom(col: Column, bottom: number): Column {
  if (bottom <= col.bottom + 1) {
    // Truncate to the seafloor.
    const n = col.z.findIndex((z) => z > bottom);
    if (n <= 0) return { ...col, bottom };
    const cut = (a: number[]) => [...a.slice(0, n)];
    return { ...col, bottom, z: cut(col.z), p: cut(col.p), SP: cut(col.SP), SA: cut(col.SA), CT: cut(col.CT), t: cut(col.t), sigma0: cut(col.sigma0), O2: cut(col.O2), NO3: cut(col.NO3) };
  }
  const out = { ...col, z: [...col.z], p: [...col.p], SP: [...col.SP], SA: [...col.SA], CT: [...col.CT], t: [...col.t], sigma0: [...col.sigma0], O2: [...col.O2], NO3: [...col.NO3], bottom, source: col.source + "+adiabatic" };
  const last = col.z.length - 1;
  const gamma = 0.13e-3;
  for (let z = Math.ceil(col.bottom / 250) * 250 + 250; ; z += 250) {
    const zz = Math.min(z, bottom);
    out.z.push(zz);
    out.p.push(t10.pFromZ(-zz, col.lat));
    for (const k of ["SP", "SA", "CT", "sigma0", "O2", "NO3"] as const) out[k].push(col[k][last]);
    out.t.push(col.t[last] + gamma * (zz - col.bottom));
    if (zz >= bottom) break;
  }
  return out;
}
