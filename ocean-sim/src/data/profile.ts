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
interface WoaIndex { tileDeg: number; levels: number[]; vars: string[]; scale: Record<string, [number, number]>; tiles: string[]; month: number }

/** public/data/manifest.json lists which prepared datasets exist. */
export interface Manifest { woa23: boolean; bathy: boolean; woaMonths?: number[] }
let manifest: Promise<Manifest> | null = null;
export function loadManifest(base = import.meta.env.BASE_URL): Promise<Manifest> {
  manifest ??= fetch(`${base}data/manifest.json`).then((r) => r.json() as Promise<Manifest>).catch(() => ({ woa23: false, bathy: false }));
  return manifest;
}

const woaIndex = new Map<number, Promise<WoaIndex | null>>();

async function loadWoaIndex(base: string, month: number): Promise<WoaIndex | null> {
  const man = await loadManifest(base);
  if (!man.woa23) return null;
  const m = man.woaMonths?.includes(month) ? month : 0;
  if (!woaIndex.has(m)) {
    woaIndex.set(m, fetch(`${base}data/woa23/m${String(m).padStart(2, "0")}/index.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return woaIndex.get(m)!;
}

/**
 * Column at (lat, lon) for a month (0 = annual). Tries WOA23 first, then the
 * idealised latitude band. Bathymetry is applied by the caller.
 */
export async function columnAt(lat: number, lon: number, month = 0, base = import.meta.env.BASE_URL): Promise<Column> {
  const idx = await loadWoaIndex(base, month);
  if (idx) {
    const col = await woaColumn(idx, lat, lon, base);
    if (col) return col;
  }
  const fb = await loadFallback(base);
  let best = fb.bands[0];
  for (const b of fb.bands) if (Math.abs(b.lat - lat) < Math.abs(best.lat - lat)) best = b;
  return { ...best, lat, lon, name: `idealised ${best.lat}°` };
}

/** Decode one sparse tile (format documented in tools/prepare_woa.py). */
export function decodeTile(data: Int16Array, idx: Pick<WoaIndex, "levels" | "vars" | "scale">) {
  const cells: Array<{ ci: number; cj: number; cols: Record<string, number[]> }> = [];
  let k = 0;
  const n = data[k++];
  for (let c = 0; c < n; c++) {
    const ci = data[k++], cj = data[k++], nLev = data[k++];
    const cols: Record<string, number[]> = {};
    for (const v of idx.vars) {
      const [s, o] = idx.scale[v];
      const arr: number[] = new Array(nLev);
      for (let l = 0; l < nLev; l++) { const raw = data[k++]; arr[l] = raw === -32768 ? NaN : raw * s + o; }
      cols[v] = arr;
    }
    cells.push({ ci, cj, cols });
  }
  return cells;
}

async function woaColumn(idx: WoaIndex, lat: number, lon: number, base: string): Promise<Column | null> {
  const d = idx.tileDeg;
  const tLat = Math.floor((lat + 90) / d) * d - 90;
  const tLon = Math.floor((lon + 180) / d) * d - 180;
  const key = `${tLat}_${tLon}`;
  if (!idx.tiles.includes(key)) return null;
  const r = await fetch(`${base}data/woa23/m${String(idx.month).padStart(2, "0")}/${key}.bin`);
  if (!r.ok) return null;
  const cells = decodeTile(new Int16Array(await r.arrayBuffer()), idx);
  const ci = Math.floor(lat - tLat), cj = Math.floor(lon - tLon);
  // nearest ocean cell (coastlines: the chosen 1° cell may be land in WOA)
  let best = null as (typeof cells)[number] | null, bd = Infinity;
  for (const c of cells) { const dd = (c.ci - ci) ** 2 + (c.cj - cj) ** 2; if (dd < bd) { bd = dd; best = c; } }
  if (!best || bd > 2) return null;
  const n = best.cols.SA.length;
  const z = idx.levels.slice(0, n);
  const clat = tLat + best.ci + 0.5, clon = tLon + best.cj + 0.5;
  return {
    name: `WOA23 ${clat.toFixed(1)}, ${clon.toFixed(1)}`,
    lat, lon, bottom: z[n - 1], source: n > 102 ? "WOA23+adiabatic" : "WOA23",
    z, p: z.map((zz) => t10.pFromZ(-zz, lat)),
    SP: best.cols.SP, SA: best.cols.SA, CT: best.cols.CT, t: best.cols.t,
    sigma0: best.cols.SA.map((sa, i) => t10.sigma0(sa, best!.cols.CT[i])),
    O2: best.cols.O2, NO3: best.cols.NO3,
  };
}

/**
 * Adiabatic lapse rate of in-situ temperature in homogeneous deep water,
 * Γ [K/km] ≈ 0.0659 + 1.326·10⁻⁵·z + 0.005·(Θ − 1), fitted to gsw.t_from_CT
 * for SA ≈ 34.7–34.9 g/kg, Θ −1…3 °C, z 4000–11000 m (max error < 0.03 °C
 * over the full hadal extension; see tests). Used only when a column is
 * extended in the browser; tools/prepare_woa.py extends with gsw exactly.
 */
export function adiabaticRise(z0: number, z1: number, CT: number): number {
  const a = 0.06592 + 0.005 * (CT - 1), b = 1.326e-5;
  return 1e-3 * (a * (z1 - z0) + (b / 2) * (z1 * z1 - z0 * z0));
}

/**
 * Extend a column below its deepest level to the real bottom depth by holding
 * SA and CT constant (homogeneous abyssal/hadal water); in-situ t then rises
 * adiabatically (see adiabaticRise). Shallower bottoms truncate the column.
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
  for (let z = Math.ceil(col.bottom / 250) * 250 + 250; ; z += 250) {
    const zz = Math.min(z, bottom);
    out.z.push(zz);
    out.p.push(t10.pFromZ(-zz, col.lat));
    for (const k of ["SP", "SA", "CT", "sigma0", "O2", "NO3"] as const) out[k].push(col[k][last]);
    out.t.push(col.t[last] + adiabaticRise(col.bottom, zz, col.CT[last]));
    if (zz >= bottom) break;
  }
  return out;
}
