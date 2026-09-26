"""Convert World Ocean Atlas 2023 (1°) into compact browser tiles.

    python tools/prepare_woa.py                 # annual climatology
    python tools/prepare_woa.py --month 7       # July (monthly above 1500 m, annual below)

Downloads (cached in data-raw/woa23/):
  temperature  decav91C0 (1991–2020 climate normal)   t_an  in-situ °C
  salinity     decav91C0                              s_an  practical salinity
  oxygen       all                                    o_an  µmol/kg
  nitrate      all                                    n_an  µmol/kg

Every column is converted with the official TEOS-10 gsw package:
  p = gsw.p_from_z(−z, lat); SA = gsw.SA_from_SP(SP, p, lon, lat)
  CT = gsw.CT_from_t(SA, t, p)
Columns that reach 5500 m (the deepest WOA level) are extended to 11 000 m
holding SA and CT constant, with in-situ t from gsw.t_from_CT (adiabatic).
The browser truncates each column at the local seafloor.

Output: public/data/woa23/mNN/<lat0>_<lon0>.bin (10°×10° tiles, sparse)
Tile format (little-endian Int16):
  nCells, then per cell: ci, cj, nLev, then for each var: nLev values
  value = raw·scale + offset (see index.json)

Reference: Reagan J.R. et al. (2024) World Ocean Atlas 2023. NOAA NCEI.
"""
import argparse
import json
import urllib.request
from pathlib import Path

import gsw
import numpy as np
import xarray as xr

BASE = "https://www.ncei.noaa.gov/data/oceans/woa/WOA23/DATA"
FILES = {
    "t": ("temperature", "decav91C0", "t"),
    "s": ("salinity", "decav91C0", "s"),
    "o": ("oxygen", "all", "o"),
    "n": ("nitrate", "all", "n"),
}
VARS = ["SP", "SA", "CT", "t", "O2", "NO3"]
SCALE = {"SP": (0.001, 20.0), "SA": (0.001, 20.0), "CT": (0.001, 10.0), "t": (0.001, 10.0),
         "O2": (0.02, 0.0), "NO3": (0.002, 0.0)}
EXT = np.arange(5750.0, 11000.1, 250.0)
TILE = 10


def fetch(var: str, month: int, cache: Path) -> Path:
    folder, period, code = FILES[var]
    name = f"woa23_{period}_{code}{month:02d}_01.nc"
    url = f"{BASE}/{folder}/netcdf/{period}/1.00/{name}"
    dest = cache / name
    if not dest.exists():
        cache.mkdir(parents=True, exist_ok=True)
        print("download", url)
        urllib.request.urlretrieve(url, dest)
    return dest


def load(var: str, month: int, cache: Path) -> xr.DataArray:
    ds = xr.open_dataset(fetch(var, month, cache), decode_times=False)
    return ds[f"{FILES[var][2]}_an"].isel(time=0)


def merged(var: str, month: int, cache: Path) -> xr.DataArray:
    """Monthly fields cover 0–1500 m; below that the annual field is used (WOA practice)."""
    annual = load(var, 0, cache)
    if month == 0:
        return annual
    mon = load(var, month, cache)
    upper = mon.reindex(depth=annual.depth)
    return upper.where(annual.depth <= float(mon.depth.max()), annual)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", type=int, default=0)
    ap.add_argument("--cache", default="data-raw/woa23")
    ap.add_argument("--out", default="public/data")
    args = ap.parse_args()
    cache, month = Path(args.cache), args.month

    T, S, O, N = (merged(v, month, cache) for v in "tson")
    depth = T.depth.values.astype(float)
    lat = T.lat.values.astype(float)
    lon = T.lon.values.astype(float)
    levels = np.concatenate([depth, EXT[EXT > depth[-1]]])
    nL = len(levels)

    out = Path(args.out) / "woa23" / f"m{month:02d}"
    out.mkdir(parents=True, exist_ok=True)
    tiles = []
    Tv, Sv, Ov, Nv = (a.transpose("depth", "lat", "lon").values for a in (T, S, O, N))

    for lat0 in range(-90, 90, TILE):
        for lon0 in range(-180, 180, TILE):
            ii = np.where((lat >= lat0) & (lat < lat0 + TILE))[0]
            jj = np.where((lon >= lon0) & (lon < lon0 + TILE))[0]
            cells = []
            for i in ii:
                for j in jj:
                    sp, t = Sv[:, i, j], Tv[:, i, j]
                    valid = np.isfinite(sp) & np.isfinite(t)
                    n = int(np.argmin(valid)) if not valid.all() else len(valid)
                    if n < 1:
                        continue
                    z = depth[:n]
                    p = gsw.p_from_z(-z, lat[i])
                    SA = gsw.SA_from_SP(sp[:n], p, lon[j], lat[i])
                    CT = gsw.CT_from_t(SA, t[:n], p)
                    cols = {"SP": sp[:n], "SA": SA, "CT": CT, "t": t[:n],
                            "O2": Ov[:n, i, j], "NO3": Nv[:n, i, j]}
                    if n == len(depth):  # reaches 5500 m: exact adiabatic extension
                        ze = levels[len(depth):]
                        pe = gsw.p_from_z(-ze, lat[i])
                        te = gsw.t_from_CT(SA[-1], CT[-1], pe)
                        for k in ("SP", "SA", "CT", "O2", "NO3"):
                            cols[k] = np.concatenate([cols[k], np.full(len(ze), cols[k][-1])])
                        cols["t"] = np.concatenate([cols["t"], te])
                        n = nL
                    # O2/NO3 may be missing where T/S exist: carry nearest value
                    for k in ("O2", "NO3"):
                        v = cols[k].astype(float)
                        if np.isnan(v).all():
                            v[:] = np.nan
                        else:
                            idx = np.where(np.isfinite(v), np.arange(len(v)), -1)
                            np.maximum.accumulate(idx, out=idx)
                            first = int(np.argmax(np.isfinite(v)))
                            idx[idx < 0] = first
                            v = v[idx]
                        cols[k] = v
                    cells.append((int(i - ii[0]), int(j - jj[0]), n, cols))
            if not cells:
                continue
            buf = [len(cells)]
            for ci, cj, n, cols in cells:
                buf += [ci, cj, n]
                for v in VARS:
                    s, o = SCALE[v]
                    q = np.round((np.asarray(cols[v], float) - o) / s)
                    q = np.where(np.isfinite(q), np.clip(q, -32767, 32767), -32768)
                    buf += q.astype(int).tolist()
            key = f"{lat0}_{lon0}"
            np.asarray(buf, dtype="<i2").tofile(out / f"{key}.bin")
            tiles.append(key)
            print("tile", key, len(cells), "cells")

    (out / "index.json").write_text(json.dumps({
        "tileDeg": TILE, "levels": levels.tolist(), "vars": VARS,
        "scale": {k: list(v) for k, v in SCALE.items()}, "tiles": tiles, "month": month,
        "source": "WOA23 1° (Reagan et al. 2024), TEOS-10 via gsw",
    }))
    man_path = Path(args.out) / "manifest.json"
    man = json.loads(man_path.read_text()) if man_path.exists() else {}
    man["woa23"] = True
    man["woaMonths"] = sorted(set(man.get("woaMonths", [])) | {month})
    man_path.write_text(json.dumps(man))
    print("done:", len(tiles), "tiles →", out)


if __name__ == "__main__":
    main()
