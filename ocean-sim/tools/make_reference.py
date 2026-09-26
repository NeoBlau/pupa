"""Dump reference values from the official Python GSW (TEOS-10) for unit tests.

Usage: python tools/make_reference.py > tests/fixtures/gsw_reference.json
"""
import json
import itertools
import gsw
import numpy as np

cases = []
for sa, ct, p in itertools.product(
    [0.0, 5.0, 20.0, 33.0, 34.7, 35.16504, 36.5, 40.0, 42.0],
    [-2.0, -1.0, 0.0, 1.5, 4.0, 10.0, 18.0, 25.0, 30.0, 33.0],
    [0.0, 10.0, 100.0, 500.0, 1000.0, 2500.0, 4000.0, 6000.0, 8000.0, 11000.0],
):
    cases.append({
        "SA": sa, "CT": ct, "p": p,
        "rho": float(gsw.rho(sa, ct, p)),
        "alpha": float(gsw.alpha(sa, ct, p)),
        "beta": float(gsw.beta(sa, ct, p)),
        "sound_speed": float(gsw.sound_speed(sa, ct, p)),
        "sigma0": float(gsw.sigma0(sa, ct)),
    })

depth = []
for lat, z in itertools.product([0.0, 11.35, 45.0, -65.0, 89.0], [-1.0, -200.0, -1000.0, -4000.0, -10935.0]):
    p = float(gsw.p_from_z(z, lat))
    depth.append({"lat": lat, "z": z, "p": p, "z_back": float(gsw.z_from_p(p, lat)), "grav": float(gsw.grav(lat, p))})

freezing = [{"SA": sa, "p": p, "ct_freezing": float(gsw.CT_freezing(sa, p, 0.0)),
             "ct_freezing_poly": float(gsw.CT_freezing_poly(sa, p, 0.0))}
            for sa, p in itertools.product([0.0, 20.0, 34.5, 35.0, 40.0], [0.0, 500.0, 2000.0])]

# N^2 on a synthetic stratified column (checks our discretisation against gsw.Nsquared)
p_col = np.linspace(0, 3000, 61)
sa_col = 34.2 + 0.6 * (1 - np.exp(-p_col / 400))
ct_col = 2 + 22 * np.exp(-p_col / 350)
n2, p_mid = gsw.Nsquared(sa_col, ct_col, p_col, lat=30.0)
nsq = {"lat": 30.0, "p": p_col.tolist(), "SA": sa_col.tolist(), "CT": ct_col.tolist(),
       "N2": n2.tolist(), "p_mid": p_mid.tolist()}

# Adiabatic hadal extension: t(z) at constant SA, CT below 5500 m
hadal = []
for sa, ct, lat in [(34.88, 1.02, 11.37), (34.81, -0.8, -65.0), (34.9, 2.0, 30.0), (34.7, 1.5, -30.0)]:
    zs = [5500.0, 7000.0, 9000.0, 10935.0]
    ts = [float(gsw.t_from_CT(sa, ct, gsw.p_from_z(-z, lat))) for z in zs]
    hadal.append({"SA": sa, "CT": ct, "lat": lat, "z": zs, "t": ts})

print(json.dumps({"gsw_version": gsw.__version__, "cases": cases, "depth": depth,
                  "freezing": freezing, "nsquared": nsq, "hadal": hadal}))
