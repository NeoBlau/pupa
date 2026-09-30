"""Check prepared WOA23 tiles against the raw NetCDF and known oceanography.

    python tools/validate_woa.py
"""
import json
from pathlib import Path

import gsw
import numpy as np
import xarray as xr

OUT = Path("public/data/woa23/m00")
RAW = Path("data-raw/woa23")
idx = json.loads((OUT / "index.json").read_text())
levels = np.array(idx["levels"])


def column(lat, lon):
    t0 = int(np.floor((lat + 90) / 10) * 10 - 90)
    l0 = int(np.floor((lon + 180) / 10) * 10 - 180)
    key = f"{t0}_{l0}"
    if "bands" in idx:
        band, off, ln = idx["bands"][key]
        d = np.frombuffer((OUT / f"{band}.bin").read_bytes()[off:off + ln], dtype="<i2")
    else:
        d = np.fromfile(OUT / f"{key}.bin", dtype="<i2")
    k, n = 1, int(d[0])
    ci, cj = int(np.floor(lat - t0)), int(np.floor(lon - l0))
    for _ in range(n):
        a, b, nl = int(d[k]), int(d[k + 1]), int(d[k + 2])
        k += 3
        cols = {}
        for v in idx["vars"]:
            s, o = idx["scale"][v]
            raw = d[k:k + nl].astype(float)
            k += nl
            cols[v] = np.where(raw == -32768, np.nan, raw * s + o)
        if (a, b) == (ci, cj):
            return cols
    return None


T = xr.open_dataset(RAW / "woa23_decav91C0_t00_01.nc", decode_times=False)["t_an"].isel(time=0)
S = xr.open_dataset(RAW / "woa23_decav91C0_s00_01.nc", decode_times=False)["s_an"].isel(time=0)

sites = {
    "challenger_deep": (11.37, 142.59),
    "tag_vents": (26.14, -44.83),
    "gulf_stream": (37.0, -71.0),
    "weddell": (-65.0, -40.0),
    "red_sea": (21.35, 38.07),
    "guam": (13.46, 144.62),
}
worst = 0.0
for name, (lat, lon) in sites.items():
    c = column(lat, lon)
    if c is None:
        print(f"{name:16s} no ocean cell in WOA (coast/land at 1°)")
        continue
    n = len(c["t"])
    # tile vs raw NetCDF at every WOA level
    rt = T.sel(lat=lat, lon=lon, method="nearest").values[: min(n, len(T.depth))]
    rs = S.sel(lat=lat, lon=lon, method="nearest").values[: min(n, len(S.depth))]
    m = np.isfinite(rt)
    err_t = np.nanmax(np.abs(c["t"][: len(rt)][m] - rt[m]))
    err_s = np.nanmax(np.abs(c["SP"][: len(rs)][m] - rs[m]))
    worst = max(worst, err_t, err_s)
    z = levels[:n]
    bot = n - 1
    print(f"{name:16s} bottom {z[bot]:6.0f} m | SST {c['t'][0]:5.2f} °C SSS {c['SP'][0]:5.2f} | "
          f"t(1000) {np.interp(1000, z, c['t']):5.2f} | bottom t {c['t'][bot]:5.2f} CT {c['CT'][bot]:5.2f} SA {c['SA'][bot]:6.3f} "
          f"O2min {np.nanmin(c['O2']):5.0f} | max|tile−raw| t {err_t:.4f} S {err_s:.4f}")
print(f"worst quantisation error vs raw: {worst:.4f} (int16 step 0.001)")
