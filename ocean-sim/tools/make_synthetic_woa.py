"""Synthetic WOA-shaped NetCDF used to test tools/prepare_woa.py offline (tests/fixtures/woa_synthetic)."""
import numpy as np, xarray as xr
depth = np.array([0,5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100,125,150,175,200,225,250,275,300,325,350,375,400,425,450,475,500,550,600,650,700,750,800,850,900,950,1000,1050,1100,1150,1200,1250,1300,1350,1400,1450,1500,1550,1600,1650,1700,1750,1800,1850,1900,1950,2000,2100,2200,2300,2400,2500,2600,2700,2800,2900,3000,3100,3200,3300,3400,3500,3600,3700,3800,3900,4000,4100,4200,4300,4400,4500,4600,4700,4800,4900,5000,5100,5200,5300,5400,5500],float)
lat = np.arange(0.5, 20, 1.0); lon = np.arange(130.5, 150, 1.0)
Z, LA, LO = np.meshgrid(depth, lat, lon, indexing="ij")
T = 2 + 26*np.exp(-Z/400); S = 34.6 + 0.3*np.exp(-Z/300)
O = 150 + 50*np.tanh((Z-800)/400); N = 35*(1-np.exp(-Z/300))
bottom = np.where(LO < 135, 50, np.where(LA > 15, 3000, 6000))  # land-ish shelf, mid, deep
for arr in (T, S, O, N):
    arr[Z > bottom] = np.nan
T[:, :, 0] = np.nan; S[:, :, 0] = np.nan  # one land column strip
for code, arr, period in (("t", T, "decav91C0"), ("s", S, "decav91C0"), ("o", O, "all"), ("n", N, "all")):
    da = xr.DataArray(arr[None], dims=("time", "depth", "lat", "lon"), coords={"time": [0.0], "depth": depth, "lat": lat, "lon": lon}, name=f"{code}_an")
    da.to_dataset().to_netcdf(f"/tmp/claude-0/woatest/cache/woa23_{period}_{code}00_01.nc")
print("fake written")
