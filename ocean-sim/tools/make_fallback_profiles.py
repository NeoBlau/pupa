"""Build literature-guided idealised profiles used until WOA23 data is loaded.

These are NOT measurements. Each column is built from textbook water-mass
properties (surface layer, thermocline, intermediate and deep water) so the
simulator is usable offline. The UI labels them as "idealised".
Conversions (SP→SA, CT→t, O2 solubility) use the official TEOS-10 gsw package.

Usage: python tools/make_fallback_profiles.py > public/data/fallback.json

Water-mass values:
  Emery W.J., Meincke J. (1986) Global water masses: summary and review.
    Oceanologica Acta 9(4), 383–391.
  Talley L.D. et al. (2011) Descriptive Physical Oceanography, 6th ed.
  Red Sea deep water ≈ 21.6 °C, SP ≈ 40.6: Talley et al. (2011) ch. 8.
  Weddell Sea Bottom Water θ < −0.7 °C, SP ≈ 34.64: Talley et al. (2011) ch. 13.
  Lake Baikal: T ≈ 3.2–3.5 °C below ~250 m, TDS ≈ 0.096 g/kg:
    Shimaraev M.N. et al. (1994) Physical Limnology of Lake Baikal: a Review.
"""
import json
import math

import gsw
import numpy as np

# WOA23 standard levels (m) to 5500, then 250 m steps for hadal extension.
WOA_LEVELS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95,
              100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400, 425, 450, 475,
              500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000, 1050, 1100, 1150, 1200,
              1250, 1300, 1350, 1400, 1450, 1500, 1550, 1600, 1650, 1700, 1750, 1800, 1850,
              1900, 1950, 2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800, 2900, 3000,
              3100, 3200, 3300, 3400, 3500, 3600, 3700, 3800, 3900, 4000, 4100, 4200, 4300,
              4400, 4500, 4600, 4700, 4800, 4900, 5000, 5100, 5200, 5300, 5400, 5500]
LEVELS = WOA_LEVELS + list(range(5750, 11001, 250))


def blend(z, layers):
    """Piece-wise smooth interpolation between (depth, value) anchors in log-depth."""
    zs = np.array([d for d, _ in layers], float)
    vs = np.array([v for _, v in layers], float)
    return np.interp(np.log1p(z), np.log1p(zs), vs)


def column(name, lat, lon, bottom, theta, sp_layers, o2_layers, no3_layers, lake=False, source="idealised"):
    z = np.array([d for d in LEVELS if d <= bottom] + ([bottom] if bottom not in LEVELS else []), float)
    p = gsw.p_from_z(-z, lat)
    SP = blend(z, sp_layers)
    if lake:
        SA = SP * 35.16504 / 35.0  # reference-composition scaling; Baikal ionic composition differs (stated)
    else:
        SA = gsw.SA_from_SP(SP, p, lon, lat)
    theta = blend(z, theta)  # potential temperature anchors
    CT = gsw.CT_from_pt(SA, theta)
    t = gsw.t_from_CT(SA, CT, p)
    sigma0 = gsw.sigma0(SA, CT)
    # O2 anchors are fractions of saturation at the surface (Garcia & Gordon 1992 via gsw)
    o2sat = gsw.O2sol_SP_pt(SP, theta)
    frac = blend(z, o2_layers)
    O2 = o2sat * frac
    NO3 = blend(z, no3_layers)
    r = lambda a, n=4: [round(float(x), n) for x in a]
    return {
        "name": name, "lat": lat, "lon": lon, "bottom": bottom, "source": source,
        "z": r(z, 1), "p": r(p, 2), "SP": r(SP), "SA": r(SA), "CT": r(CT), "t": r(t),
        "sigma0": r(sigma0), "O2": r(O2, 1), "NO3": r(NO3, 2),
    }


def latitude_band(lat):
    """Generic open-ocean column for free-point dives when no WOA data is loaded."""
    a = abs(lat)
    sst = max(-1.8, 28.0 - 30.0 * math.sin(math.radians(a)) ** 2)
    sss = 34.0 + 1.6 * math.exp(-((a - 25) / 12) ** 2) - (0.4 if a > 55 else 0)
    polar = a > 60
    theta = [(0, sst), (50, sst - (0 if polar else 0.3)), (200, max(sst - 8, 1.5) if not polar else -1.0),
             (800, 4.5 if not polar else 0.5), (1500, 3.0 if not polar else 0.2), (4000, 1.4 if not polar else -0.3),
             (11000, 1.1 if not polar else -0.5)]
    sp = [(0, sss), (100, sss), (800, 34.5), (2000, 34.72), (11000, 34.7)]
    o2 = [(0, 1.0), (100, 0.95), (700, 0.35 if a < 30 else 0.55), (1500, 0.55), (4000, 0.65), (11000, 0.62)]
    no3 = [(0, 0.1 if a < 40 else 12.0), (100, 3.0 if a < 40 else 20), (1000, 38), (3000, 34), (11000, 35)]
    return column(f"band_{lat:+03d}", float(lat), 0.0, 5500, theta, sp, o2, no3)


