/**
 * Local seafloor relief around the dive site, shared by physics (collision)
 * and rendering so the craft lands exactly on the floor that is drawn.
 * Deterministic value-noise fBm; amplitude depends on the setting (flat
 * abyssal plain vs. rugged ridge). This is illustrative relief on top of the
 * published or gridded mean depth, not survey data.
 */
function hash(ix: number, iy: number, seed: number) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function vnoise(x: number, y: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export interface Relief { amplitude: number; scale: number; seed: number }

export const RELIEF: Record<string, Relief> = {
  plain: { amplitude: 1.5, scale: 60, seed: 3 },
  ridge: { amplitude: 9, scale: 35, seed: 11 },
  trench: { amplitude: 4, scale: 45, seed: 7 },
  reef: { amplitude: 2.5, scale: 18, seed: 5 },
  lake: { amplitude: 1, scale: 70, seed: 13 },
};

/** Height of the floor above its mean level [m] (positive = shallower). */
export function reliefHeight(x: number, y: number, r: Relief): number {
  let h = 0, amp = 1, f = 1 / r.scale, norm = 0;
  for (let o = 0; o < 4; o++) {
    h += amp * (vnoise(x * f, y * f, r.seed + o) - 0.5);
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return (h / norm) * 2 * r.amplitude;
}

export function reliefFor(missionId?: string): Relief {
  switch (missionId) {
    case "tag_vents": return RELIEF.ridge;
    case "challenger_deep": return RELIEF.trench;
    case "reef_wreck": return RELIEF.reef;
    case "baikal": return RELIEF.lake;
    default: return RELIEF.plain;
  }
}
