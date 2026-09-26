/**
 * Global bathymetry grid prepared by tools/prepare_bathy.py from ETOPO 2022 /
 * GEBCO. Int16 elevation in metres (negative = below sea level), row 0 at the
 * north edge, column 0 at 180°W.
 */
import { loadManifest } from "./profile";

interface BathyIndex { width: number; height: number; res: number; source: string }

let grid: { idx: BathyIndex; data: Int16Array } | null | undefined;

export async function loadBathy(base = import.meta.env.BASE_URL) {
  if (grid !== undefined) return grid;
  if (!(await loadManifest(base)).bathy) return (grid = null);
  try {
    const r = await fetch(`${base}data/bathy/index.json`);
    if (!r.ok) throw new Error("absent");
    const idx = (await r.json()) as BathyIndex;
    const buf = await (await fetch(`${base}data/bathy/global.bin`)).arrayBuffer();
    grid = { idx, data: new Int16Array(buf) };
  } catch {
    grid = null;
  }
  return grid;
}

/** Elevation [m] at (lat, lon), bilinear; null if no data is loaded. */
export function elevationAt(lat: number, lon: number): number | null {
  if (!grid) return null;
  const { width: W, height: H, res } = grid.idx;
  const fx = ((lon + 180) / res) - 0.5;
  const fy = ((90 - lat) / res) - 0.5;
  const x0 = Math.floor(fx), y0 = Math.max(0, Math.min(H - 2, Math.floor(fy)));
  const tx = fx - x0, ty = Math.min(Math.max(fy - y0, 0), 1);
  const at = (x: number, y: number) => grid!.data[y * W + ((x % W) + W) % W];
  const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
  const bot = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bot * ty;
}

export const bathySource = () => (grid ? grid.idx.source : null);
export const bathyGrid = () => grid ?? null;