MISSIONS = {
    # Challenger Deep: Greenaway et al. (2021) depth estimate 10 935 m ± 6 m.
    "challenger_deep": column("challenger_deep", 11.3733, 142.5917, 10935,
        theta=[(0, 29.0), (60, 28.5), (150, 24.0), (300, 12.0), (600, 6.5), (1000, 4.2), (2000, 2.1),
               (4000, 1.35), (6000, 1.05), (10935, 1.02)],
        sp_layers=[(0, 34.4), (120, 34.9), (300, 34.5), (600, 34.3), (1200, 34.5), (3000, 34.66), (10935, 34.70)],
        o2_layers=[(0, 1.0), (100, 0.95), (400, 0.55), (1000, 0.35), (2000, 0.45), (5000, 0.60), (10935, 0.62)],
        no3_layers=[(0, 0.05), (100, 1.0), (600, 32), (1200, 42), (3000, 37), (10935, 36)]),
    # TAG hydrothermal field, Mid-Atlantic Ridge, ~3650 m (Rona et al. 1986).
    "tag_vents": column("tag_vents", 26.137, -44.826, 3650,
        theta=[(0, 25.0), (80, 24.0), (300, 17.0), (700, 9.0), (1100, 6.5), (2000, 3.5), (3650, 2.7)],
        sp_layers=[(0, 36.9), (150, 36.7), (700, 35.1), (1100, 35.2), (2000, 34.98), (3650, 34.92)],
        o2_layers=[(0, 1.0), (150, 0.95), (700, 0.55), (1500, 0.75), (3650, 0.78)],
        no3_layers=[(0, 0.05), (150, 1.0), (800, 25), (1500, 20), (3650, 21)]),
    # Gulf Stream at ~37°N 71°W: 18° Mode Water, NADW below.
    "gulf_stream": column("gulf_stream", 37.0, -71.0, 3800,
        theta=[(0, 26.0), (50, 24.5), (150, 19.5), (400, 18.0), (700, 12.0), (1000, 6.5), (2000, 3.6), (3800, 2.3)],
        sp_layers=[(0, 36.3), (150, 36.6), (400, 36.5), (800, 35.4), (1200, 35.05), (3800, 34.92)],
        o2_layers=[(0, 1.0), (300, 0.85), (800, 0.6), (1500, 0.8), (3800, 0.8)],
        no3_layers=[(0, 0.1), (200, 4), (800, 22), (1500, 20), (3800, 21)]),
    # Weddell Sea: Antarctic Surface Water, Warm Deep Water, WSBW.
    "weddell": column("weddell", -65.0, -40.0, 4700,
        theta=[(0, -1.85), (80, -1.8), (200, 0.3), (500, 0.6), (1500, 0.2), (3000, -0.4), (4700, -0.8)],
        sp_layers=[(0, 34.30), (80, 34.40), (300, 34.68), (1000, 34.68), (4700, 34.64)],
        o2_layers=[(0, 1.0), (80, 0.95), (400, 0.60), (1500, 0.65), (4700, 0.75)],
        no3_layers=[(0, 26), (100, 30), (500, 33), (4700, 32)]),
    # Central Red Sea near Atlantis II Deep: warm, saline deep water.
    "red_sea": column("red_sea", 21.35, 38.07, 2200,
        theta=[(0, 29.0), (40, 28.0), (150, 23.0), (300, 21.8), (2200, 21.6)],
        sp_layers=[(0, 39.5), (150, 40.1), (300, 40.5), (2200, 40.6)],
        o2_layers=[(0, 1.0), (150, 0.55), (400, 0.18), (1000, 0.25), (2200, 0.35)],
        no3_layers=[(0, 0.1), (200, 10), (500, 20), (2200, 18)]),
    # Lake Baikal, deepest point ~1642 m (Mir submersibles dived here 2008–2010).
    "baikal": column("baikal", 53.25, 108.07, 1642,
        theta=[(0, 12.0), (15, 9.0), (50, 4.5), (250, 3.5), (1000, 3.3), (1642, 3.15)],
        sp_layers=[(0, 0.096), (1642, 0.096)],
        o2_layers=[(0, 1.0), (1642, 0.80)],
        no3_layers=[(0, 3.0), (100, 30.0), (1642, 30.0)], lake=True, source="idealised-lake"),
}

bands = [latitude_band(lat) for lat in range(-75, 80, 5)]
print(json.dumps({"levels": LEVELS, "missions": MISSIONS, "bands": bands}, separators=(",", ":")))
