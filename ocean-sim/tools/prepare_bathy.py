"""Global bathymetry for the map and free-point dives.

    python tools/prepare_bathy.py            # 0.25° grid (≈2 MB)

Source: NOAA NCEI ETOPO 2022, 60 arc-second surface elevation, which merges
GEBCO_2022 in the deep ocean. Cached in data-raw/etopo/.
Downsampled by block median (robust to single-cell spikes). Note that a
0.25° cell averages over ~28 km, so trench bottoms are shallower than the
true deepest points; mission sites use published point depths instead.

Reference: NOAA NCEI (2022) ETOPO 2022 15 Arc-Second Global Relief Model.
  doi:10.25921/fd45-gt74
"""
import argparse
import json
import urllib.request
from pathlib import Path

import numpy as np
import xarray as xr

URL = ("https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/60s/"
       "60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--res", type=float, default=0.25)
    ap.add_argument("--cache", default="data-raw/etopo")
    ap.add_argument("--src", default=None, help="local NetCDF instead of downloading")
    ap.add_argument("--out", default="public/data")
    args = ap.parse_args()

    src = Path(args.src) if args.src else Path(args.cache) / Path(URL).name
    if not src.exists():
        src.parent.mkdir(parents=True, exist_ok=True)
        print("download", URL)
        urllib.request.urlretrieve(URL, src)
    ds = xr.open_dataset(src)
    z = ds["z"]
    if float(z.lat[0]) < float(z.lat[-1]):
        z = z.isel(lat=slice(None, None, -1))  # north first
    arr = z.values.astype(np.float32)
    ny, nx = arr.shape
    f = int(round(args.res / (180.0 / ny)))
    H, W = ny // f, nx // f
    blocks = arr[: H * f, : W * f].reshape(H, f, W, f).transpose(0, 2, 1, 3).reshape(H, W, f * f)
    out_grid = np.median(blocks, axis=2)
    out = Path(args.out) / "bathy"
    out.mkdir(parents=True, exist_ok=True)
    np.clip(np.round(out_grid), -32767, 32767).astype("<i2").tofile(out / "global.bin")
    (out / "index.json").write_text(json.dumps({
        "width": W, "height": H, "res": 180.0 / H,
        "source": f"ETOPO 2022 (NOAA NCEI, incl. GEBCO_2022), {180.0 / H:g}° block median",
    }))
    man_path = Path(args.out) / "manifest.json"
    man = json.loads(man_path.read_text()) if man_path.exists() else {}
    man["bathy"] = True
    man_path.write_text(json.dumps(man))
    print(f"done: {W}×{H} → {out}")


if __name__ == "__main__":
    main()
